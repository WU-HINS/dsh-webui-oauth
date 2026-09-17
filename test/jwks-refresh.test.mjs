/**
 * JWKS 缓存失效回归测试。
 *
 * 背景（真实故障，已在隔离实例上复现）：`makeDiscoveryCache` 把 discovery + JWKS
 * 缓存 1 小时。当 IdP 轮换签名密钥（换算法或换 kid）后，缓存里那把旧 key 已无法
 * 验签，但代码不会主动刷新，于是【最长一小时】所有 OIDC 登录都以 `no-signing-key`
 * 失败，必须重启 dsh 才恢复。
 *
 * 实测复现步骤：先在 RS256 IdP 上登录成功（缓存写入 RSA key），随后仅把 IdP 换成
 * ES256（模拟密钥轮换），同一个 dsh 进程内再登录 → 必失败。修复后同一场景自动恢复。
 *
 * 修复：验签失败且本次用的是缓存时，绕过缓存强制重取一次 JWKS 再验，成功后回写。
 *
 * 本测试通过注入 fetch 来构造 IdP，不依赖网络与 TLS，因此可在任何环境稳定运行。
 *
 * 运行：node test/jwks-refresh.test.mjs
 */
import { makeDiscoveryCache } from '../index.js'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

const ISSUER = 'https://idp.test'

/**
 * 可控的假 IdP：key 可随时轮换，并统计各类请求次数。
 * @returns {{ fetchImpl: Function, rotate: Function, counts: object, failNext: Function }}
 */
function makeIdp() {
  let key = { kid: 'rsa-1', kty: 'RSA', alg: 'RS256' }
  const counts = { discovery: 0, jwks: 0 }
  let failJwks = false
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.endsWith('/.well-known/openid-configuration')) {
      counts.discovery++
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: ISSUER + '/authorize',
            token_endpoint: ISSUER + '/token',
            jwks_uri: ISSUER + '/jwks',
          })
        },
      }
    }
    if (u.endsWith('/jwks')) {
      counts.jwks++
      if (failJwks) return { ok: false, status: 500, async text() { return '' } }
      return { ok: true, status: 200, async text() { return JSON.stringify({ keys: [key] }) } }
    }
    throw new Error('unexpected url ' + u)
  }
  return {
    fetchImpl,
    counts,
    rotate(kid, kty, alg) { key = { kid, kty, alg } },
    failNext(v) { failJwks = v },
  }
}

console.log('\n— 基本行为：首次拉取，其后走缓存 —')
{
  const idp = makeIdp()
  const c = makeDiscoveryCache(idp.fetchImpl)
  const a = await c.get(ISSUER)
  eq('首次 discovery 成功', a.ok === true, a.error)
  eq('首次拿到 jwks', !!a.jwks && a.jwks.keys[0].kid === 'rsa-1')
  eq('首次确实拉了 discovery', idp.counts.discovery === 1, idp.counts.discovery)
  eq('首次确实拉了 jwks', idp.counts.jwks === 1, idp.counts.jwks)

  const b = await c.get(ISSUER)
  eq('二次命中缓存（kid 不变）', b.ok === true && b.jwks.keys[0].kid === 'rsa-1')
  eq('二次未重复拉取', idp.counts.discovery === 1 && idp.counts.jwks === 1,
    JSON.stringify(idp.counts))
}

console.log('\n— 核心回归：IdP 轮换密钥后普通 get 返回旧 key（这就是故障根源）—')
{
  const idp = makeIdp()
  const c = makeDiscoveryCache(idp.fetchImpl)
  const first = await c.get(ISSUER)
  eq('轮换前缓存的是 rsa-1', first.jwks.keys[0].kid === 'rsa-1', first.jwks.keys[0].kid)

  idp.rotate('ec-1', 'EC', 'ES256')   // 模拟 IdP 轮换密钥/算法

  const stale = await c.get(ISSUER)
  eq('普通 get 仍返回旧 key（TTL 内不刷新）', stale.jwks.keys[0].kid === 'rsa-1', stale.jwks.keys[0].kid)

  const fresh = await c.refresh(ISSUER)
  eq('refresh 拿到轮换后的新 key', fresh.ok === true && fresh.jwks.keys[0].kid === 'ec-1',
    fresh.ok ? fresh.jwks.keys[0].kid : fresh.error)

  const after = await c.get(ISSUER)
  eq('refresh 已回写缓存，后续 get 即新 key', after.jwks.keys[0].kid === 'ec-1', after.jwks.keys[0].kid)
}

console.log('\n— refresh 的失败路径不得污染已有缓存 —')
{
  const idp = makeIdp()
  const c = makeDiscoveryCache(idp.fetchImpl)
  const ok = await c.get(ISSUER)
  eq('先建立缓存', ok.ok === true && ok.jwks.keys[0].kid === 'rsa-1')

  idp.failNext(true)
  const bad = await c.refresh(ISSUER)
  eq('JWKS 拉取失败时 refresh 返回失败', bad.ok === false, String(bad.error))

  idp.failNext(false)
  const still = await c.get(ISSUER)
  eq('失败未覆盖缓存，旧 key 仍在（不写坏值）', still.ok === true && still.jwks.keys[0].kid === 'rsa-1',
    still.ok ? still.jwks.keys[0].kid : still.error)
}

console.log('\n— 同源校验仍然生效（安全回归）—')
{
  const idp = makeIdp()
  const base = idp.fetchImpl
  const evil = async (url) => {
    const u = String(url)
    if (u.endsWith('/.well-known/openid-configuration')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: ISSUER + '/authorize',
            token_endpoint: ISSUER + '/token',
            jwks_uri: 'https://evil.test/jwks',   // 跨源
          })
        },
      }
    }
    return base(url)
  }
  const c = makeDiscoveryCache(evil)
  const r = await c.get(ISSUER)
  eq('跨源 jwks_uri 被拒绝', r.ok === false && r.error === 'jwks-cross-origin', String(r.error))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
