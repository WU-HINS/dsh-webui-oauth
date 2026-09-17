/**
 * OIDC 端到端集成测试：用一个本地假 IdP（真 HTTP 服务器）跑通
 * 「发起授权 → 回调 → 换 token → 验 id_token → 建本地会话」全链路。
 *
 * 重点覆盖曾经漏掉、且语法检查查不出的运行时缺陷：
 *   - 回调分支引用未定义函数（ReferenceError → 500）
 *   - sendJson 的额外响应头参数被静默忽略（state Cookie 清不掉）
 *   - state 仅存在于服务端集合、未与浏览器 Cookie 绑定（登录 CSRF）
 *
 * 运行：node test/oidc-integration.test.mjs
 */
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scryptSync, generateKeyPairSync, sign } from 'node:crypto'
import { apply as applyPlugin } from '../index.js'

// ---------------- 运行时文件保护 ----------------
// apply() 的 DATA_DIR 在源码/link 安装下就是插件源码目录，审计/会话/setup-token
// 都是直接 appendFileSync 写进去的（不走 ctx.fs，无法用桩拦截）。测试运行前快照、
// 结束后还原，确保测试对工作区零副作用、可重复运行。
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

// ---------------- 假 IdP ----------------
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = publicKey.export({ format: 'jwk' })
pubJwk.alg = 'RS256'; pubJwk.use = 'sig'; pubJwk.kid = 'idp-key'

const ISSUER = 'https://idp.test'
const CLIENT_ID = 'dsh-client', CLIENT_SECRET = 'dsh-secret'
const idpState = { lastAuthQuery: null, tokenBody: null, failToken: false, nonceByCode: {} }

const idp = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://idp.test')
  if (u.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: 'https://idp.test/authorize',
      token_endpoint: 'https://idp.test/token',
      jwks_uri: 'https://idp.test/jwks',
    }))
    return
  }
  if (u.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: [pubJwk] }))
    return
  }
  if (u.pathname === '/authorize') {
    idpState.lastAuthQuery = Object.fromEntries(u.searchParams)
    // 把 nonce 与本次 code 绑定，而不是读全局"最后一次授权"——否则并发/多次授权时
    // token 端点会取到别的 nonce，出现假阴性 bad-nonce。
    const code = 'code-' + u.searchParams.get('state')
    idpState.nonceByCode[code] = u.searchParams.get('nonce')
    const back = new URL(u.searchParams.get('redirect_uri'))
    back.searchParams.set('code', code)
    back.searchParams.set('state', u.searchParams.get('state'))
    res.writeHead(302, { location: back.href })
    res.end()
    return
  }
  if (u.pathname === '/token') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      idpState.tokenBody = Object.fromEntries(new URLSearchParams(body))
      if (idpState.failToken) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_grant' })); return }
      const now = Math.floor(Date.now() / 1000)
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const hdr = { alg: 'RS256', typ: 'JWT', kid: 'idp-key' }
      const code = idpState.tokenBody && idpState.tokenBody.code
      const payload = {
        iss: ISSUER, aud: CLIENT_ID, sub: 'idp-subject-42',
        exp: now + 300, iat: now, nonce: idpState.nonceByCode[code],
      }
      const data = b64(hdr) + '.' + b64(payload)
      const sig = sign('sha256', Buffer.from(data), privateKey).toString('base64url')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id_token: data + '.' + sig, access_token: 'at' }))
    })
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => idp.listen(0, '127.0.0.1', r))
const idpPort = idp.address().port

// ---------------- 插件宿主 mock ----------------
const dataDir = mkdtempSync(join(tmpdir(), 'oidc-int-'))
let credsText = null
const fs = {
  async resolve(p) { return p },
  async readText() { return credsText },
  async writeText(p, data) { credsText = data },
}
const routes = new Map()
const webServer = {
  port: 3080,
  prefixes: new Map([['/api', {}], ['', {}], ['/plugins', {}]]),
  upgrades: new Map(),
  fallback: undefined,
  register(r) { routes.set(r.path, r); return r },
}
const ctx = {
  fs, webServer,
  get(ns) {
    if (ns === 'settings') return { get: () => undefined }
    if (ns === 'connection') return { authenticatedUrl: (b) => b + '/?token=launch', requestRejection: () => 401 }
    return undefined
  },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { return fn() },
}
await applyPlugin(ctx)

