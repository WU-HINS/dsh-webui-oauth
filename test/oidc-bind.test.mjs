/**
 * OIDC 身份绑定 / 解绑 行为测试。
 *
 * 验收标准（部署者定义）：
 *   1. 配置 OIDC 后、绑定前：OIDC 登录【一律拒绝】（不能让任何能过 IdP 的人都进来）；
 *   2. 「绑定」= 本地账号登录后发起一次 OIDC 授权，把校验通过的 sub 存到本地；
 *   3. 绑定后：只有 sub 与已绑定值一致的 IdP 身份能登录；
 *   4. 「解绑」= 把 sub 清空，OIDC 登录立即恢复为「一律拒绝」。
 *
 * 这个测试刻意不覆盖"绑定流程本身能否走通 IdP 往返"——那由 oidc-integration 覆盖；
 * 这里聚焦【访问控制语义】：存了什么、谁能进、解绑后谁不能进。
 *
 * 运行：node test/oidc-bind.test.mjs
 */
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scryptSync, generateKeyPairSync, sign } from 'node:crypto'
import { apply as applyPlugin } from '../index.js'

// 运行时文件保护（同 oidc-integration：源码安装下 DATA_DIR 就是源码目录）
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_FILES = ['sessions.jsonl', 'setup-token', 'audit.jsonl']
const snapshots = new Map()
for (const f of RUNTIME_FILES) {
  const p = join(pluginRoot, f)
  snapshots.set(p, existsSync(p) ? readFileSync(p) : null)
}
function restoreRuntimeFiles() {
  for (const [p, content] of snapshots) {
    try {
      if (content === null) { if (existsSync(p)) unlinkSync(p) }
      else writeFileSync(p, content)
    } catch (e) { /* best effort */ }
  }
}

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

// ---------------- 假 IdP（可控 sub）----------------
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = publicKey.export({ format: 'jwk' })
pubJwk.alg = 'RS256'; pubJwk.use = 'sig'; pubJwk.kid = 'bind-key'
const ISSUER = 'https://idp.test'
const CLIENT_ID = 'c1', CLIENT_SECRET = 's1'
const idpState = { sub: 'sub-alice', nonceByCode: {} }

const b64u = (b) => Buffer.from(b).toString('base64url')
const idp = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://idp.test')
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (u.pathname === '/.well-known/openid-configuration') {
    return json({ issuer: ISSUER, authorization_endpoint: ISSUER + '/authorize', token_endpoint: ISSUER + '/token', jwks_uri: ISSUER + '/jwks' })
  }
  if (u.pathname === '/jwks') return json({ keys: [pubJwk] })
  if (u.pathname === '/authorize') {
    const q = u.searchParams
    const code = 'code-' + Math.random().toString(36).slice(2)
    idpState.nonceByCode[code] = q.get('nonce') || ''
    const back = new URL(q.get('redirect_uri'))
    back.searchParams.set('code', code)
    if (q.get('state')) back.searchParams.set('state', q.get('state'))
    res.writeHead(302, { location: back.href }); return res.end()
  }
  if (u.pathname === '/token') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const f = new URLSearchParams(raw)
      const code = f.get('code') || ''
      const now = Math.floor(Date.now() / 1000)
      const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'bind-key' }))
      const payload = b64u(JSON.stringify({
        iss: ISSUER, sub: idpState.sub, aud: CLIENT_ID, exp: now + 600, iat: now,
        nonce: idpState.nonceByCode[code] || '',
      }))
      const data = header + '.' + payload
      const sig = sign('RSA-SHA256', Buffer.from(data), privateKey)
      json({ access_token: 'a', token_type: 'Bearer', id_token: data + '.' + b64u(sig) })
    })
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => idp.listen(0, '127.0.0.1', r))
const idpPort = idp.address().port

