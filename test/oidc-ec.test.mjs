/**
 * OIDC id_token 的 EC（ECDSA）签名验证：ES256 / ES384 / ES512。
 *
 * 覆盖：
 *   1. 三条曲线各用 Node 原生真实签名 → 验签必须通过；
 *   2. 篡改 payload / 异密钥伪造 → 必须拒绝；
 *   3. JWKS 按 kid 选中 EC key；无 alg 字段的 key 也要能用（部分 IdP 不写 alg）；
 *   4. 算法混淆：EC key 配 RS256 头、RSA key 配 ES256 头，都必须被拒。
 *
 * 背景：ECDSA 的 JWT 签名是 JOSE 原始 R||S（ieee-p1363），而 crypto.verify 默认按
 * DER 解析；少了 dsaEncoding 就会验签失败，且 ES256 因曲线小而偶发"误中"，很难发现。
 *
 * 运行：node test/oidc-ec.test.mjs
 */
import { generateKeyPairSync, createSign, createHash } from 'node:crypto'
import { verifyJwtSignature, findJwk } from '../index.js'

const b64url = (b) => Buffer.from(b).toString('base64url')

const CURVES = [
  { alg: 'ES256', named: 'prime256v1', hash: 'sha256' },
  { alg: 'ES384', named: 'secp384r1', hash: 'sha384' },
  { alg: 'ES512', named: 'secp521r1', hash: 'sha512' },
]

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + ' ' + (x ?? '')) } }

for (const { alg, named, hash } of CURVES) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: named })
  const jwk = publicKey.export({ format: 'jwk' })
  const kid = alg + '-key'
  const header = { alg, typ: 'JWT', kid }
  const payload = { iss: 'https://idp.test', sub: 'u1', aud: 'cid', exp: Math.floor(Date.now()/1000)+300 }
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload))
  // JOSE 要求 ECDSA 用 ieee-p1363 原始 R||S
  const sig = createSign(hash.toUpperCase().replace('SHA','sha')).update(data).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  const jwt = data + '.' + b64url(sig)

  console.log('\n— ' + alg + ' (' + named + ') —')
  eq(alg + ' 正确签名验签通过', verifyJwtSignature(jwt, { ...jwk, kid, alg }) === true)

  // 篡改 payload 必须失败
  const tampered = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify({ ...payload, sub: 'attacker' })) + '.' + b64url(sig)
  eq(alg + ' 篡改 payload 被拒', verifyJwtSignature(tampered, { ...jwk, kid, alg }) === false)

  // 用另一把密钥的签名必须失败
  const other = generateKeyPairSync('ec', { namedCurve: named })
  const otherSig = createSign(hash.toUpperCase().replace('SHA','sha')).update(data).sign({ key: other.privateKey, dsaEncoding: 'ieee-p1363' })
  eq(alg + ' 异密钥签名被拒', verifyJwtSignature(data + '.' + b64url(otherSig), { ...jwk, kid, alg }) === false)

  // findJwk 按 kid 选中 EC key
  const jwks = { keys: [{ ...jwk, kid, alg, use: 'sig' }] }
  eq(alg + ' findJwk 按 kid 命中', findJwk(jwks, header)?.kid === kid)
}

console.log('\n— 算法混淆：EC key 配 RS256 头必须被拒 —')
{
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const jwks = { keys: [{ ...jwk, kid: 'k1', alg: 'ES256' }] }
  eq('EC key 不被 RS256 选中', findJwk(jwks, { alg: 'RS256', kid: 'k1' }) === null)
  eq('RSA key 不被 ES256 选中', findJwk({ keys: [{ kty: 'RSA', kid: 'k2', n: 'x', e: 'AQAB' }] }, { alg: 'ES256', kid: 'k2' }) === null)
}

console.log('\n— JWKS 未声明 alg 的 EC key（部分 IdP 省略该字段）—')
{
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const data = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'k1' })) + '.'
    + b64url(JSON.stringify({ iss: 'https://i', sub: 'u', aud: 'c', exp: Math.floor(Date.now() / 1000) + 100 }))
  const sig = createSign('sha256').update(data).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  const jwt = data + '.' + b64url(sig)
  const noAlg = { ...jwk, kid: 'k1', use: 'sig' }
  eq('无 alg 字段仍能按 kid 命中 EC key', findJwk({ keys: [noAlg] }, { alg: 'ES256', kid: 'k1' }) !== null)
  eq('无 alg 字段仍验签通过', verifyJwtSignature(jwt, noAlg) === true)
}