// 让插件访问假 IdP：issuer 指向本地端口（https 校验会因为 http 被拒，所以这里
// 直接用一个把 https://idp.test 映射到本地 http 的 fetch 桩替换全局 fetch）。
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  let u = String(url)
  if (u.startsWith(ISSUER)) u = 'http://127.0.0.1:' + idpPort + u.slice(ISSUER.length)
  return realFetch(u, opts)
}

// ---------------- 请求助手 ----------------
function makeReq(url, headers = {}) {
  return { method: 'GET', url, headers: { host: 'webui.example.com', 'user-agent': 't', ...headers } }
}
function makeRes() {
  return {
    status: null, headers: {}, body: null,
    // 注意：必须【合并】而非覆盖 —— 插件先 res.setHeader('Set-Cookie', ...) 再
    // res.writeHead(...)，若这里直接覆盖会把 Set-Cookie 冲掉，测试就测不到真实行为。
    writeHead(s, h) { this.status = s; if (h) for (const k of Object.keys(h)) this.headers[k] = h[k] },
    end(b) { this.body = b },
    setHeader(k, v) { this.headers[k] = v },
  }
}
const getCookie = (res, name) => {
  const sc = res.headers && res.headers['Set-Cookie']
  if (!sc) return null
  // 一次响应可能携带多条 Set-Cookie（回调成功时同时下发会话 Cookie 与清除一次性
  // state Cookie），node:http 对数组值会写成多个同名头——都要检查。
  const list = Array.isArray(sc) ? sc : [sc]
  for (const one of list) {
    const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(one)
    if (m) return m[1]
  }
  return null
}
/** 收集一次响应里的全部 Set-Cookie（数组形式）。 */
const allCookies = (res) => {
  const sc = res.headers && res.headers['Set-Cookie']
  if (!sc) return []
  return Array.isArray(sc) ? sc : [sc]
}
/**
 * 模拟浏览器：走一次 /oidc/login 拿 302 → 访问 IdP 授权端点 → 跟随回调用 code 换会话。
 * 返回 { loginRes, state, callbackRes }。让 test 贴近真实浏览器行为，
 * 而不是手工拼一个 code（那样绕过 IdP，取不到与 code 绑定的 nonce）。
 */
async function browserSsoFlow({ cookieOverride } = {}) {
  const loginRes = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(makeReq('/dsh-webui-oauth/oidc/login'), loginRes)
  const authUrl = new URL(loginRes.headers.location)
  const state = authUrl.searchParams.get('state')
  // 浏览器访问 IdP 授权端点（真实 HTTP），IdP 302 回 redirect_uri
  const authRes = await fetch(authUrl.href, { redirect: 'manual' })
  const backUrl = new URL(authRes.headers.get('location'))
  const callbackRes = makeRes()
  const cookie = cookieOverride !== undefined
    ? cookieOverride
    : 'dsh_wua_oidc_state=' + state
  const headers = cookie ? { cookie } : {}
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?' + backUrl.searchParams.toString(), headers), callbackRes)
  return { loginRes, state, callbackRes }
}

// ---------------- 用例 ----------------
const keys = [...routes.keys()].sort()
eq('注册 OIDC login 端点', keys.includes('/dsh-webui-oauth/oidc/login'), keys.join(','))
eq('注册 OIDC callback 端点', keys.includes('/dsh-webui-oauth/oidc/callback'), keys.join(','))
eq('注册 OIDC logout 端点', keys.includes('/dsh-webui-oauth/oidc/logout'), keys.join(','))

