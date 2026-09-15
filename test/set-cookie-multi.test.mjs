/**
 * 验证 sendJson 的多值 Set-Cookie 在【真实 node:http 响应】中的行为。
 *
 * 背景：OIDC 回调成功时必须同时下发会话 Cookie 与清除一次性 state Cookie。
 * Set-Cookie 是唯一允许重复的响应头，而插件内部用普通对象合并——若实现不当，
 * 两条会互相覆盖，表现为"登录成功却没有会话"（浏览器拿不到 dsh_wua_session）。
 *
 * 这里起一个真实 HTTP 服务器，直接观察客户端收到的 set-cookie 头。
 *
 * 运行：node test/set-cookie-multi.test.mjs
 */
import http from 'node:http'
import { sendJson } from '../index.js'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

const server = http.createServer((req, res) => {
  if (req.url === '/single') {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'a=1; Path=/' })
    return
  }
  if (req.url === '/multi') {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': ['sess=abc; Path=/', 'state=; Max-Age=0'] })
    return
  }
  if (req.url === '/none') {
    sendJson(res, 200, { ok: true })
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

async function get(path) {
  const res = await fetch(base + path)
  // undici 把重复的 set-cookie 以数组形式暴露在 getSetCookie()
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  return { status: res.status, cookies, body: await res.json() }
}

console.log('\n— 单条 Set-Cookie —')
{
  const r = await get('/single')
  eq('收到 1 条', r.cookies.length === 1, JSON.stringify(r.cookies))
  eq('内容正确', r.cookies[0] === 'a=1; Path=/', JSON.stringify(r.cookies))
}

console.log('\n— 两条 Set-Cookie 必须都送达 —')
{
  const r = await get('/multi')
  eq('收到 2 条', r.cookies.length === 2, JSON.stringify(r.cookies))
  eq('含会话 Cookie', r.cookies.some((c) => c.startsWith('sess=abc')), JSON.stringify(r.cookies))
  eq('含清除 state Cookie', r.cookies.some((c) => c.startsWith('state=;')), JSON.stringify(r.cookies))
}

console.log('\n— 无 Set-Cookie 时不误发 —')
{
  const r = await get('/none')
  eq('没有 Set-Cookie', r.cookies.length === 0, JSON.stringify(r.cookies))
  eq('其他头仍在', r.status === 200, String(r.status))
}

server.close()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
