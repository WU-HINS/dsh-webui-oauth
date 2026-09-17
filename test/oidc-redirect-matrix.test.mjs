/**
 * OIDC 授权跳转矩阵回归测试。
 *
 * 本测试锁定「redirect_uri 到底指向哪里」这一组决策，它是 OIDC 能否部署成功的
 * 关键，也是历史上反复出问题的地方（固定路径被带偏、反代改写 Host 后跳回内网、
 * 动态 origin 被注入污染）。
 *
 * 三条路径与判定依据（与 index.js 的 resolveOidcBase / postLoginRedirect 一一对应）：
 *   1. 固定路径跳转：配置了 oidc.redirectBase → 恒为 redirectBase + 固定回调路径，
 *      且该值必须【只接受裸 origin】（带 path/query/hash/userinfo 一律拒绝），
 *      否则部署者一个手滑就会把回调指到别的路径上；
 *   2. 反代跳转：回跳目标优先采信反代下发的原始主机头（X-Forwarded-Host /
 *      RFC 7239 Forwarded），因为反代常把 Host 改写成内网回环；没有原始头时
 *      判为回环并回退配置 origin，绝不把用户丢到内网地址；
 *   3. 浏览器动态跳转：redirectBase 留空时采信登录页上报的 location.origin，
 *      但必须过 isValidOrigin；开关关闭时不采信，两者都不可用则 fail-closed。
 *
 * 这些断言曾在真实服务器上（IdP + 反向代理 + dsh 实例）逐条跑通，本文件把它固化成
 * 无需外部依赖的单元回归，避免以后改动解析逻辑时无声退化。
 *
 * 运行：node test/oidc-redirect-matrix.test.mjs   （或 npm test）
 */
import {
  isValidOrigin, resolveOidcBase, trustedOriginPolicy, postLoginRedirect,
} from '../index.js'

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

const mkCtx = (settings) => ({
  get(ns) {
    if (ns === 'settings') return settings === undefined ? undefined : { get: (k) => settings[k] }
    if (ns === 'webServer') return { port: 3080 }
    if (ns === 'connection') return { authenticatedUrl: (base) => base + '/?token=abc' }
    return undefined
  },
})
const req = (headers) => ({ headers, socket: {} })
const SEC = (o) => ({ 'remote-web-ui': o })

// ---------------------------------------------------------------
console.log('— 1. 固定路径跳转：redirectBase 是确定性答案 —')
// 反代改写 Host 时，浏览器上报的 origin 与服务端看到的 Host 都不可靠，
// 只有部署者显式声明的 redirectBase 是权威的。
{
  const oidc = { redirectBase: 'https://sso.example.com' }
  const policy = { trust: false }
  eq('trust=false 时忽略浏览器上报的异源 origin',
    resolveOidcBase(oidc, 'https://evil.example.com', policy), 'https://sso.example.com')
  eq('trust=false 时才信浏览器 origin 也算（开关打开）',
    resolveOidcBase(oidc, 'https://evil.example.com', { trust: true }), 'https://evil.example.com')
  eq('浏览器无上报值时用 redirectBase',
    resolveOidcBase(oidc, undefined, { trust: true }), 'https://sso.example.com')
  eq('浏览器上报非法值时回退 redirectBase',
    resolveOidcBase(oidc, 'not a url', { trust: true }), 'https://sso.example.com')
  eq('浏览器上报带路径的 origin 时回退 redirectBase',
    resolveOidcBase(oidc, 'https://a.example.com/evil/path', { trust: true }), 'https://sso.example.com')
  eq('两者都不可用 → null（调用方 fail-closed）',
    resolveOidcBase({ redirectBase: '' }, undefined, { trust: false }), null)
  eq('未配置且不信任 → null',
    resolveOidcBase({}, 'https://browser.example.com', { trust: false }), null)
  eq('https 的 redirectBase 不被降级',
    resolveOidcBase({ redirectBase: 'https://sso.example.com:8443' }, undefined, { trust: false }),
    'https://sso.example.com:8443')
}

