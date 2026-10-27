/**
 * 路由闸门：默认拒绝（白名单）回归测试。
 *
 * 背景（真实事故）：0.6.6 及以前，闸门只包装 /api 与 /plugins——那是一份黑名单。
 * 第三方插件注册的 exact/prefix 路由比本插件的 "" 前缀更具体，会在路由匹配时
 * 抢先命中，于是完全绕过鉴权。实测未登录即可读取：
 *   - /dsh-550c-boot/update         （版本 / 镜像指纹）
 *   - /dsh-any-background/font      （用户上传字体，12MB）
 *   - /dsh-any-background/wallpaper （用户壁纸）
 * 而写端点因为走 connection RPC 通道反而 401 —— "写保护、读裸奔"。
 *
 * 本测试锁定修复后的语义：**默认拒绝一切路由，只放行显式白名单**。
 * 新增插件路由即使不改本仓库代码，也必须自动被闸门覆盖。
 *
 * 运行：node test/gate-default-deny.test.mjs   （或 npm test）
 */
import {
  installRouteGate, matchesPublicPath, PUBLIC_EXACT_PATHS, SELF_GATED_EXACT_PATHS,
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

// ---------------- 宿主桩 ----------------
function makeWebServer() {
  return {
    exact: new Map(),
    prefixes: new Map(),
    upgrades: new Map(),
    fallback: undefined,
    registerFallback(handler) {
      if (this.fallback !== undefined) throw new Error('fallback already registered')
      this.fallback = handler
      return () => { this.fallback = undefined }
    },
  }
}

/** 造一个"任意插件注册的路由"骨架。 */
const route = (kind, path, reply = 200) => ({
  kind,
  path,
  handler: async (req, res) => {
    res.writeHead(reply, { 'content-type': 'text/plain' })
    res.end('ok:' + path)
  },
})

function makeRes() {
  return {
    status: null, headers: {}, body: null,
    writeHead(s, h) { this.status = s; if (h) for (const k of Object.keys(h)) this.headers[k] = h[k] },
    end(b) { this.body = b === undefined ? '' : String(b) },
  }
}
const anon = (extra = {}) => ({ method: 'GET', url: '/', headers: { ...extra }, socket: {} })
const authed = () => ({ method: 'GET', url: '/', headers: { cookie: 'dsh_wua_session=sid-ok' }, socket: {} })
const checkRequest = (req) => req.headers.cookie === 'dsh_wua_session=sid-ok'

function makeCtx(webServer, settingsSection) {
  return {
    webServer,
    get(ns) {
      if (ns === 'settings') return { get: () => settingsSection }
      if (ns === 'connection') return undefined
      return undefined
    },
    logger: { info() {}, warn() {}, error() {} },
  }
}

// ---------------- 1. 纯函数：公开路径匹配 ----------------
console.log('— 1. 公开路径匹配（精确 + /* 前缀）—')
eq('精确命中', matchesPublicPath('/oauth/callback', ['/oauth/callback']), true)
eq('精确不命中前缀', matchesPublicPath('/oauth/callback/x', ['/oauth/callback']), false)
eq('前缀命中子路径', matchesPublicPath('/api/webhooks/github', ['/api/webhooks/*']), true)
eq('前缀命中自身', matchesPublicPath('/api/webhooks', ['/api/webhooks/*']), true)
eq('前缀不误伤同名前缀', matchesPublicPath('/api/webhooksx', ['/api/webhooks/*']), false)
eq('空模式列表一律不命中', matchesPublicPath('/x', []), false)
eq('空路径不命中', matchesPublicPath('', ['/a']), false)

// ---------------- 2. 预先注册的路由：安装时即被包 ----------------
console.log('\n— 2. 已注册的第三方读接口必须被默认拒绝 —')
{
  const ws = makeWebServer()
  // 用户实际报告的三个裸奔端点
  const update = route('exact', '/dsh-550c-boot/update')
  const font = route('exact', '/dsh-any-background/font')
  const wallpaper = route('exact', '/dsh-any-background/wallpaper')
  const upload = route('exact', '/dsh-any-background/font/upload')
  // 核心
  const api = route('prefix', '/api')
  const plugins = route('prefix', '/plugins')
  // 第三方前缀（启动动画、RPC 通道）
  const ueg = route('prefix', '/ueg')
  const bg = route('prefix', '/dsh-any-background')
  // 本插件自己的路由（自管）
  const login = route('exact', '/dsh-webui-oauth/login')
  const loginOrig = login.handler
  const configure = route('exact', '/dsh-webui-oauth/configure')
  const configureOrig = configure.handler
  // 账号平台 OAuth 回跳
  const oauthCb = route('exact', '/oauth/callback')
  const oauthOrig = oauthCb.handler

  for (const r of [update, font, wallpaper, upload, login, configure, oauthCb]) ws.exact.set(r.path, r)
  for (const r of [api, plugins, ueg, bg]) ws.prefixes.set(r.path, r)
  ws.upgrades.set('/api/remote.mux', route('upgrade', '/api/remote.mux'))
  ws.upgrades.set('/third-party/ws', route('upgrade', '/third-party/ws'))
  ws.fallback = async (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok:fallback') }

  const gate = installRouteGate(makeCtx(ws, undefined), checkRequest, () => {})

  eq('闸门判定为 ok（/api 与 /plugins 均就位）', gate.ok(), true)

  const call = async (r, req = anon()) => {
    const res = makeRes()
    await r.handler(req, res)
    return res
  }

  console.log('  · 匿名读：全部 401')
  for (const r of [update, font, wallpaper, upload, ueg, bg, api, plugins]) {
    const res = await call(r)
    eq('匿名访问 ' + r.path + ' 被拒', res.status, 401)
  }

  console.log('  · 已登录：正常放行')
  for (const r of [update, font, wallpaper, upload, ueg, bg, api, plugins]) {
    const res = await call(r, authed())
    eq('已登录访问 ' + r.path + ' 放行', res.status, 200)
  }

  console.log('  · 公开白名单：匿名放行')
  eq('登录页匿名可访问', (await call(login)).status, 200)
  eq('OAuth 回跳匿名可访问', (await call(oauthCb)).status, 200)

  console.log('  · 本插件自管端点：不套通用闸门（内部自行鉴权）')
  eq('login 未被通用闸门替换', login.handler, loginOrig)
  eq('configure 未被通用闸门替换（其 handler 自带 checkRequest）', configure.handler, configureOrig)
  eq('oauth/callback 未被替换（属公开白名单）', oauthCb.handler, oauthOrig)

  console.log('  · fallback 也必须上闸门')
  eq('匿名落到 fallback 被拒', (await call({ handler: ws.fallback })).status, 401)
  eq('已登录落到 fallback 放行', (await call({ handler: ws.fallback }, authed())).status, 200)

  console.log('  · WebSocket upgrade：全部拒绝，不再只认 /api/*')
  {
    const socket = { writes: [], destroyed: false, write(s) { this.writes.push(s) }, destroy() { this.destroyed = true } }
    ws.upgrades.get('/third-party/ws').handler(anon(), socket, null)
    eq('匿名第三方 upgrade 被拒（写入 401）', /401 Unauthorized/.test(socket.writes.join('')), true)
    eq('匿名 upgrade 连接被销毁', socket.destroyed, true)
  }
  {
    const socket = { writes: [], destroyed: false, write(s) { this.writes.push(s) }, destroy() { this.destroyed = true } }
    let reached = false
    ws.upgrades.get('/third-party/ws').handler(authed(), socket, null)
    // 原始 handler 是骨架 route()，签名是 (req,res)；这里只说明确实没被 401 拦。
    eq('已登录 upgrade 未被闸门拒绝', /401 Unauthorized/.test(socket.writes.join('')), false)
  }

  console.log('  · 统计信息可供 status 回显')
  const st = gate.stats()
  eq('报告了包装的 exact 数量', st.wrappedExact >= 4, true)
  eq('报告了包装的 prefix 数量', st.wrappedPrefix >= 4, true)
  eq('报告了包装的 upgrade 数量', st.wrappedUpgrade, 2)
  eq('报告了 fallback 已包装', st.wrappedFallback, 1)

  gate.undo()
}

// ---------------- 3. 安装之后才注册的路由：注册即上闸门 ----------------
console.log('\n— 3. 晚注册的路由不能有窗口期 —')
{
  const ws = makeWebServer()
  ws.prefixes.set('/api', route('prefix', '/api'))
  ws.prefixes.set('/plugins', route('prefix', '/plugins'))
  ws.upgrades.set('/api/remote.mux', route('upgrade', '/api/remote.mux'))

  const gate = installRouteGate(makeCtx(ws, undefined), checkRequest, () => {})

  // 模拟插件热加载：安装之后才 register
  const late = route('exact', '/dsh-late-plugin/secret')
  ws.exact.set(late.path, late)          // 走被接管的 Map#set
  const res = makeRes()
  await late.handler(anon(), res)
  eq('晚注册的 exact 路由立即被拒（无 2s 窗口）', res.status, 401)

  const latePrefix = route('prefix', '/late-prefix')
  ws.prefixes.set(latePrefix.path, latePrefix)
  const res2 = makeRes()
  await latePrefix.handler(anon(), res2)
  eq('晚注册的 prefix 路由立即被拒', res2.status, 401)

  const lateWs = route('upgrade', '/late-ws')
  ws.upgrades.set(lateWs.path, lateWs)
  const socket = { writes: [], destroyed: false, write(s) { this.writes.push(s) }, destroy() { this.destroyed = true } }
  lateWs.handler(anon(), socket, null)
  eq('晚注册的 upgrade 立即被拒', /401 Unauthorized/.test(socket.writes.join('')), true)

  // 晚注册的 fallback 同样上闸门
  ws.registerFallback(async (req, res) => { res.writeHead(200); res.end('fb') })
  const res3 = makeRes()
  await ws.fallback(anon(), res3)
  eq('晚注册的 fallback 被拒', res3.status, 401)

  gate.undo()
}

// ---------------- 4. 部署方追加白名单 ----------------
console.log('\n— 4. 部署方可追加公开路径（webhook 等机器调用）—')
{
  const ws = makeWebServer()
  ws.prefixes.set('/api', route('prefix', '/api'))
  ws.prefixes.set('/plugins', route('prefix', '/plugins'))
  ws.upgrades.set('/api/remote.mux', route('upgrade', '/api/remote.mux'))

  const hook = route('exact', '/api/webhooks/github')
  const other = route('exact', '/api/webhooks/other')
  ws.exact.set(hook.path, hook)
  ws.exact.set(other.path, other)

  const gate = installRouteGate(
    makeCtx(ws, { publicPaths: ['/api/webhooks/github'] }),
    checkRequest, () => {})

  const res = makeRes()
  await hook.handler(anon(), res)
  eq('显式放行的 webhook 匿名可达', res.status, 200)

  const res2 = makeRes()
  await other.handler(anon(), res2)
  eq('未显式放行的相邻路径仍被拒', res2.status, 401)

  eq('status 回显放行清单', gate.stats().publicPaths.includes('/api/webhooks/github'), true)

  gate.undo()
}

// ---------------- 4b. 配置热更新：新增公开路径会解包已包装的路由 ----------------
console.log('\n— 4b. 配置热更新（publicPaths 追加）—')
{
  const ws = makeWebServer()
  ws.prefixes.set('/api', route('prefix', '/api'))
  ws.prefixes.set('/plugins', route('prefix', '/plugins'))
  ws.upgrades.set('/api/remote.mux', route('upgrade', '/api/remote.mux'))
  const secret = route('exact', '/late/public')
  ws.exact.set(secret.path, secret)

  // 同一个对象被 mutate，模拟 settings 热更新
  const settings = { publicPaths: [] }
  const gate = installRouteGate(makeCtx(ws, settings), checkRequest, () => {})

  let res = makeRes()
  await secret.handler(anon(), res)
  eq('未声明前匿名被拒', res.status, 401)
  eq('未声明前计入已包装', gate.stats().wrappedExact, 1)

  settings.publicPaths = ['/late/public']
  gate.refresh()

  res = makeRes()
  await secret.handler(anon(), res)
  eq('声明后匿名放行（无需重启）', res.status, 200)
  eq('解包后不再计入已包装', gate.stats().wrappedExact, 0)

  gate.undo()
}

// ---------------- 5. 卸载可逆 ----------------
console.log('\n— 5. undo 必须完全可逆 —')
{
  const ws = makeWebServer()
  const api = route('prefix', '/api')
  const original = api.handler
  ws.prefixes.set('/api', api)
  ws.prefixes.set('/plugins', route('prefix', '/plugins'))
  ws.upgrades.set('/api/remote.mux', route('upgrade', '/api/remote.mux'))
  const originalSet = ws.exact.set

  const gate = installRouteGate(makeCtx(ws, undefined), checkRequest, () => {})
  eq('安装后 handler 被替换', api.handler !== original, true)

  gate.undo()
  eq('undo 后 handler 复原', api.handler, original)
  eq('undo 后 Map#set 复原', ws.exact.set, originalSet)
}

// ---------------- 6. 常量自检 ----------------
console.log('\n— 6. 白名单常量自检 —')
eq('登录页在公开清单', PUBLIC_EXACT_PATHS.has('/dsh-webui-oauth/login'), true)
eq('登录页在自管清单', SELF_GATED_EXACT_PATHS.has('/dsh-webui-oauth/login'), true)
eq('configure 不得出现在公开清单', PUBLIC_EXACT_PATHS.has('/dsh-webui-oauth/configure'), false)
eq('status 不得出现在公开清单', PUBLIC_EXACT_PATHS.has('/dsh-webui-oauth/status'), false)
eq('公开清单不含通配前缀 /api', PUBLIC_EXACT_PATHS.has('/api'), false)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