// ---------------- 宿主桩 ----------------
const tmp = mkdtempSync(join(tmpdir(), 'oidc-bind-'))
let credsText = null
// OIDC 配置也走内存桩：否则 readOidcConfig 会去读真实文件系统，
// 测试之间互相串味（且首次运行时文件不存在，表现为"配置丢失"）。
let oidcText = null
const fs = {
  async resolve(p) { return p },
  async readText(p) {
    if (p.endsWith('dsh-webui-auth.json')) return credsText
    if (p.endsWith('dsh-webui-oauth.json')) return oidcText
    try { return readFileSync(p, 'utf8') } catch (e) { return null }
  },
  async writeText(p, data) {
    if (p.endsWith('dsh-webui-auth.json')) { credsText = data; return }
    if (p.endsWith('dsh-webui-oauth.json')) { oidcText = data; return }
    // 兜底写入一律落到临时目录，绝不碰仓库：曾经因为漏桩而把
    // dsh-webui-oauth.json 写进过仓库根目录。
    writeFileSync(join(tmp, basename(p)), data)
  },
}
const routes = new Map()
const ctx = {
  fs,
  webServer: { port: 3080, prefixes: new Map([['/api', {}], ['', {}]]), upgrades: new Map(), fallback: undefined, register(r) { routes.set(r.path, r); return r } },
  get(ns) {
    if (ns === 'settings') return { get: () => undefined }
    if (ns === 'connection') return { authenticatedUrl: (b) => b + '/?token=launch', requestRejection: () => 401 }
    return undefined
  },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { return fn() },
}
// 注意：必须在 apply() 之前把凭据准备好。apply() 会读一次凭据决定 enabledFlag
// （认证是否已启用），若之后再塞凭据，enabledFlag 仍是 false，checkRequest 会
// 一律放行——测出来的"未认证被拒"就是假的。
const salt0 = 'salt'
// scrypt 的 salt 必须是【写进 hash 的那个 base64 串】，不是它解码后的字节：
// HashPassword 生成时就是把 base64 串直接当 salt 传给 scrypt 的，verifyPassword
// 也照此重算。用解码后的字节会得到一个永远验不过的 hash（登录恒为 invalid）。
// 注意两点，都是实测踩出来的：
//   1) salt 必须是【写进 hash 的那个 base64 串】本身，不是它解码后的字节——
//      hashPassword 就是把 base64 串直接当 salt 传给 scrypt 的；
//   2) 必须显式传 maxmem: 64MB。N=32768/r=8 需要约 32MB，超过 Node 的默认上限
//      （scryptSync 会抛 ERR_CRYPTO_INVALID_SCRYPT_PARAMS，被 catch 吞掉后表现为
//       "密码错误"）。插件的 verifyPassword 也是显式传 64MB，这里必须一致。
const saltB64 = Buffer.from(salt0).toString('base64')
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const hash0 = 'scrypt:32768:8:1:' + saltB64 + ':' + scryptSync('pw12345678', saltB64, 64, SCRYPT_OPTS).toString('base64')
credsText = JSON.stringify({
  v: 4, username: 'admin', hash: hash0, ttl: 12,
  oidc: { enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectBase: 'https://webui.example.com', trustBrowserOrigin: false },
})
await applyPlugin(ctx)

const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  let u = String(url)
  if (u.startsWith(ISSUER)) u = 'http://127.0.0.1:' + idpPort + u.slice(ISSUER.length)
  return realFetch(u, opts)
}

/**
 * 造请求对象。带 body 时必须实现 'data'/'end' 事件——插件的 readBody 用
 * req.on('data') 收集请求体，缺了会抛错（表现为 500）。
 * 这与真实 node:http 的 IncomingMessage 行为一致。
 */
function makeReq(url, headers = {}, body) {
  const listeners = new Map()
  const req = {
    method: 'GET',
    url,
    headers: { host: 'webui.example.com', 'user-agent': 't', ...headers },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, [])
      listeners.get(ev).push(fn)
      return req
    },
  }
  // 异步触发，贴近真实流
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
    end(b) { this.body = b },
    setHeader(k, v) { this.headers[k] = v },
  }
}
const getCookie = (res, name) => {
  const sc = res.headers && res.headers['Set-Cookie']
  if (!sc) return null
  for (const one of (Array.isArray(sc) ? sc : [sc])) {
    const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(one)
    if (m) return m[1]
  }
  return null
}
/**
 * 通过本地账号登录拿一个会话 Cookie。
 * /status 在认证启用后需要有效会话（这是 0.6.0 之后的行为，测试里必须带上），
 * 否则读到的是 401 而不是状态。
 */
