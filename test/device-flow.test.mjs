/**
 * OAuth 2.1 设备授权（RFC 8628，无回调）端到端验证。
 *
 * 覆盖：authorize → pending → 浏览器批准 → token → Bearer 访问 → 设备列表 →
 * 主动吊销 → Bearer 立即失效；并确认磁盘只存 token 哈希。
 *
 * 运行：node test/device-flow.test.mjs
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { apply as applyPlugin, DATA_DIR } from '../index.js'

let pass = 0, fail = 0
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + name + '  -> ' + JSON.stringify(got)) }
  else { fail++; console.log('  FAIL ' + name + '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)) }
}

const RUNTIME = ['setup-token', 'sessions.jsonl', 'audit.jsonl', 'dsh-webui-auth.json', 'dsh-webui-oauth.json', 'devices.jsonl']
const snapshots = new Map()
for (const f of RUNTIME) {
  const p = join(DATA_DIR, f)
  snapshots.set(p, existsSync(p) ? readFileSync(p) : null)
}
function restore() {
  for (const [p, content] of snapshots) {
    try { if (content === null) { if (existsSync(p)) unlinkSync(p) } else writeFileSync(p, content) } catch (e) { /* ignore */ }
  }
}
for (const f of RUNTIME) { try { unlinkSync(join(DATA_DIR, f)) } catch (e) { /* ignore */ } }

let credsText = null
let oidcText = null
const routes = new Map()
const webServer = {
  port: 3080,
  prefixes: new Map([['/api', {}], ['', {}], ['/plugins', {}]]),
  upgrades: new Map([['/api/remote.mux', {}]]),
  exact: new Map(),
  fallback: undefined,
  register(r) { routes.set(r.path, r); return r },
}
const pathOf = (p) => (typeof p === 'string' ? p : (p && (p.displayPath || p.targetKey)) || '')
const ctx = {
  fs: {
    async resolve(p) { return { displayPath: p } },
    async readText(target) {
      const p = pathOf(target)
      if (p.endsWith('dsh-webui-auth.json')) return credsText
      if (p.endsWith('dsh-webui-oauth.json')) return oidcText
      try { return readFileSync(p, 'utf8') } catch (e) { return null }
    },
    async writeText(target, data) {
      const p = pathOf(target)
      if (p.endsWith('dsh-webui-auth.json')) { credsText = data; return }
      if (p.endsWith('dsh-webui-oauth.json')) { oidcText = data; return }
      writeFileSync(p, data)
    },
  },
  webServer,
  get(ns) {
    if (ns === 'settings') return { get: () => undefined }
    if (ns === 'connection') return { authenticatedUrl: (b) => b + '/?token=launch-token' }
    return undefined
  },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { return fn() },
}

function makeReq(url, headers = {}, body) {
  const listeners = new Map()
  const req = {
    method: 'GET', url,
    headers: { host: '127.0.0.1:3080', 'user-agent': 'device-test', ...headers },
    socket: { remoteAddress: '203.0.113.9' },
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); return req },
  }
  if (body !== undefined) {
    setImmediate(() => {
      for (const fn of listeners.get('data') || []) fn(Buffer.from(String(body)))
      for (const fn of listeners.get('end') || []) fn()
    })
  }
  return req
}
function makeRes() {
  return {
    status: null, headers: {}, body: null,
    writeHead(s, h) { this.status = s; if (h) for (const k of Object.keys(h)) this.headers[k] = h[k] },
    setHeader(k, v) { this.headers[k] = v },
    end(b) { this.body = b },
  }
}
const cookieOf = (res, name) => {
  const sc = res.headers && res.headers['Set-Cookie']
  if (!sc) return null
  for (const one of (Array.isArray(sc) ? sc : [sc])) {
    const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(one)
    if (m) return m[1]
  }
  return null
}
async function call(path, { url, headers, method, body } = {}) {
  const r = makeRes()
  const req = makeReq(url || path, headers || {}, body)
  if (method) req.method = method
  await routes.get(path).handler(req, r)
  let json = null
  try { json = JSON.parse(r.body || '{}') } catch (e) { json = null }
  return { res: r, status: r.status, json, cookie: cookieOf(r, 'dsh_wua_session') }
}
const jsonHeaders = (session) => ({ 'content-type': 'application/json', ...(session ? { cookie: 'dsh_wua_session=' + session } : {}) })