console.log('\n— alg 绑定：声明与实际必须一致（防曲线/哈希维度的算法混淆）—')
{
  // 回归：曾经 verifyJwtSignature 用 (jwk.alg || header.alg) 决定验签算法，而 IdP 基本
  // 都会在 JWKS 写 alg —— 等价于让 jwk.alg 覆盖 header.alg，header.alg 形同虚设。
  // 后果是"自称 ES512、实为 P-256"的 token 也能通过。下面这组用例可稳定复现该缺陷。
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const jwksKey = { ...jwk, kid: 'A', use: 'sig', alg: 'ES256' }   // JWKS 声明 ES256
  const signWith = (header) => {
    const h = b64url(JSON.stringify(header))
    const p = b64url(JSON.stringify({ iss: 'https://i', sub: 'u', aud: 'c', exp: Math.floor(Date.now() / 1000) + 100 }))
    const data = h + '.' + p
    const sig = createSign('sha256').update(data).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
    return data + '.' + b64url(sig)
  }
  eq('header.alg=ES256（与 jwk.alg 一致）→ 接受',
    verifyJwtSignature(signWith({ alg: 'ES256', typ: 'JWT', kid: 'A' }), jwksKey) === true)
  eq('header.alg=ES384 但 jwk.alg=ES256 → 拒绝（不得让 jwk.alg 覆盖 header.alg）',
    verifyJwtSignature(signWith({ alg: 'ES384', typ: 'JWT', kid: 'A' }), jwksKey) === false)
  eq('header.alg=ES512 但 jwk.alg=ES256 → 拒绝',
    verifyJwtSignature(signWith({ alg: 'ES512', typ: 'JWT', kid: 'A' }), jwksKey) === false)
  // 同一把 key，去掉 jwk.alg 声明后：算法完全由 header 决定，签名对不上就得拒
  const noAlgKey = { ...jwk, kid: 'A', use: 'sig' }
  eq('无 jwk.alg 时 header.alg=ES256 → 接受',
    verifyJwtSignature(signWith({ alg: 'ES256', typ: 'JWT', kid: 'A' }), noAlgKey) === true)
  eq('无 jwk.alg 时 header.alg=ES512（签名实为 sha256）→ 拒绝',
    verifyJwtSignature(signWith({ alg: 'ES512', typ: 'JWT', kid: 'A' }), noAlgKey) === false)
}

console.log('\n— 算法名白名单：编造的 alg 不得命中任何 key —')
{
  const ecKey = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', kid: 'A' }
  const rsaKey = { kty: 'RSA', n: 'x', e: 'AQAB', kid: 'B' }
  // algMatchesKty 曾用 startsWith 前缀匹配，'ES999'/'RS999' 都能命中对应 kty 的 key。
  eq('ES999 不命中 EC key', findJwk({ keys: [ecKey] }, { alg: 'ES999', kid: 'A' }) === null)
  eq('ES999（无 kid）不命中 EC key', findJwk({ keys: [ecKey] }, { alg: 'ES999' }) === null)
  eq('RS999 不命中 RSA key', findJwk({ keys: [rsaKey] }, { alg: 'RS999', kid: 'B' }) === null)
  eq('Ed999 不命中 OKP key', findJwk({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'c', kid: 'C' }] }, { alg: 'Ed999', kid: 'C' }) === null)
  eq('ES256 仍正常命中 EC key', findJwk({ keys: [ecKey] }, { alg: 'ES256', kid: 'A' }) !== null)
}

console.log('\n— JWKS 的 use / key_ops：加密专用 key 不得用于验签 —')
{
  const ecKey = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', kid: 'A' }
  eq('use=enc 的 key 不被选中',
    findJwk({ keys: [{ ...ecKey, use: 'enc' }] }, { alg: 'ES256', kid: 'A' }) === null)
  eq('key_ops=[encrypt] 的 key 不被选中',
    findJwk({ keys: [{ ...ecKey, key_ops: ['encrypt'] }] }, { alg: 'ES256', kid: 'A' }) === null)
  eq('use=sig 的 key 正常选中',
    findJwk({ keys: [{ ...ecKey, use: 'sig' }] }, { alg: 'ES256', kid: 'A' }) !== null)
  eq('key_ops=[verify] 的 key 正常选中',
    findJwk({ keys: [{ ...ecKey, key_ops: ['verify'] }] }, { alg: 'ES256', kid: 'A' }) !== null)
  eq('未声明 use/key_ops 的 key 仍可用（兼容）',
    findJwk({ keys: [ecKey] }, { alg: 'ES256', kid: 'A' }) !== null)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)