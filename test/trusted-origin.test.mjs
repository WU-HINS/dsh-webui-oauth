/**
 * 统一「是否采信浏览器可影响的 origin」开关 回归测试。
 *
 * 覆盖两处共用同一开关：
 *   - OIDC 回调 base（resolveOidcBase，浏览器上报 location.origin）；
 *   - 登录成功后交给核心的 token 跳转（postLoginRedirect，authority 取自请求 Host）。
 *
 * 刻意**只留开关、不做 origin 白名单**：采信判定已有格式校验，OIDC 侧还有
 * PKCE + client_secret + id_token 验签多重把关，故不再叠加白名单约束。
 *
 * 运行：node test/trusted-origin.test.mjs   （或 npm test）
 */
import { trustedOriginPolicy, resolveOidcBase, postLoginRedirect } from '../index.js'

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

function mkCtx(settings) {
  return {
    get(ns) {
      if (ns === 'settings') return settings === undefined ? undefined : { get: (k) => settings[k] }
      if (ns === 'webServer') return { port: 3080 }
      if (ns === 'connection') return { authenticatedUrl: (base) => base + '/?token=abc' }
      return undefined
    },
  }
}
const req = (headers) => ({ headers, socket: {} })
const SEC = (o) => ({ 'remote-web-ui': o })

console.log('— trustedOriginPolicy：开关来源与优先级 —')
let p = trustedOriginPolicy(mkCtx({}), null)
eq('未配置 → 默认开启', p.trust, true)
eq('不再返回白名单字段', p.allowList, undefined)
p = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: false })), null)
eq('settings 显式关闭', p.trust, false)
p = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: true })), null)
eq('settings 显式开启', p.trust, true)
p = trustedOriginPolicy(mkCtx({}), { trustBrowserOrigin: false })
eq('settings 未配置 → 回退 OIDC 旧开关', p.trust, false)
p = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: true })), { trustBrowserOrigin: false })
eq('settings 优先于旧开关', p.trust, true)
p = trustedOriginPolicy({ get: () => undefined }, null)
eq('settings 服务缺失 → 默认开启', p.trust, true)

console.log('\n— resolveOidcBase：策略接管 —')
const OIDC = { redirectBase: 'https://cfg.example.com' }
eq('信任 → 前端 origin',
  resolveOidcBase(OIDC, 'https://dsh.example.com', { trust: true }), 'https://dsh.example.com')
eq('信任 + 前端非法 → 回退配置',
  resolveOidcBase(OIDC, 'not a url', { trust: true }), 'https://cfg.example.com')
eq('不信任 → 仅配置（忽略前端）',
  resolveOidcBase(OIDC, 'https://dsh.example.com', { trust: false }), 'https://cfg.example.com')
eq('不信任 + 无配置 → null（fail-closed）',
  resolveOidcBase({}, 'https://dsh.example.com', { trust: false }), null)
eq('信任 + 无前端无配置 → null',
  resolveOidcBase({}, undefined, { trust: true }), null)
eq('省略 policy → 回退 OIDC 旧开关（关）',
  resolveOidcBase({ trustBrowserOrigin: false, redirectBase: 'https://cfg.example.com' }, 'https://b.example'), 'https://cfg.example.com')
eq('省略 policy → 默认开启',
  resolveOidcBase(OIDC, 'https://b.example.com'), 'https://b.example.com')
eq('CRLF 前端值拒收 → 回退配置',
  resolveOidcBase(OIDC, 'https://a.com\r\nx-evil: 1', { trust: true }), 'https://cfg.example.com')

console.log('\n— postLoginRedirect：同一开关约束 token 跳转 —')
const PUB = SEC({ publicBaseUrl: 'https://dsh.example.com:8443' })
eq('默认（未配置开关）→ 仍按请求 Host',
  postLoginRedirect(mkCtx({}), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')
eq('开关关闭 → 改用配置 origin',
  postLoginRedirect(mkCtx(SEC({ publicBaseUrl: 'https://dsh.example.com:8443', trustBrowserOrigin: false })), req({ host: 'dsh.homelab.lan:8443' })), 'https://dsh.example.com:8443/?token=abc')
eq('开关开启 → 用请求 Host（scheme 走 XFP）',
  postLoginRedirect(mkCtx(PUB), req({ host: 'dsh.example:8443', 'x-forwarded-proto': 'https' })), 'https://dsh.example:8443/?token=abc')
eq('开关关闭但无 publicBaseUrl → 兜底请求 Host',
  postLoginRedirect(mkCtx(SEC({ trustBrowserOrigin: false })), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')
eq('开关关闭 + 无 Host 头 → 回环兜底',
  postLoginRedirect(mkCtx(SEC({ trustBrowserOrigin: false })), req({})), 'http://127.0.0.1:3080/?token=abc')
eq('connection 服务缺失 → "/"',
  postLoginRedirect({ get: () => undefined }, req({ host: 'a.com' })), '/')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