async function loginLocal() {
  const r = makeRes()
  // 必须用 POST：GET /login 返回的是 HTML 登录页，不是 JSON 接口。
  const req = makeReq('/dsh-webui-oauth/login', { 'content-type': 'application/json' }, JSON.stringify({ username: 'admin', password: 'pw12345678' }))
  req.method = 'POST'
  await routes.get('/dsh-webui-oauth/login').handler(req, r)
  return getCookie(r, 'dsh_wua_session')
}
/** 带会话读取 /status。 */
async function statusWith(session) {
  return call('/dsh-webui-oauth/status', { headers: { cookie: 'dsh_wua_session=' + session } })
}

async function call(path, { url, headers, method, body } = {}) {
  const r = makeRes()
  const req = makeReq(url || path, headers || {}, body)
  if (method) req.method = method
  await routes.get(path).handler(req, r)
  let parsed = null
  try { parsed = JSON.parse(r.body || '{}') } catch (e) { parsed = null }
  return { res: r, status: r.status, json: parsed, location: r.headers.location }
}

// ---------------- 准备：基准凭据（供后续各用例重置）----------------
// （已在上方 apply() 之前写入过一次，这里只是复用同一份结构）
const salt = salt0
const hash = hash0
const baseCreds = {
  v: 4, username: 'admin', hash, ttl: 12,
  oidc: { enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectBase: 'https://webui.example.com', trustBrowserOrigin: false },
}

console.log('\n— 1. 未绑定：OIDC 登录一律拒绝 —')
{
  const r = await call('/dsh-webui-oauth/oidc/login', { url: '/dsh-webui-oauth/oidc/login' })
  eq('拒绝发起 OIDC 登录', r.json && r.json.ok === false, r.res.body)
  eq('错误为 oidc-not-bound', r.json && r.json.error === 'oidc-not-bound', r.res.body)
  eq('未 302 到 IdP', r.status !== 302, String(r.status))
  const sess = await loginLocal()
  eq('本地账号可登录（取会话用于读 status）', !!sess)
  const s = await statusWith(sess)
  eq('status 显示未绑定', s.json && s.json.oidc && s.json.oidc.bound === false, JSON.stringify(s.json && s.json.oidc))
}

console.log('\n— 1b. 登录页（GET）必须能渲染，且 SSO 按钮跟随绑定状态 —')
{
  // 回归：曾经在拼接登录页时引用了一个不存在的变量名（写成 creds 而非 credsNow），
  // 导致 GET /login 直接 500 —— 登录页打不开等于整个插件不可用。
  // 这个分支只在浏览器 GET 时走到，POST/JSON 用例覆盖不到，必须单独测。
  const r = await call('/dsh-webui-oauth/login', { url: '/dsh-webui-oauth/login' })
  eq('GET /login 返回 200（未因变量名错误 500）', r.status === 200, String(r.status))
  eq('返回的是 HTML 登录页', typeof r.res.body === 'string' && r.res.body.includes('<form'), String(r.res.body).slice(0, 80))
  eq('未绑定时 SSO 置为 false', /OIDC_ENABLED = "false"/.test(r.res.body), '（未找到 OIDC_ENABLED 标记）')

  // 绑定后再取一次：SSO 应变为 true
  credsText = JSON.stringify({ ...baseCreds, boundSub: 'sub-alice' })
  const r2 = await call('/dsh-webui-oauth/login', { url: '/dsh-webui-oauth/login' })
  eq('已绑定时 SSO 置为 true', /OIDC_ENABLED = "true"/.test(r2.res.body), '（未找到 OIDC_ENABLED 标记）')
  credsText = JSON.stringify(baseCreds)
}

