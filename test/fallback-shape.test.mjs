/**
 * webServer fallback 形状兼容（0.2.2-rc.1 回归）。
 *
 * 背景：dsh 0.2.2-rc.1 把 fallback 从「函数」改成了 `{ resource }`
 * （dsh-host-frontend-static 就是这样注册的）。插件旧代码直接
 * `await fallback(req, res)` → TypeError: fallback is not a function，
 * 被外层 catch 兜成 500 + 空 body，nginx 访问日志表现为 `500 0`。
 *
 * 本测试锁定三种形状都能被正确分派；没有 fallback 时必须返回 false
 * （由调用方 404），绝不能再把"形状不匹配"误报成 500。
 *
 * 运行：node test/fallback-shape.test.mjs   （或 npm test）
 */
import { serveFallback, installRouteGate } from '../index.js'

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

const req = (url = '/', headers = {}) => ({ method: 'GET', url, headers, socket: {} })
const res = () => ({
  status: null, headers: {}, body: null,
  writeHead(s, h) { this.status = s; if (h) for (const k of Object.keys(h)) this.headers[k] = h[k] },
  end(b) { this.body = b === undefined ? '' : String(b) },
})

// ---------------- 1. 三种形状都能分派 ----------------
console.log('— 1. fallback 形状分派 —')
{
  // ① 函数（旧核心）
  let called = 0
  const ctxFn = { webServer: { fallback: async (q, r) => { called++; r.writeHead(200); r.end('fn') } } }
  const r1 = res()
  eq('函数 fallback 被识别', await serveFallback(ctxFn, req('/'), r1), true)
  eq('函数 fallback 被调用', called, 1)
  eq('函数 fallback 正常响应', r1.status, 200)

  // ② { resource } + serveResource（0.2.2-rc.1）
  let served = null
  const ctxRes = {
    webServer: {
      fallback: { resource: async () => new Response('index') },
      serveResource: async (q, r, target, resource) => { served = { target: String(target), resource }; r.writeHead(200); r.end('resource') },
    },
  }
  const r2 = res()
  eq('{ resource } 被识别', await serveFallback(ctxRes, req('/x?y=1'), r2), true)
  eq('交给 serveResource 的路径正确', served && served.target, 'http://x/x?y=1')
  eq('resource 原样传入', typeof (served && served.resource), 'function')
  eq('响应来自 serveResource', r2.status, 200)

  // ③ { handler }
  let handlerCalled = 0
  const ctxHandler = { webServer: { fallback: { handler: async (q, r) => { handlerCalled++; r.writeHead(204); r.end() } } } }
  const r3 = res()
  eq('{ handler } 被识别', await serveFallback(ctxHandler, req('/'), r3), true)
  eq('{ handler } 被调用', handlerCalled, 1)
  eq('{ handler } 响应正确', r3.status, 204)

  // ④ 没有 fallback
  eq('无 fallback 返回 false（调用方 404）', await serveFallback({ webServer: {} }, req('/'), res()), false)
  // ⑤ 形状不认识
  eq('未知形状返回 false，不抛异常', await serveFallback({ webServer: { fallback: { nope: 1 } } }, req('/'), res()), false)
  // ⑥ { resource } 但核心没有 serveResource
  eq('缺 serveResource 时返回 false，不抛 TypeError', await serveFallback({ webServer: { fallback: { resource: async () => new Response('x') } } }, req('/'), res()), false)
}

// ---------------- 2. 闸门必须覆盖 resource fallback ----------------
console.log('\n— 2. 资源型 fallback 也要上闸门 —')
{
  // 每个用例用全新的 webServer：同一个实例上叠两个闸门会让拒绝分支先命中，
  // 测出来的是"两层包装串联"，不是我们想验证的单层语义。
  const makeWs = () => {
    const ws = {
      exact: new Map(), prefixes: new Map(), upgrades: new Map(),
      fallback: {
        resource: async (request) => new Response('index', { status: 200, headers: { 'content-type': 'text/html' } }),
      },
      serveResource: async (q, r, target, resource) => {
        const response = await resource(new Request(target, { method: q.method, headers: q.headers }))
        r.writeHead(response.status, Object.fromEntries(response.headers))
        r.end(await response.text())
      },
      registerFallback(f) { this.fallback = f },
    }
    ws.prefixes.set('/api', { kind: 'prefix', path: '/api', handler: async (q, r) => { r.writeHead(200); r.end() } })
    ws.prefixes.set('/plugins', { kind: 'prefix', path: '/plugins', handler: async (q, r) => { r.writeHead(200); r.end() } })
    ws.upgrades.set('/api/remote.mux', { kind: 'upgrade', path: '/api/remote.mux', handler: () => {} })
    return ws
  }
  const ctxOf = (ws) => ({ webServer: ws, get: () => undefined, logger: { info() {}, warn() {}, error() {} } })

  // 匿名
  const ws1 = makeWs()
  const gate1 = installRouteGate(ctxOf(ws1), () => false, () => {})
  const r1 = res()
  await ws1.serveResource(req('/some/spa/route', { cookie: 'x' }), r1, new URL('/some/spa/route', 'http://x'), ws1.fallback.resource)
  eq('匿名访问资源型 fallback 被拒', r1.status, 401)
  eq('响应体为 unauthorized', String(r1.body).trim(), 'unauthorized')
  gate1.undo()

  // 已登录
  const ws2 = makeWs()
  const gate2 = installRouteGate(ctxOf(ws2), () => true, () => {})
  const r2 = res()
  await ws2.serveResource(req('/some/spa/route', { cookie: 'ok' }), r2, new URL('/some/spa/route', 'http://x'), ws2.fallback.resource)
  eq('已登录可通过资源型 fallback', r2.status, 200)
  eq('返回 index', String(r2.body), 'index')
  gate2.undo()

  // undo 必须把 resource 还原成原函数
  const ws3 = makeWs()
  const original = ws3.fallback.resource
  const gate3 = installRouteGate(ctxOf(ws3), () => true, () => {})
  eq('安装后 resource 被替换', ws3.fallback.resource !== original, true)
  gate3.undo()
  eq('undo 后 resource 复原', ws3.fallback.resource, original)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