try {
  console.log('— 0. 初始化一个启用认证的实例 —')
  await applyPlugin(ctx)
  const setupToken = readFileSync(join(DATA_DIR, 'setup-token'), 'utf8').trim()
  const setup = await call('/dsh-webui-oauth/setup', {
    url: '/dsh-webui-oauth/setup', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ token: setupToken, username: 'admin', password: 'Admin#Passw0rd!' }),
  })
  eq('初始化成功', setup.json && setup.json.ok, true)
  const browserSession = setup.cookie
  eq('浏览器会话已建立', !!browserSession, true)

  console.log('\n— 1. 设备发起授权 —')
  {
    const noName = await call('/dsh-webui-oauth/device/authorize', {
      url: '/dsh-webui-oauth/device/authorize', method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ client_id: 'dsh-app', scope: 'dsh' }),
    })
    eq('未声明应用名称被拒', noName.json && noName.json.error, 'invalid_request')
  }
  const authz = await call('/dsh-webui-oauth/device/authorize', {
    url: '/dsh-webui-oauth/device/authorize', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ client_id: 'dsh-app', client_name: 'dsh-Go', client_description: 'Flutter 客户端', scope: 'dsh' }),
  })
  eq('authorize 成功', authz.json && typeof authz.json.device_code, 'string')
  eq('返回 user_code', typeof (authz.json && authz.json.user_code), 'string')
  eq('返回 verification_uri', typeof (authz.json && authz.json.verification_uri), 'string')
  const deviceCode = authz.json.device_code
  const userCode = authz.json.user_code

  console.log('\n— 2. 未批准时轮询 —')
  const pending = await call('/dsh-webui-oauth/device/token', {
    url: '/dsh-webui-oauth/device/token', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: 'dsh-app' }),
  })
  eq('返回 authorization_pending', pending.json && pending.json.error, 'authorization_pending')

  console.log('\n— 3. 浏览器批准 —')
  {
    const anonInspect = await call('/dsh-webui-oauth/device/inspect', {
      url: '/dsh-webui-oauth/device/inspect', method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ user_code: userCode }),
    })
    eq('未登录不能查看应用声明（401）', anonInspect.status, 401)
    const inspect = await call('/dsh-webui-oauth/device/inspect', {
      url: '/dsh-webui-oauth/device/inspect', method: 'POST', headers: jsonHeaders(browserSession),
      body: JSON.stringify({ user_code: userCode }),
    })
    eq('批准页能看到应用名称', inspect.json && inspect.json.app, 'dsh-Go')
    eq('批准页能看到应用说明', inspect.json && inspect.json.description, 'Flutter 客户端')
  }
  const anonApprove = await call('/dsh-webui-oauth/device/approve', {
    url: '/dsh-webui-oauth/device/approve', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ user_code: userCode, action: 'approve' }),
  })
  eq('未登录不能批准（401）', anonApprove.status, 401)
  const approve = await call('/dsh-webui-oauth/device/approve', {
    url: '/dsh-webui-oauth/device/approve', method: 'POST', headers: jsonHeaders(browserSession),
    body: JSON.stringify({ user_code: userCode, action: 'approve' }),
  })
  eq('批准成功', approve.json && approve.json.ok, true, approve.res.body)

  console.log('\n— 4. 换 token —')
  const tokenRes = await call('/dsh-webui-oauth/device/token', {
    url: '/dsh-webui-oauth/device/token', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: 'dsh-app' }),
  })
  eq('换到 access_token', typeof (tokenRes.json && tokenRes.json.access_token), 'string')
  const accessToken = tokenRes.json.access_token
  eq('token_type 为 Bearer', tokenRes.json.token_type, 'Bearer')

  console.log('\n— 5. Bearer 独立访问（无 Cookie）—')
  const st = await call('/dsh-webui-oauth/status', { headers: { authorization: 'Bearer ' + accessToken } })
  eq('Bearer 访问 status 成功', st.status, 200, String(st.status))
  eq('status 显示已启用', st.json && st.json.enabled, true)
  eq('设备会话计数为 1', st.json && st.json.deviceSessions, 1)

  console.log('\n— 6. 设备列表 —')
  const list = await call('/dsh-webui-oauth/devices', { headers: { cookie: 'dsh_wua_session=' + browserSession } })
  eq('列表包含 dsh-Go', list.json && list.json.devices && list.json.devices[0] && list.json.devices[0].name, 'dsh-Go')
  eq('保留应用说明', list.json && list.json.devices[0] && list.json.devices[0].description, 'Flutter 客户端')
  eq('记录 HTTP 来源 IP', list.json && list.json.devices[0] && list.json.devices[0].lastIp, '203.0.113.9')
  eq('记录 HTTP 系统字段', typeof (list.json && list.json.devices[0] && list.json.devices[0].os), 'string')
  eq('记录 HTTP 指纹', /^[0-9a-f]{12}$/.test(String(list.json && list.json.devices[0] && list.json.devices[0].fingerprint)), true)
  const deviceId = list.json.devices[0].id

  console.log('\n— 6b. 核心 launch Cookie 桥 —')
  {
    const srv = createServer((req, res) => {
      res.writeHead(303, { 'set-cookie': 'dsh-auth-test=abc123; Path=/; HttpOnly; SameSite=Strict' })
      res.end()
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    webServer.port = srv.address().port

    const bridge = await call('/dsh-webui-oauth/device/core-session', {
      url: '/dsh-webui-oauth/device/core-session', method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken },
    })
    eq('桥接成功', bridge.json && bridge.json.ok, true, bridge.res.body)
    eq('返回核心 Cookie 名', bridge.json && bridge.json.cookie_name, 'dsh-auth-test')
    eq('返回 Cookie 值', bridge.json && bridge.json.cookie_value, 'abc123')
    eq('返回 authority', bridge.json && bridge.json.authority, '127.0.0.1:3080')

    const noBearer = await call('/dsh-webui-oauth/device/core-session', {
      url: '/dsh-webui-oauth/device/core-session', method: 'POST',
      headers: jsonHeaders(browserSession),
    })
    eq('浏览器 Cookie 不能调用桥（401）', noBearer.status, 401)

    await new Promise((resolve) => srv.close(resolve))
    webServer.port = 3080
  }

  console.log('\n— 6c. 设备 Bearer 不能做设备管理 —')
  {
    const bearerList = await call('/dsh-webui-oauth/devices', {
      headers: { authorization: 'Bearer ' + accessToken },
    })
    eq('设备 Bearer 不能列出设备（401）', bearerList.status, 401)
    const bearerRevoke = await call('/dsh-webui-oauth/devices/revoke', {
      url: '/dsh-webui-oauth/devices/revoke', method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ id: deviceId }),
    })
    eq('设备 Bearer 不能吊销设备（401）', bearerRevoke.status, 401)
    const bearerApprove = await call('/dsh-webui-oauth/device/approve', {
      url: '/dsh-webui-oauth/device/approve', method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ user_code: 'AAAA-AAAA', action: 'approve' }),
    })
    eq('设备 Bearer 不能批准新设备（401）', bearerApprove.status, 401)
  }

  console.log('\n— 7. 主动吊销 —')
  const revoke = await call('/dsh-webui-oauth/devices/revoke', {
    url: '/dsh-webui-oauth/devices/revoke', method: 'POST', headers: jsonHeaders(browserSession),
    body: JSON.stringify({ id: deviceId }),
  })
  eq('吊销成功', revoke.json && revoke.json.ok, true, revoke.res.body)
  const after = await call('/dsh-webui-oauth/status', { headers: { authorization: 'Bearer ' + accessToken } })
  eq('吊销后 Bearer 立即 401', after.status, 401, String(after.status))

  console.log('\n— 8. 磁盘只存哈希、device_code 单次使用 —')
  const disk = existsSync(join(DATA_DIR, 'devices.jsonl')) ? readFileSync(join(DATA_DIR, 'devices.jsonl'), 'utf8') : ''
  eq('磁盘不含明文 token', disk.includes(accessToken), false)
  eq('磁盘含 sha256 哈希字段', /"hash":"[0-9a-f]{64}"/.test(disk), true)
  const replay = await call('/dsh-webui-oauth/device/token', {
    url: '/dsh-webui-oauth/device/token', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: 'dsh-app' }),
  })
  eq('device_code 不可重放', replay.json && replay.json.error, 'invalid_grant')
} finally {
  restore()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