// ---------------------------------------------------------------
console.log('\n— 2. 固定回调路径：只接受裸 origin，路径不可被篡改 —')
// 回调路径是写死的 OIDC_CALLBACK_PATH，base 里塞不进任何东西。
{
  const good = [
    'http://127.0.0.1:13081',
    'https://dsh.example.com',
    'https://dsh.example.com:8443',
    'http://[::1]:3080',
  ]
  for (const v of good) eq('接受裸 origin ' + v, isValidOrigin(v), true)
  const bad = [
    ['带路径', 'https://dsh.example.com/evil'],
    ['带查询', 'https://dsh.example.com/?x=1'],
    ['带片段', 'https://dsh.example.com/#f'],
    ['带 userinfo', 'https://user:pw@dsh.example.com'],
    ['非 http(s) scheme', 'javascript:alert(1)'],
    ['file scheme', 'file:///etc/passwd'],
    ['CRLF 注入', 'https://evil.test/\r\nX-Injected: 1'],
    ['空串', ''],
    ['非字符串', null],
  ]
  for (const [label, v] of bad) eq('拒绝' + label, isValidOrigin(v), false)
}

// ---------------------------------------------------------------
console.log('\n— 3. 反代跳转：回跳目标不得指向内网 —')
// 判定顺序（见 postLoginRedirect）：
//   有 XFH + trust=false + 有配置 origin → 配置 origin；
//   无 XFH 且 Host 是回环 + 有配置 origin → 配置 origin；
//   其余 → 浏览器侧地址（请求 Host 或 XFH）。
{
  const PUB = SEC({ publicBaseUrl: 'https://dsh.example.com:8443' })

  console.log('  · X-Forwarded-Host 优先于被改写的 Host')
  eq('XFH 被采信（Host 已改写为回环）',
    postLoginRedirect(mkCtx(PUB), req({
      host: '127.0.0.1:3080', 'x-forwarded-host': 'dsh.example.com:8443', 'x-forwarded-proto': 'https',
    })), 'https://dsh.example.com:8443/?token=abc')
  eq('RFC 7239 Forwarded host= 亦被采信',
    postLoginRedirect(mkCtx(PUB), req({
      host: '127.0.0.1:3080', forwarded: 'for=1.2.3.4;host=dsh.example.com:8443;proto=https',
    })), 'https://dsh.example.com:8443/?token=abc')

  console.log('  · 无原始头：判为回环，回退配置的确定性 origin')
  eq('Host 为 127.0.0.1 → 用 publicBaseUrl',
    postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080' })),
    'https://dsh.example.com:8443/?token=abc')
  eq('Host 为 localhost → 同上',
    postLoginRedirect(mkCtx(PUB), req({ host: 'localhost:3080' })),
    'https://dsh.example.com:8443/?token=abc')
  eq('Host 为 ::1 → 同上',
    postLoginRedirect(mkCtx(PUB), req({ host: '::1' })),
    'https://dsh.example.com:8443/?token=abc')

  console.log('  · XFH 形状校验：畸形值一律拒收，回退配置')
  const BADXFH = ['evil.example/../x', 'a.com\r\nx-evil: 1', 'not a host', 'host:port:extra']
  for (const v of BADXFH) {
    eq('拒收畸形 XFH ' + JSON.stringify(v),
      postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': v })),
      'https://dsh.example.com:8443/?token=abc')
  }

  console.log('  · 无配置 origin 时不引入新失败态（兜底回环）')
  eq('回环 Host 且无配置 → 用请求 Host',
    postLoginRedirect(mkCtx(SEC({})), req({ host: '127.0.0.1:3080' })),
    'http://127.0.0.1:3080/?token=abc')
}

// ---------------------------------------------------------------
console.log('\n— 4. 浏览器动态跳转：开关语义 —')
// 开关同时约束 OIDC 回调 base 与登录后 token 跳转，两处必须一致。
{
  eq('settings 未配置 → 回退 oidc.trustBrowserOrigin',
    trustedOriginPolicy(mkCtx(undefined), { trustBrowserOrigin: false }).trust, false)
  eq('settings 未配置且 oidc 未声明 → 默认 true（保持旧行为）',
    trustedOriginPolicy(mkCtx(undefined), {}).trust, true)
  eq('settings 显式 false 优先于 oidc',
    trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: false })), { trustBrowserOrigin: true }).trust, false)
  eq('settings 显式 true 优先于 oidc',
    trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: true })), { trustBrowserOrigin: false }).trust, true)

  console.log('  · 动态模式下反代场景：采信浏览器看到的对外地址')
  const policy = trustedOriginPolicy(mkCtx(SEC({ trustBrowserOrigin: true })), {})
  eq('反代下采信浏览器上报的对外 origin',
    resolveOidcBase({ redirectBase: '' }, 'http://127.0.0.1:14080', policy), 'http://127.0.0.1:14080')
  eq('直连时采信自身 origin',
    resolveOidcBase({ redirectBase: '' }, 'http://127.0.0.1:13081', policy), 'http://127.0.0.1:13081')
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