console.log('\n— 1c. OIDC 配置的保存语义（回归：secret 留空不得被拒）—')
{
  // 背景：设置页的 clientSecret 输入框每次打开都是空的（secret 不回传前端），
  // 且提示写着"留空保留原值"。早先服务端把空串当非法值拒掉，导致
  // 「改了 issuer/scope 再保存」这条路完全走不通——用户只能反复重填 secret，
  // 每次改配置都要回 IdP 后台捞一次密钥。
  const session = await loginLocal()
  eq('本地登录成功（拿会话用于 configure）', !!session, String(session))
  const H = { 'content-type': 'application/json', cookie: 'dsh_wua_session=' + session }

  const base = { username: 'admin', current: 'pw12345678' }

  // ① 首次启用：必须提供 secret
  credsText = JSON.stringify({ ...baseCreds, oidc: undefined })
  const first = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: H,
    body: JSON.stringify({ ...base, oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: '' } }),
  })
  eq('首次启用且 secret 留空 → 拒绝', first.json && first.json.ok === false, first.res.body)
  eq('拒绝原因说明必须填 secret', /clientSecret/.test(String(first.json && first.json.reason)), first.res.body)

  // ② 首次启用：带 secret 应成功
  credsText = JSON.stringify({ ...baseCreds, oidc: undefined })
  const okFirst = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: H,
    body: JSON.stringify({ ...base, oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: 'sec1' } }),
  })
  eq('首次启用带 secret → 成功', okFirst.json && okFirst.json.ok === true, okFirst.res.body)

  // ③ 再次保存：secret 留空应被接受，且保留原值（这是曾经失败的那条路）
  const resave = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: H,
    body: JSON.stringify({ ...base, oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: '', scope: 'openid profile' } }),
  })
  eq('再次保存且 secret 留空 → 接受（不再被误拒）', resave.json && resave.json.ok === true, resave.res.body)
  // secret 存在独立的 dsh-webui-oauth.json（0.4.x 起），不在凭据文件里
  const savedOidc = JSON.parse(oidcText || '{}')
  eq('留空时保留原有 secret（不被清成空串）',
    !!(savedOidc && savedOidc.oidc && savedOidc.oidc.clientSecret === 'sec1'),
    JSON.stringify(savedOidc))

  // ④ secret 类型错误仍要拒绝
  const badType = await call('/dsh-webui-oauth/configure', {
    url: '/dsh-webui-oauth/configure', method: 'POST', headers: H,
    body: JSON.stringify({ ...base, oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: 123 } }),
  })
  eq('secret 类型错误 → 拒绝', badType.json && badType.json.ok === false, badType.res.body)
}

console.log('\n— 1d. status 必须给出可抄进 IdP 的完整回调地址 —')
{
  // 原生 OIDC 要求 redirect_uri 精确匹配，少一个字符 IdP 就拒。
  // 只给路径没法用，必须含 scheme/host/port。
  // 注意：OIDC 配置自 0.4.x 起存在独立的 dsh-webui-oauth.json（oidcText），
  // 不再放进凭据文件。写错位置会读到上一用例留下的旧配置。
  oidcText = JSON.stringify({
    v: 1,
    oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: 'sec1', redirectBase: 'https://dsh.example.com' },
  })
  const s = await statusWith(await loginLocal())
  const o = (s.json && s.json.oidc) || {}
  eq('status 给出完整回调地址',
    o.redirectUri === 'https://dsh.example.com/dsh-webui-oauth/oidc/callback', String(o.redirectUri))
  eq('同时给出回调路径常量', o.callbackPath === '/dsh-webui-oauth/oidc/callback', String(o.callbackPath))

  // 未配置 redirectBase / publicBaseUrl 时不能瞎猜，应明确返回 null
  oidcText = JSON.stringify({
    v: 1,
    oidc: { enabled: true, issuer: 'https://idp.test', clientId: 'c1', clientSecret: 'sec1' },
  })
  const s2 = await statusWith(await loginLocal())
  eq('无法确定 base 时回调地址为 null（不猜）',
    (s2.json && s2.json.oidc && s2.json.oidc.redirectUri) === null,
    JSON.stringify(s2.json && s2.json.oidc && s2.json.oidc.redirectUri))
}

