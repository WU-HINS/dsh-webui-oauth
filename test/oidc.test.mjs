import { readFileSync } from 'node:fs'
import { generateKeyPairSync, sign } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isValidOrigin, resolveOidcBase, sanitizeSub, oidcRandom, parseJwt, verifyJwtSignature, findJwk, validateIdToken } from '../index.js'

let pass = 0
let fail = 0
function eq(name, got, want) {
  if (got === want) {
    pass++
    console.log('  ok   ' + name + '  -> ' + JSON.stringify(got))
  } else {
    fail++
    console.log('  FAIL ' + name + '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))
  }
}

// ---- RS256 密钥与 id_token 构造 ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = publicKey.export({ format: 'jwk' })
pubJwk.alg = 'RS256'; pubJwk.use = 'sig'; pubJwk.kid = 'k1'
const jwks = { keys: [pubJwk] }
const ISSUER = 'https://idp.example.com', CLIENT = 'my-client'
const NOW = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function makeJwt(payload, hdr = {}) {
  const h = { alg: 'RS256', typ: 'JWT', kid: 'k1', ...hdr }
  const data = b64(h) + '.' + b64(payload)
  const sig = sign('sha256', Buffer.from(data), privateKey).toString('base64url')
  return data + '.' + sig
}
const okToken = makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'user-123', exp: NOW + 300, iat: NOW, nonce: 'n1' })

console.log('\n— isValidOrigin —')
eq('合法 origin+端口', isValidOrigin('https://x.com:8443'), true)
eq('合法 http', isValidOrigin('http://192.168.3.5'), true)
eq('带 path 拒绝', isValidOrigin('https://x.com/path'), false)
eq('带 query 拒绝', isValidOrigin('https://x.com?x=1'), false)
eq('带 hash 拒绝', isValidOrigin('https://x.com#f'), false)
eq('带 userinfo 拒绝', isValidOrigin('https://u:p@x.com'), false)
eq('非 http(s) 拒绝', isValidOrigin('ftp://x.com'), false)
eq('CRLF 控制字符拒绝', isValidOrigin('https://x.com\r\nx-evil:1'), false)
eq('非字符串拒绝', isValidOrigin(123), false)
eq('空串拒绝', isValidOrigin(''), false)

console.log('\n— resolveOidcBase（trustBrowserOrigin 语义） —')
eq('默认信前端 origin', resolveOidcBase(undefined, 'https://dsh.example.com'), 'https://dsh.example.com')
eq('显式 trustBrowserOrigin=true', resolveOidcBase({ trustBrowserOrigin: true }, 'https://a.com'), 'https://a.com')
eq('前端非法回退配置', resolveOidcBase({ trustBrowserOrigin: true, redirectBase: 'https://cfg.example.com' }, 'not a url'), 'https://cfg.example.com')
eq('前端无值回退配置', resolveOidcBase({ trustBrowserOrigin: true, redirectBase: 'https://cfg.example.com' }, undefined), 'https://cfg.example.com')
eq('两者皆无 → null', resolveOidcBase({ trustBrowserOrigin: true }, undefined), null)
eq('开关关仅配置', resolveOidcBase({ trustBrowserOrigin: false, redirectBase: 'https://cfg.example.com' }, 'https://browser.example.com'), 'https://cfg.example.com')
eq('开关关无配置 → null', resolveOidcBase({ trustBrowserOrigin: false }, 'https://browser.example.com'), null)

console.log('\n— sanitizeSub —')
eq('过滤引号换行', sanitizeSub('user\n"evil"'), 'user__evil_')
eq('超长截断', sanitizeSub('a'.repeat(300)).length, 128)
eq('非字符串', sanitizeSub(null), 'unknown')
eq('空串', sanitizeSub(''), 'unknown')

console.log('\n— oidcRandom —')
const ra = oidcRandom(), rb = oidcRandom()
eq('唯一且长', ra !== rb && ra.length >= 32, true)
eq('base64url 字符集', /^[A-Za-z0-9_-]+$/.test(ra), true)

console.log('\n— parseJwt —')
eq('正常解析', parseJwt(okToken).payload.sub, 'user-123')
eq('畸形拒绝', parseJwt('not.a.jwt'), null)

