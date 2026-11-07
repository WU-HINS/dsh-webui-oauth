/**
 * 完整生命周期验证：首次初始化 → 登录 → 改配置 → 禁用 → 重新启用 → 退出。
 *
 * 与 oidc-bind / oidc-integration 不同，这里从**没有任何凭据**的首次启动开始，
 * 走 /setup 的 setup-token 流程，再到 /login、/configure、/disable、/logout。
 *
 * 运行：node test/lifecycle.test.mjs
 */
import { mkdtempSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyPlugin, DATA_DIR, configPath, oidcConfigPath } from '../index.js'

let pass = 0, fail = 0
function eq(name, got, want) {
  if (got === want) {
    pass++
    console.log('  ok   ' + name + '  -> ' + JSON.stringify(got))
  } else {
    fail++
    console.log('  FAIL ' + name + '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))
  }
}

// 运行时文件保护：测试对工作区零副作用
const RUNTIME = ['setup-token', 'sessions.jsonl', 'audit.jsonl', 'dsh-webui-auth.json', 'dsh-webui-oauth.json']
const snapshots = new Map()
for (const f of RUNTIME) {
  const p = join(DATA_DIR, f)
  snapshots.set(p, existsSync(p) ? readFileSync(p) : null)
}
function restore() {
  for (const [p, content] of snapshots) {
    try { if (content === null) { if (existsSync(p)) unlinkSync(p) } else writeFileSync(p, content) } catch (e) { /* best effort */ }
  }
}

// 干净起点
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
    if (ns === 'connection') return { authenticatedUrl: (b) => b + '/?token=launch' }
    return undefined
  },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { return fn() },
}

function makeReq(url, headers = {}, body) {
  const listeners = new Map()
  const req = {
    method: 'GET', url,
    headers: { host: '127.0.0.1:3080', 'user-agent': 'lifecycle', ...headers },
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
  return { res: r, status: r.status, json, location: r.headers.location, cookie: cookieOf(r, 'dsh_wua_session') }
}
const jsonHeaders = (session) => ({ 'content-type': 'application/json', ...(session ? { cookie: 'dsh_wua_session=' + session } : {}) })

try {
  console.log('— 1. 首次启动：无凭据、进入 setup 模式 —')
  await applyPlugin(ctx)
  const tokenPath = join(DATA_DIR, 'setup-token')
  eq('生成 setup-token 文件', existsSync(tokenPath), true)
  const setupToken = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : ''
  eq('setup-token 非空', setupToken.length > 0, true)
  const loginPage = await call('/dsh-webui-oauth/login', { url: '/dsh-webui-oauth/login' })
  eq('登录页处于 setup 模式', /MODE = "setup"/.test(String(loginPage.res.body)), true)

  console.log('\n— 2. 初始化管理员（setup token + 强密码）—')
  const weak = await call('/dsh-webui-oauth/setup', {
    url: '/dsh-webui-oauth/setup', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ token: setupToken, username: 'admin', password: 'short' }),
  })
  eq('弱密码被拒', weak.json && weak.json.error, 'weak-password')

  const setup = await call('/dsh-webui-oauth/setup', {
    url: '/dsh-webui-oauth/setup', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ token: setupToken, username: 'admin', password: 'Admin#Passw0rd!' }),
  })
  eq('初始化成功', setup.json && setup.json.ok, true, setup.res.body)
  eq('下发会话 Cookie', !!setup.cookie, true)
  eq('setup-token 已删除', existsSync(tokenPath), false)

  const s1 = setup.cookie
  const st1 = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + s1 } })
  eq('status：认证已启用', st1.json && st1.json.enabled, true)

  console.log('\n— 3. 密码登录 —')
  const login = await call('/dsh-webui-oauth/login', {
    url: '/dsh-webui-oauth/login', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ username: 'admin', password: 'Admin#Passw0rd!' }),
  })
  eq('密码登录成功', login.json && login.json.ok, true, login.res.body)
  eq('登录下发新会话', !!login.cookie, true)
  const s2 = login.cookie

  console.log('\n— 3b. 吊销所有其他浏览器会话 —')
  const login2 = await call('/dsh-webui-oauth/login', {
    url: '/dsh-webui-oauth/login', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ username: 'admin', password: 'Admin#Passw0rd!' }),
  })
  const sExtra = login2.cookie
  eq('再建立一个会话', !!sExtra, true)

  const revokeBad = await call('/dsh-webui-oauth/sessions/revoke', {
    url: '/dsh-webui-oauth/sessions/revoke', method: 'POST', headers: jsonHeaders(s2),
    body: JSON.stringify({ current: 'wrong' }),
  })
  eq('错误密码不能吊销', revokeBad.json && revokeBad.json.error, 'current-invalid')

  const revoke = await call('/dsh-webui-oauth/sessions/revoke', {
    url: '/dsh-webui-oauth/sessions/revoke', method: 'POST', headers: jsonHeaders(s2),
    body: JSON.stringify({ current: 'Admin#Passw0rd!' }),
  })
  eq('吊销成功', revoke.json && revoke.json.ok, true, revoke.res.body)
  eq('至少吊销一个其他会话', revoke.json && revoke.json.revoked >= 1, true)

  const otherSt = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + sExtra } })
  eq('其他会话已失效（401）', otherSt.status, 401, String(otherSt.status))
  const keepSt = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + s2 } })
  eq('当前会话保持有效', keepSt.status, 200, String(keepSt.status))

  console.log('\n— 4. 修改配置（当前密码验证 + TTL）—')
  const conf = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: jsonHeaders(s2),
    body: JSON.stringify({ username: 'admin', current: 'Admin#Passw0rd!', ttl: 24 }),
  })
  eq('配置保存成功', conf.json && conf.json.ok, true, conf.res.body)
  const st2 = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + s2 } })
  eq('TTL 已更新为 24', st2.json && st2.json.ttl, 24)

  console.log('\n— 5. 禁用认证 —')
  const badDisable = await call('/dsh-webui-oauth/disable', {
    url: '/dsh-webui-oauth/disable', method: 'POST', headers: jsonHeaders(s2),
    body: JSON.stringify({ current: 'wrong' }),
  })
  eq('错误密码不能禁用', badDisable.json && badDisable.json.error, 'current-invalid')
  const dis = await call('/dsh-webui-oauth/disable', {
    url: '/dsh-webui-oauth/disable', method: 'POST', headers: jsonHeaders(s2),
    body: JSON.stringify({ current: 'Admin#Passw0rd!' }),
  })
  eq('禁用成功', dis.json && dis.json.ok, true, dis.res.body)
  const st3 = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + s2 } })
  eq('status：认证已禁用', st3.json && st3.json.enabled, false)

  console.log('\n— 6. 禁用状态下重新启用 —')
  const reenable = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ username: 'admin', password: 'Admin#Passw0rd!', ttl: 12 }),
  })
  eq('重新启用成功', reenable.json && reenable.json.ok, true, reenable.res.body)
  eq('重新启用后下发会话', !!reenable.cookie, true)
  const s3 = reenable.cookie

  console.log('\n— 7. 退出登录 —')
  const out = await call('/dsh-webui-oauth/logout', {
    url: '/dsh-webui-oauth/logout', method: 'POST', headers: jsonHeaders(s3),
  })
  eq('退出成功', out.json && out.json.ok, true, out.res.body)
  const st4 = await call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + s3 } })
  eq('退出后会话失效（401）', st4.status, 401, String(st4.status))
} finally {
  restore()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