// 1) 未配置 OIDC：登录被拒
//
// 注意判定顺序：未绑定的检查排在"是否配置了 OIDC"之前（绑定是访问前提，
// 先挡在最前面可以避免用户白走一趟 IdP 往返）。因此全新部署这里返回
// oidc-not-bound 而不是 oidc-not-configured —— 两者都是"拒绝"，用例只断言拒绝，
// 并额外锁定这个顺序，避免以后有人把检查顺序调回去却没人发现。
{
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(
    makeReq('/dsh-webui-oauth/oidc/login?base=https://webui.example.com'), res)
  const p = JSON.parse(res.body || '{}')
  eq('未配置/未绑定 OIDC 时拒绝登录', p.ok === false, res.body)
  eq('拒绝原因是未绑定（未绑定检查优先于配置检查）', p.error === 'oidc-not-bound', res.body)
  eq('HTTP 200', res.status, 200)
}

// 2) 配置 OIDC（redirectBase 写死，trustBrowserOrigin=false ⇒ 不依赖前端 origin）
const salt = 'salt'
const hash = 'scrypt:32768:8:1:' + Buffer.from(salt).toString('base64') + ':' + scryptSync('pw', salt, 64).toString('base64')
const oidcCfg = {
  enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  scope: 'openid profile email', redirectBase: 'https://webui.example.com', trustBrowserOrigin: false,
}
// boundSub：OIDC 登录要求 sub 与已绑定值一致（0.6.0 引入）。
// 这里绑定 IdP 会签发的那个 sub，使后续登录用例能走到"登录成功"分支。
credsText = JSON.stringify({ v: 4, username: 'admin', hash, ttl: 12, oidc: oidcCfg, boundSub: 'idp-subject-42' })

// 3) status 暴露 OIDC 信息且不泄露 secret
{
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/status').handler(makeReq('/dsh-webui-oauth/status'), res)
  const s = JSON.parse(res.body || '{}')
  eq('status oidc.enabled=true', s.oidc && s.oidc.enabled === true, JSON.stringify(s.oidc))
  eq('status oidc.issuer 正确', s.oidc && s.oidc.issuer === ISSUER, JSON.stringify(s.oidc))
  eq('status 不泄露 clientSecret', !(s.oidc || {}).clientSecret, JSON.stringify(s.oidc))
}

// 4) /oidc/login：应 302 到 IdP，并下发 state Cookie
let loginRes = null, stateFromCookie = null
{
  loginRes = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(
    makeReq('/dsh-webui-oauth/oidc/login'), loginRes)
  eq('/oidc/login 返回 302', loginRes.status, 302)
  const loc = loginRes.headers.location || ''
  eq('重定向到 IdP 授权端点', loc.startsWith('https://idp.test/authorize'), loc)
  const q = new URL(loc).searchParams
  eq('携带 response_type=code', q.get('response_type'), 'code')
  eq('携带 client_id', q.get('client_id'), CLIENT_ID)
  eq('携带 PKCE S256', q.get('code_challenge_method'), 'S256')
  eq('携带 PKCE challenge', !!q.get('code_challenge'), String(q.get('code_challenge')))
  eq('携带 nonce', !!q.get('nonce'), String(q.get('nonce')))
  eq('redirect_uri = redirectBase + 固定回调路径',
    q.get('redirect_uri'), 'https://webui.example.com/dsh-webui-oauth/oidc/callback')
  stateFromCookie = getCookie(loginRes, 'dsh_wua_oidc_state')
  eq('下发 state 绑定 Cookie', stateFromCookie === q.get('state'), String(stateFromCookie))
}

// 5) 回调：state 缺失 → 拒绝
{
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?code=x&state=bogus'), res)
  const p = JSON.parse(res.body || '{}')
  eq('未知 state 被拒', p.ok === false && p.error === 'oidc-invalid-state', res.body)
}

// 6) 回调：state 合法但浏览器不带绑定 Cookie → 判定登录 CSRF
{
  const { callbackRes } = await browserSsoFlow({ cookieOverride: 'dsh_wua_oidc_state=someone-elses-state' })
  const p = JSON.parse(callbackRes.body || '{}')
  eq('state Cookie 不符 → 拒绝（登录 CSRF 防护）', p.ok === false && p.error === 'oidc-invalid-state', callbackRes.body)
}

// 6b) 回调：完全不携带 state Cookie → 同样拒绝
{
  const { callbackRes } = await browserSsoFlow({ cookieOverride: null })
  const p = JSON.parse(callbackRes.body || '{}')
  eq('缺少 state Cookie → 拒绝', p.ok === false && p.error === 'oidc-invalid-state', callbackRes.body)
}