console.log('\n— validateIdToken（RS256 全链路） —')
eq('正常通过', validateIdToken(okToken, { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', jwks }).ok, true)
// 篡改签名末两位。注意【不能】直接写 slice(0,-2)+'aa'：
// RS256 签名是 256 字节，base64url 编码后 342 字符 = 2052 bit，而数据只需 2048 bit，
// 末位字符的【低 4 位是填充位，解码时被丢弃】。因此当末位落在 {A,Q,g,w} 时，
// "aQ" 与 "aa" 解码出的字节完全一样——签名根本没被改动，验签当然通过。
// 实测复现率约 2%（200 轮命中 2 次），表现为 CI 上偶发 FAIL 而本地稳定通过。
// 修法：翻转末位字符，并断言确实改动了字节；否则换一个字符再试。
function tamperSignature(token) {
  const parts = token.split('.')
  const orig = parts[2]
  const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const origBytes = Buffer.from(orig, 'base64url')
  for (let i = 0; i < AL.length; i++) {
    if (AL[i] === orig.slice(-1)) continue
    const cand = orig.slice(0, -1) + AL[i]
    // 必须确认解码后的字节真的变了，否则这个"篡改"是无效的
    if (!Buffer.from(cand, 'base64url').equals(origBytes)) {
      return parts[0] + '.' + parts[1] + '.' + cand
    }
  }
  throw new Error('无法构造出有效的坏签名样本')
}
let r = validateIdToken(tamperSignature(okToken), { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', jwks })
eq('坏签名', r.error, 'bad-signature')
// 锁死这个回归：篡改后的字节必须与原签名不同，否则上面的用例是假阳性
eq('篡改确实改变了签名字节',
  Buffer.from(tamperSignature(okToken).split('.')[2], 'base64url')
    .equals(Buffer.from(okToken.split('.')[2], 'base64url')), false)
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW + 300, nonce: 'wrong' }), { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', jwks })
eq('坏 nonce', r.error, 'bad-nonce')
r = validateIdToken(makeJwt({ iss: 'https://evil.com', aud: CLIENT, sub: 'u', exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('坏 iss', r.error, 'bad-iss')
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW - 100 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('已过期', r.error, 'expired')
r = validateIdToken(makeJwt({ iss: ISSUER, aud: 'other', sub: 'u', exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('坏 aud', r.error, 'bad-aud')
// 多值 aud：按 OIDC 规范必须同时校验 azp，否则针对多个 client 签发的 token
// 会被误认为"发给自己"。缺 azp 或不符一律拒绝。
r = validateIdToken(makeJwt({ iss: ISSUER, aud: [CLIENT, 'other'], sub: 'u', exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('多值 aud 缺 azp → 拒绝', r.error, 'bad-azp')
r = validateIdToken(makeJwt({ iss: ISSUER, aud: [CLIENT, 'other'], azp: 'someone-else', sub: 'u', exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('多值 aud 但 azp 不符 → 拒绝', r.error, 'bad-azp')
r = validateIdToken(makeJwt({ iss: ISSUER, aud: [CLIENT, 'other'], azp: CLIENT, sub: 'u', exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('多值 aud + 正确 azp → 通过', r.ok, true)
// 算法混淆：header 谎称 ES256，但 JWKS 里只有 RSA key。findJwk 用 algMatchesKty 按
// header.alg 校验 key 类型（ES256 只接受 EC key）→ 找不到签名密钥而拒绝。
// 这挡住了"由 token 的 header 决定验签算法"的经典混淆攻击。
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW + 300 }, { alg: 'ES256' }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('header 谎称 ES256 配 RSA key → 拒绝', r.error, 'no-signing-key')
// alg=none / HS* 必须直接拒绝（对称算法可用公钥当前缀伪造签名）
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW + 300 }, { alg: 'none' }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('alg=none → 拒绝', r.error, 'bad-alg')
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW + 300 }, { alg: 'HS256' }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('alg=HS256 → 拒绝', r.error, 'bad-alg')
// 缺 signing key
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, sub: 'u', exp: NOW + 300 }, { alg: 'ES256', kid: 'missing' }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('无匹配 kid 的 key', r.error, 'no-signing-key')
// 缺 sub
r = validateIdToken(makeJwt({ iss: ISSUER, aud: CLIENT, exp: NOW + 300 }), { issuer: ISSUER, clientId: CLIENT, jwks })
eq('缺 sub', r.error, 'missing-sub')

console.log('\n— EC 密钥（ES256/384/512）与 EdDSA 验签 —')
const ecB64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
for (const [crv, alg, digest] of [['P-256', 'ES256', 'sha256'], ['P-384', 'ES384', 'sha384'], ['P-521', 'ES512', 'sha512']]) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: crv })
  const jwk = publicKey.export({ format: 'jwk' })
  jwk.alg = alg; jwk.use = 'sig'; jwk.kid = 'ec1'
  const ecJwks = { keys: [jwk] }
  const data = ecB64({ alg, typ: 'JWT', kid: 'ec1' }) + '.' + ecB64({ iss: ISSUER, aud: CLIENT, sub: 'ec-user', exp: NOW + 300, iat: NOW, nonce: 'n1' })
  const sig = sign(digest, Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  const r = validateIdToken(data + '.' + sig, { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', jwks: ecJwks })
  eq(alg + ' JOSE 验签通过', r.ok, true)
}

console.log('\n— 登录页 SSO 按钮（前端注入逻辑） —')
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'index.js'), 'utf8')
const start = src.indexOf('const LOGIN_PAGE = `')
const rawLiteral = src.slice(start + 'const LOGIN_PAGE = `'.length, src.indexOf('`', src.indexOf('</html>', start)))
const page = new Function('return `' + rawLiteral + '`')() // eslint-disable-line no-new-func
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
scripts.forEach((body, i) => {
  let err = ''
  try { new Function(body) } catch (e) { err = e.message }
  eq('登录页 script#' + (i + 1) + ' 语法', err === '' ? 'OK' : err, 'OK')
})
eq('登录页包含 SSO 链接逻辑', /oidc\/login/.test(page), true)
eq('登录页 origin 上报', /location\.origin/.test(page), true)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)