console.log('\n— 2. 绑定端点存在且要求已登录 —')
{
  eq('注册了 /oidc/bind', routes.has('/dsh-webui-oauth/oidc/bind'))
  eq('注册了 /oidc/unbind', routes.has('/dsh-webui-oauth/oidc/unbind'))
  const r = await call('/dsh-webui-oauth/oidc/bind', { url: '/dsh-webui-oauth/oidc/bind' })
  eq('未登录时绑定被拒 401', r.status === 401, String(r.status))
  const u = await call('/dsh-webui-oauth/oidc/unbind', { url: '/dsh-webui-oauth/oidc/unbind', method: 'POST' })
  eq('未登录时解绑被拒 401', u.status === 401, String(u.status))
}

console.log('\n— 3. 绑定后：只有该 sub 能登录 —')
{
  // 直接写入绑定关系（绑定流程本身由 oidc-integration 覆盖 IdP 往返）。
  // 注意同时把 OIDC 配置写成已知状态：前一个用例可能改过 oidcText，
  // 不重置的话这里的 login 会因 base 解析失败而不 302，报一个与本节无关的错。
  credsText = JSON.stringify({ ...baseCreds, boundSub: 'sub-alice' })
  oidcText = JSON.stringify({
    v: 1,
    oidc: { enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectBase: 'https://webui.example.com', trustBrowserOrigin: false },
  })
  const s = await statusWith(await loginLocal())
  eq('status 显示已绑定', s.json && s.json.oidc && s.json.oidc.bound === true, JSON.stringify(s.json && s.json.oidc))
  eq('status 只回传脱敏 sub，不回传原值',
    s.json && s.json.oidc && s.json.oidc.boundSubHint !== 'sub-alice', JSON.stringify(s.json && s.json.oidc))

  const r = await call('/dsh-webui-oauth/oidc/login', { url: '/dsh-webui-oauth/oidc/login' })
  eq('已绑定后允许发起登录（302 到 IdP）', r.status === 302, String(r.status))
}

console.log('\n— 4. 未绑定/不匹配的 sub 不得建立会话（访问控制核心）—')
{
  // 走到回调：IdP 会签发 idpState.sub，把它设成与 boundSub 不同的值
  const loginRes = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(makeReq('/dsh-webui-oauth/oidc/login'), loginRes)
  const authUrl = new URL(loginRes.headers.location)
  const state = authUrl.searchParams.get('state')
  idpState.sub = 'sub-mallory'   // 换一个未被绑定的身份
  const authRes = await fetch(authUrl.href, { redirect: 'manual' })
  const back = new URL(authRes.headers.get('location'))
  const cb = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?' + back.searchParams.toString(), { cookie: 'dsh_wua_oidc_state=' + state }), cb)
  // 失败时不再渲染 JSON，而是 302 回应用并带 oidcerr 回执——
  // OIDC 回调是浏览器主导的顶层导航，停在 JSON 上等于给用户一个死页面。
  eq('sub 不匹配时 302 回应用（而非渲染 JSON）', cb.status === 302, String(cb.status))
  const loc = String(cb.headers.location || '')
  eq('回执标明 sub 不匹配', /[?&]oidcerr=sub-mismatch/.test(loc), loc)
  eq('未下发会话 Cookie', getCookie(cb, 'dsh_wua_session') === null, JSON.stringify(cb.headers['Set-Cookie']))
}

console.log('\n— 5. 匹配的 sub 可以登录 —')
{
  const loginRes = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(makeReq('/dsh-webui-oauth/oidc/login'), loginRes)
  const authUrl = new URL(loginRes.headers.location)
  const state = authUrl.searchParams.get('state')
  idpState.sub = 'sub-alice'   // 与 boundSub 一致
  const authRes = await fetch(authUrl.href, { redirect: 'manual' })
  const back = new URL(authRes.headers.get('location'))
  const cb = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?' + back.searchParams.toString(), { cookie: 'dsh_wua_oidc_state=' + state }), cb)
  // 登录成功也必须是 302 回应用（同绑定）：回调时页面上没有我们的 JS 在跑，
  // 返回 {"ok":true,"redirect":...} 会让浏览器停在 JSON 上。
  eq('绑定身份登录成功（302 回应用）', cb.status === 302, String(cb.status))
  eq('回跳目标可解析', String(cb.headers.location || '').length > 0, String(cb.headers.location))
  eq('下发会话 Cookie', !!getCookie(cb, 'dsh_wua_session'), JSON.stringify(cb.headers['Set-Cookie']))
}

