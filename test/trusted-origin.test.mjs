/**
 * 统一「是否采信浏览器可影响的 origin」开关 + 白名单 回归测试。
 *
 * 覆盖两处共用同一策略：
 *   - OIDC 回调 base（resolveOidcBase，浏览器上报 location.origin）；
 *   - 登录成功后交给核心的 token 跳转（postLoginRedirect，authority 取自请求 Host）。
 *
 * 运行：node test/trusted-origin.test.mjs   （或 npm test）
 * 零依赖，直接 import 插件模块并调用导出的纯函数。
 */
import { trustedOriginPolicy, originMatches, resolveOidcBase, postLoginRedirect } from '../index.js'

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

// 伪造 ctx：settings 段、webServer.port、connection.authenticatedUrl
function mkCtx(settings, port) {
  return {
    get(ns) {
      if (ns === 'settings') {
        return settings === undefined ? undefined : { get: (k) => settings[k] }
      }
      if (ns === 'webServer') return { port: port || 3080 }
      if (ns === 'connection') return { authenticatedUrl: (base) => base + '/?token=abc' }
      return undefined
    },
  }
}
const req = (headers) => ({ headers, socket: { remoteAddress: '127.0.0.1' } })
const SEC = (o) => ({ 'remote-web-ui': o })

console.log('— trustedOriginPolicy：开关与白名单来源 —')
let p = trustedOriginPolicy(mkCtx({}), null)
eq('未配置 → 默认开启', p.trust, true)
eq('未配置 → 白名单为空（不约束）', p.allowList.length, 0)
p = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: false })), null)
eq('settings 显式关闭', p.trust, false)
p = trustedOriginPolicy(mkCtx(SEC({ trustedOrigins: ['https://a.com', ' https://b.com '] })), null)
eq('白名单读取并去空白', p.allowList.length, 2)
eq('白名单首项', p.allowList[0], 'https://a.com')
p = trustedOriginPolicy(mkCtx({}), { trustBrowserOrigin: false })
eq('settings 未配置 → 回退 OIDC 旧开关', p.trust, false)
p = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: true })), { trustBrowserOrigin: false })
eq('settings 优先于旧开关', p.trust, true)

console.log('\n— originMatches：空名单不约束，命中按规范化精确相等 —')
eq('空数组（未配置）= 不约束', originMatches('https://any.example', []), true)
eq('非数组 = 不约束', originMatches('https://any.example', undefined), true)
eq('精确命中', originMatches('https://dsh.example.com:8443', ['https://dsh.example.com:8443']), true)
eq('大小写与尾斜杠归范', originMatches('https://DSH.Example.com:8443/', ['https://dsh.example.com:8443']), true)
eq('端口不同不命中', originMatches('https://dsh.example.com:9443', ['https://dsh.example.com:8443']), false)
eq('scheme 不同不命中', originMatches('http://dsh.example.com:8443', ['https://dsh.example.com:8443']), false)
eq('异源不命中', originMatches('https://evil.example', ['https://dsh.example.com:8443']), false)
eq('多值白名单任一命中', originMatches('https://b.com', ['https://a.com', 'https://b.com']), true)
eq('非字符串项跳过', originMatches('https://a.com', [123, 'https://a.com']), true)
eq('非 http(s) 候选不命中', originMatches('ftp://a.com', ['https://a.com']), false)

console.log('\n— resolveOidcBase：三参 policy 接管 —')
const OIDC = { redirectBase: 'https://cfg.example.com' }
eq('信任 + 白名单命中 → 前端 origin',
  resolveOidcBase(OIDC, 'https://dsh.example.com', { trust: true, allowList: ['https://dsh.example.com'] }), 'https://dsh.example.com')
eq('信任 + 白名单未命中 → 回退配置',
  resolveOidcBase(OIDC, 'https://evil.example', { trust: true, allowList: ['https://dsh.example.com'] }), 'https://cfg.example.com')
eq('不信任 → 仅配置（忽略前端）',
  resolveOidcBase(OIDC, 'https://dsh.example.com', { trust: false, allowList: ['https://dsh.example.com'] }), 'https://cfg.example.com')
eq('不信任 + 无配置 → null（fail-closed）',
  resolveOidcBase({}, 'https://dsh.example.com', { trust: false, allowList: [] }), null)
eq('信任 + 白名单空 → 同旧行为（采信前端）',
  resolveOidcBase(OIDC, 'https://dsh.example.com', { trust: true, allowList: [] }), 'https://dsh.example.com')
eq('省略 policy → 回退 OIDC 旧开关（关）',
  resolveOidcBase({ trustBrowserOrigin: false, redirectBase: 'https://cfg.example.com' }, 'https://b.example'), 'https://cfg.example.com')
eq('省略 policy → 默认开启',
  resolveOidcBase(OIDC, 'https://b.example.com'), 'https://b.example.com')

console.log('\n— postLoginRedirect：同一开关约束 token 跳转 —')
const HO = SEC({ publicBaseUrl: 'https://www.example.com:8443' })
eq('默认（未配置开关）→ 仍按请求 Host',
  postLoginRedirect(mkCtx({}), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')
eq('开关关闭 → 改用配置 origin',
  postLoginRedirect(mkCtx(SEC({ ...HO['remote-web-ui'], trustBrowserOrigin: false })), req({ host: 'dsh.homelab.lan:8443' })), 'https://www.example.com:8443/?token=abc')
eq('白名单未命中 → 改用配置 origin',
  postLoginRedirect(mkCtx(SEC({ publicBaseUrl: 'https://www.example.com:8443', trustedOrigins: ['https://www.example.com:8443'] })), req({ host: 'evil.example' })), 'https://www.example.com:8443/?token=abc')
eq('白名单命中 → 用请求 Host（且 scheme 走 XFP）',
  postLoginRedirect(mkCtx(SEC({ publicBaseUrl: 'https://www.example.com:8443', trustedOrigins: ['https://dsh.example:8443'] })), req({ host: 'dsh.example:8443', 'x-forwarded-proto': 'https' })), 'https://dsh.example:8443/?token=abc')
eq('开关关闭但无 publicBaseUrl → 兜底请求 Host',
  postLoginRedirect(mkCtx(SEC({ trustBrowserOrigin: false })), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')
eq('开关关闭 + 无 Host 头 → 回环兜底',
  postLoginRedirect(mkCtx(SEC({ trustBrowserOrigin: false })), req({})), 'http://127.0.0.1:3080/?token=abc')
eq('白名单未命中 + 无配置 origin → 兜底请求 Host',
  postLoginRedirect(mkCtx(SEC({ trustedOrigins: ['https://other.example'] })), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