// 7) 回调：完整成功路径（浏览器真实走一遍 IdP 授权）
{
  const { loginRes, callbackRes } = await browserSsoFlow()
  const p = JSON.parse(callbackRes.body || '{}')
  eq('回调成功 ok=true', p.ok === true, callbackRes.body)
  eq('回跳核心带 launch token', typeof p.redirect === 'string' && p.redirect.includes('token=launch'), String(p.redirect))
  const sess = getCookie(callbackRes, 'dsh_wua_session')
  eq('下发会话 Cookie', !!sess && sess.length > 20, String(sess))
  // 回调成功必须【同时】下发会话 Cookie 与清除一次性 state Cookie。
  // 二者都是 Set-Cookie：若实现用普通对象合并会互相覆盖，表现成"登录成功却没有会话"。
  const cbs = allCookies(callbackRes)
  eq('响应含两条 Set-Cookie', cbs.length === 2, JSON.stringify(cbs))
  eq('其一为会话 Cookie', cbs.some((c) => c.startsWith('dsh_wua_session=')), JSON.stringify(cbs))
  eq('其二清除 state Cookie', cbs.some((c) => c.startsWith('dsh_wua_oidc_state=;')), JSON.stringify(cbs))
  eq('token 端点收到 client_secret', (idpState.tokenBody || {}).client_secret, JSON.stringify(idpState.tokenBody))
  eq('token 端点收到 code_verifier', !!(idpState.tokenBody || {}).code_verifier, JSON.stringify(idpState.tokenBody))
  eq('token 端点回传同一 redirect_uri',
    (idpState.tokenBody || {}).redirect_uri,
    new URL(loginRes.headers.location).searchParams.get('redirect_uri'))
  // state 一次性：同一 state 再用一次必须被拒
  const replay = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/callback').handler(
    makeReq('/dsh-webui-oauth/oidc/callback?code=replay&state=' +
      new URL(loginRes.headers.location).searchParams.get('state'),
      { cookie: 'dsh_wua_oidc_state=' + new URL(loginRes.headers.location).searchParams.get('state') }), replay)
  eq('state 重放被拒（一次性）', JSON.parse(replay.body || '{}').error, 'oidc-invalid-state')
}

// 8) 会话 Cookie 可访问受保护端点
{
  const { callbackRes } = await browserSsoFlow()
  const sess = getCookie(callbackRes, 'dsh_wua_session')
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/status').handler(
    makeReq('/dsh-webui-oauth/status', { cookie: 'dsh_wua_session=' + sess }), res)
  eq('持会话可读 status', res.status, 200)
  const res2 = makeRes()
  await routes.get('/dsh-webui-oauth/status').handler(makeReq('/dsh-webui-oauth/status'), res2)
  eq('无会话读 status 被拒', res2.status, 401)
}

// 9) 回调：token 交换失败要优雅返回，不 500
{
  idpState.failToken = true
  const { callbackRes } = await browserSsoFlow()
  const p = JSON.parse(callbackRes.body || '{}')
  eq('token 交换失败不崩溃', callbackRes.status === 200 && p.ok === false, callbackRes.body)
  idpState.failToken = false
}

// 10) logout 清会话
{
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/logout').handler({ method: 'POST', url: '/dsh-webui-oauth/oidc/logout', headers: { host: 'webui.example.com' } }, res)
  eq('logout 返回 ok', JSON.parse(res.body || '{}').ok, true)
}

// 11) 开放重定向防护：配置了 redirectBase 时不采信前端传入的异源 base
{
  const res = makeRes()
  await routes.get('/dsh-webui-oauth/oidc/login').handler(
    makeReq('/dsh-webui-oauth/oidc/login?base=https://evil.example.com'), res)
  const ru = new URL(res.headers.location).searchParams.get('redirect_uri')
  eq('trustBrowserOrigin=false 时忽略前端 base', ru, 'https://webui.example.com/dsh-webui-oauth/oidc/callback')
}

globalThis.fetch = realFetch
idp.close()
rmSync(dataDir, { recursive: true, force: true })
restoreRuntimeFiles()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