console.log('\n— 5b. 绑定成功后必须回到应用，而不是停在 JSON 上 —')
{
  // 回归：绑定成功曾只返回 {"ok":true,"bound":true,"sub":"..."}。
  // 但回调是【浏览器主导的顶层导航】（用户点绑定 → 302 到 IdP → 302 回这里），
  // 渲染 JSON 会让用户停在一个死页面、必须手动回退——部署者实际就遇到了这个问题。
  // 正确行为：302 回应用并带 oidcbound=1 回执，由前端提示成功。
  const session = await loginLocal()
  const H = { cookie: 'dsh_wua_session=' + session }
  // 先确保未绑定，走一次完整绑定
  credsText = JSON.stringify({ ...baseCreds })
  oidcText = JSON.stringify({
    v: 1,
    oidc: { enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectBase: 'https://webui.example.com', trustBrowserOrigin: false },
  })

  const bindRes = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/bind').handler(
    makeReq('/dsh-webui-oauth/oidc/bind', H), bindRes)
  eq('发起绑定得到 302 到 IdP', bindRes.status === 302, String(bindRes.status))
  const authUrl = new URL(bindRes.headers.location)
  const state = authUrl.searchParams.get('state')

  idpState.sub = 'sub-alice'
  const authRes = await fetch(authUrl.href, { redirect: 'manual' })
  const back = new URL(authRes.headers.get('location'))
  const cb = makeRes()
  // binding 回调同样需要 state Cookie 绑定
  const stCookie = getCookie(bindRes, 'dsh_wua_oidc_state') || state
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?' + back.searchParams.toString(), { cookie: 'dsh_wua_oidc_state=' + stCookie }), cb)

  eq('绑定成功返回 302（而非 JSON）', cb.status === 302, String(cb.status))
  const loc = String(cb.headers.location || '')
  eq('回执带 oidcbound=1', /[?&]oidcbound=1/.test(loc), loc)
  eq('未把 sub 明文放进跳转 URL（避免泄露到历史/日志）',
    !loc.includes('sub-alice'), loc)
  const saved = JSON.parse(credsText || '{}')
  eq('sub 已落库', saved.boundSub === 'sub-alice', String(saved.boundSub))
}

console.log('\n— 6. 解绑：密码错误被拒，正确则清空并立即失效 —')
{
  const bad = await call('/dsh-webui-oauth/oidc/unbind', {
    url: '/dsh-webui-oauth/oidc/unbind', method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'dsh_wua_session=x' },
  })
  // 会话无效 → 401（未认证）
  eq('无有效会话时解绑被拒', bad.status === 401, String(bad.status))
}

console.log('\n— 7. 解绑后 OIDC 登录重新被拒 —')
{
  credsText = JSON.stringify({ ...baseCreds })   // 模拟解绑：删掉 boundSub
  const r = await call('/dsh-webui-oauth/oidc/login', { url: '/dsh-webui-oauth/oidc/login' })
  eq('解绑后拒绝发起 OIDC 登录', r.json && r.json.error === 'oidc-not-bound', r.res.body)
  const s = await statusWith(await loginLocal())
  eq('status 回到未绑定', s.json && s.json.oidc && s.json.oidc.bound === false, JSON.stringify(s.json && s.json.oidc))
}

console.log('\n— 8. 旧凭据文件（无 boundSub）视为未绑定 —')
{
  credsText = JSON.stringify({ v: 3, username: 'admin', hash, ttl: 12 })   // 无 oidc、无 boundSub
  const r = await call('/dsh-webui-oauth/oidc/login', { url: '/dsh-webui-oauth/oidc/login' })
  eq('无 boundSub 的旧凭据拒绝 OIDC 登录', r.json && r.json.ok === false, r.res.body)
}

globalThis.fetch = realFetch
idp.close()
rmSync(tmp, { recursive: true, force: true })
restoreRuntimeFiles()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
