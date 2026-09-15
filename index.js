/**
 * dsh-webui-auth — persistent WebUI authentication plugin for DeepSeek
 * Harness (security-hardened fork).
 *
 * Enforces authentication at the HTTP/transport layer so unauthenticated
 * browsers (or plain HTTP clients) cannot load WebUI resources, call the
 * /api RPC surface, or open the WebSocket downlinks.
 *
 * Hardening changes over upstream 0.2.3 (by xiaoying-agent):
 *
 *   H1. First-run setup requires a per-boot random setup token that is only
 *       printed to the host log (where the operator reads it). A remote
 *       attacker who reaches the server before the operator can no longer
 *       claim the administrator account.
 *   H2. /api and WebSocket gating is done by RUNTIME ROUTE WRAPPING instead
 *       of patching dsh core package sources on disk. No core files are
 *       modified; nothing silently breaks on a dsh upgrade. If the expected
 *       routes are missing (dsh internals changed), the plugin logs an error
 *       AND reports it on the settings page — and the login/configure
 *       endpoints refuse to enable the gate until the shape check passes
 *       (fail-closed against "enabled but /api unprotected").
 *   H3. Sessions persist to disk (JSONL append + startup replay), so a dsh
 *       restart no longer logs everyone out.
 *   H4. Login rate limiting is per-IP (socket remote address; honors
 *       CF-Connecting-IP / X-Forwarded-For leftmost-untrusted strip when the
 *       socket is a loopback reverse proxy) instead of one global bucket,
 *       so an attacker cannot lock the operator out.
 *   H5. The audit log stores HMAC-keyed, truncated client IPs instead of
 *       raw addresses (the HMAC key is generated once and stored next to
 *       the credentials with 0600 permissions).
 *
 * 0.4.0 — optional OIDC single sign-on (SSO):
 *
 *   O1. Standards-based OIDC authorization-code flow with PKCE (S256) plus a
 *       confidential client (client_secret required; public-client PKCE-only
 *       mode is deliberately unsupported). The IdP is discovered through
 *       {issuer}/.well-known/openid-configuration; only HTTPS endpoints are
 *       accepted.
 *   O2. The login page grows an "SSO" button next to the password form; both
 *       methods coexist. After the IdP round-trip the plugin mints the SAME
 *       local session as a password login (server-side session, persisted
 *       sessions.jsonl, identical TTL), keyed by the IdP `sub`. The final
 *       redirect reuses postLoginRedirect() so the core's launch-token
 *       exchange still runs.
 *   O3. redirect_uri base resolution (this is the part that decides where the
 *       IdP sends the browser back):
 *         - `oidc.redirectBase` configured  → use it;
 *         - otherwise `trustBrowserOrigin` (default true) trusts the
 *           front-end `location.origin` reported by the login page — under a
 *           reverse proxy that rewrites Host the browser's own address is the
 *           correct one;
 *         - `trustBrowserOrigin: false` → only `redirectBase` is used, and if
 *           it is absent the request fails closed with a clear error instead
 *           of guessing.
 *       The redirect_uri is always `<base> + /dsh-webui-oauth/oidc/callback`
 *       (fixed path), and isValidOrigin() only accepts a bare http(s) origin
 *       with no path/query/hash/userinfo and no control characters — which
 *       also kills CRLF-injection attempts before URL parsing can silently
 *       strip them.
 *   O4. id_token validation: JWKS lookup by kid (falling back to the alg
 *       family), signature verification for RS256/384/512, ES256/384/512 and
 *       EdDSA, then iss / aud / exp / iat / nbf / nonce checks. ECDSA
 *       signatures are JOSE raw R||S (ieee-p1363), not DER.
 *   O5. state (CSRF), nonce (replay) and the PKCE verifier are single-use,
 *       kept in memory with a 10-minute TTL and consumed on callback. The state
 *       is ALSO bound to the browser through a short-lived HttpOnly cookie and
 *       both must match on callback — checking only "state exists server-side"
 *       would still allow an attacker to take a state and have the victim
 *       complete the callback (session fixation / login CSRF). Only the
 *       sanitizeSub()-filtered `sub` reaches the audit log, so a hostile IdP
 *       cannot inject into log lines. Logout is the simple variant: the local
 *       session is cleared; the IdP session is left alone.
 *       The session identity uses the RAW sub, not the sanitized one:
 *       sanitization is lossy ('a/b' and 'a_b' collapse to the same string),
 *       so using it as identity would conflate two distinct IdP subjects.
 *   O6. Config lives in the plugin's own credential file (v4 adds an `oidc`
 *       object next to username/hash/ttl), so the secret sits in the same
 *       0600 data directory as the password hash. Zero new dependencies:
 *       Node 22's built-in fetch/crypto do discovery, token exchange and JWT
 *       verification.
 *   O7. Hardening found during self-review (each had a regression test added):
 *       - Discovery/JWKS fetches use redirect:'error' and the jwks_uri must be
 *         same-origin with the issuer; otherwise one discovery response could
 *         point the trust anchor at an arbitrary host.
 *       - findJwk validates that the token's alg matches the JWK's key type
 *         (algMatchesKty) before use, and rejects alg=none/HS* outright —
 *         without this the token's own header would choose the verify
 *         algorithm (classic algorithm-confusion).
 *       - Multi-valued `aud` additionally requires azp === clientId per OIDC.
 *       - makeDiscoveryCache returns the SAME shape on a cache hit as on a
 *         miss. It used to return its internal record ({ts,meta,jwks}) while
 *         callers read {ok,metadata}, so every login after the first one
 *         within the 1h window was misreported as "discovery failed".
 *       - sendJson accepts optional extra response headers; without it the
 *         state-cookie-clearing Set-Cookie was silently dropped.
 *
 * 0.3.3 — post-login redirect scheme (fixes #6 / #7):
 *
 *   C4. postLoginRedirect() no longer hardcodes "http://". The scheme is now
 *       resolved per request: explicit remote-web-ui.publicBaseUrl (trusted
 *       only when its authority matches the incoming Host) → X-Forwarded-Proto
 *       / RFC 7239 Forwarded → socket.encrypted → http. The authority already
 *       came from the request Host (#6); this closes the remaining HTTPS
 *       reverse-proxy case (#7) where the backend kept handing out http://
 *       redirects and the browser died against the TLS port. The login page
 *       carries a one-way client-side fallback (https page + same-origin
 *       http:// target → upgrade to https).
 *
 * 0.3.2 — v0.1.2-alpha.2 core compatibility (by dsh adaption):
 *
 *   C1. Event-stream WebSocket moved from /api/events.mux+/api/events.host
 *       to /api/remote.mux (owned by dsh-api-gateway). The gate now wraps
 *       whichever of those upgrade routes exist, so it can never again report
 *       a permanent "upgrade route not registered" failure on alpha.2+.
 *   C2. alpha.2 core ships its own Connection browser auth (launch-token
 *       exchange → origin-bound signed cookie) protecting / and /api. The
 *       old loopback deputy (Host rewrite + Origin/Fetch-Metadata strip) is
 *       therefore only applied against legacy cores that still carry the
 *       PRIVILEGED_METHODS fence — on alpha.2+ the request passes through
 *       untouched so the core's own cookie/Host fence decides.
 *   C3. After a successful plugin login/setup the browser is redirected to
 *       the core's authenticated root URL (launch-token query) so the core
 *       cookie exchange runs too; without it the core would 401 every /api
 *       call and the index page, dead-locking the session behind two gates.
 *
 * Upstream credit: authentication architecture, login page, settings UI,
 * and the scrypt credential format originate from Yuuz12/dsh-webui-auth
 * (MIT). This fork keeps the on-disk formats compatible where possible.
 *
 * Routes protected (all via runtime wrapping of the webServer service):
 *   - prefix ""    : SPA resources (302 to login page)
 *   - prefix "/plugins": client plugin bundles (302 to login page)
 *   - prefix "/api"     : RPC surface (401)
 *   - upgrades /api/remote.mux (+ legacy /api/events.mux, /api/events.host): (reject upgrade)
 *
 * Sessions: server-side, persisted across restarts (H3), carried by an
 * HttpOnly cookie `dsh_wua_session`; changing the password revokes every
 * other session.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac, createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, accessSync, mkdirSync, unlinkSync, constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

export const name = 'dsh-webui-oauth'

export const inject = ['webServer', 'fs']

// ---------------- 密码哈希：scrypt（与上游相同的参数与存储格式） ----------------

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const SCRYPT_PREFIX = 'scrypt:'

const scrypt = promisify(scryptCb)

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64')
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM })
  return SCRYPT_PREFIX + SCRYPT_N + ':' + SCRYPT_R + ':' + SCRYPT_P + ':' + salt + ':' + derived.toString('base64')
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith(SCRYPT_PREFIX)) return false
  const parts = stored.split(':')
  if (parts.length !== 6) return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = parts[4]
  let expected = null
  try { expected = Buffer.from(parts[5], 'base64') } catch (e) { return false }
  if (!Number.isInteger(n) || n < 1024 || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1 || !expected || expected.length === 0) return false
  try {
    const derived = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: SCRYPT_MAXMEM })
    return timingSafeEqual(derived, expected)
  } catch (e) {
    return false
  }
}

let dummyHashPromise = null
function dummyHash() {
  if (dummyHashPromise === null) {
    dummyHashPromise = hashPassword(randomBytes(8).toString('hex')).catch((e) => {
      dummyHashPromise = null
      throw e
    })
  }
  return dummyHashPromise
}
async function dummyVerify(password) {
  const h = await dummyHash()
  return verifyPassword(password, h)
}

// 供测试与工具脚本使用（Cordis 加载时只消费 name/inject/apply，多余导出无副作用）
export { hashPassword, verifyPassword, auditLog, readAuditEntries, resolveDataDirFrom, DATA_DIR, resolveRedirectScheme, postLoginRedirect, readOidcConfig, writeOidcConfig, configPath, oidcConfigPath, sendJson, makeOidcStateStore }

// ---------------- 数据目录与文件 ----------------

function pluginDir() {
  try {
    let url = import.meta.url
    const q = url.indexOf('?')
    if (q !== -1) url = url.slice(0, q)
    const h = url.indexOf('#')
    if (h !== -1) url = url.slice(0, h)
    if (url.startsWith('file://')) {
      let p = url.slice('file://'.length)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      p = decodeURIComponent(p)
      const slash = p.lastIndexOf('/')
      if (slash > 0) return p.slice(0, slash)
    }
  } catch (e) { /* fall through to the home fallback */ }
  return null
}

function legacyHomeDir() {
  const home = process.env.DSH_HOME
    || ((process.env.USERPROFILE || process.env.HOME || '.') + '/.dsh')
  return home.replace(/\\/g, '/').replace(/\/+$/, '') + '/dsh-webui-auth'
}

function resolveDataDirFrom(dir) {
  // npm/GitHub/tarball 安装：包体位于某个 node_modules 之内，会随插件升级、重装、
  // 清理 node_modules 被整目录替换——凭据等运行数据必须放在该 node_modules 的上级
  // 目录下的 .dsh-webui-auth/ 才能存活。取【第一段】node_modules：pnpm 的真实路径形如
  // .../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>，只有最外层 node_modules
  // 的上级（通常是 profile 根）才是稳定位置。link/源码安装时 Node 已把 import.meta.url
  // 解析为真实路径，不含 node_modules 段，走原有逻辑（数据在源码目录，随仓库管理）。
  //
  // 注意：数据目录名沿用原版的 `.dsh-webui-auth`（**刻意不改**）。本插件是原版
  // dsh-webui-auth 的替代品，用户很可能已有账号与登录会话；换名会导致"装上就丢账号"。
  if (dir) {
    const norm = dir.replace(/\\/g, '/')
    const cut = norm.indexOf('/node_modules/')
    if (cut !== -1) {
      const root = norm.slice(0, cut) || '/'
      const dataDir = root + '/.dsh-webui-auth'
      try {
        mkdirSync(dataDir, { recursive: true })
        accessSync(dataDir, fsConstants.W_OK)
        return dataDir
      } catch (e) { /* 上级目录不可写：继续走回退链 */ }
    }
  }
  if (dir) {
    try {
      accessSync(dir, fsConstants.W_OK)
      return dir
    } catch (e) { /* store/只读目录：回退 */ }
  }
  return legacyHomeDir()
}

/**
 * 源码 / link 安装下，数据就在插件源码目录内。改包名后（dsh-webui-auth →
 * dsh-webui-oauth）目录名变了，直接取自身目录会看不到原版留下的账号。
 * 这里检查【同级】是否存在原版目录且含凭据；有则优先复用它，实现无缝接管。
 * 仅在自身目录尚无凭据时才复用，避免覆盖本插件已经产生的数据。
 */
function adoptOriginalDataDir(selfDir) {
  // 自身已有凭据：不接管，避免覆盖用户已在新插件里建立的数据。
  if (selfDir) {
    try {
      accessSync(selfDir + '/dsh-webui-auth.json', fsConstants.R_OK)
      return selfDir
    } catch (e) { /* 自身无凭据：继续向下查找 */ }
  }
  const candidates = []
  // 1) 同级目录（源码 / link 安装最常见）
  if (selfDir) {
    const norm = selfDir.replace(/\\/g, '/')
    const slash = norm.lastIndexOf('/')
    if (slash > 0) {
      const base = norm.slice(slash + 1)
      // 仅在目录名带 dsh-webui- 前缀时才认为"旁边可能躺着原版"，避免误认。
      if (base.startsWith('dsh-webui-')) {
        const sibling = norm.slice(0, slash) + '/dsh-webui-auth'
        if (sibling !== norm) candidates.push(sibling)
      }
    }
  }
  // 2) 原版兜底位置 $DSH_HOME/dsh-webui-auth/
  try {
    const legacy = legacyHomeDir()
    if (!candidates.includes(legacy)) candidates.push(legacy)
  } catch (e) { /* ignore */ }

  for (const dir of candidates) {
    try {
      accessSync(dir + '/dsh-webui-auth.json', fsConstants.R_OK)
      return dir
    } catch (e) { /* 该候选无凭据：试下一个 */ }
  }
  return selfDir
}

const MODULE_DIR = pluginDir()

/**
 * 数据目录。支持用 DSH_WEBUI_AUTH_DATA_DIR 显式覆盖——运维在容器/只读包体等
 * 特殊部署下可指定位置；测试也依赖它把数据落到临时目录，避免污染源码目录。
 */
function resolveDataDir() {
  const override = process.env.DSH_WEBUI_AUTH_DATA_DIR
  if (typeof override === 'string' && override.trim()) {
    const dir = override.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    try {
      mkdirSync(dir, { recursive: true })
      accessSync(dir, fsConstants.W_OK)
      return dir
    } catch (e) { /* 不可写：忽略覆盖，走常规解析 */ }
  }
  return resolveDataDirFrom(adoptOriginalDataDir(MODULE_DIR))
}

const DATA_DIR = resolveDataDir()

/**
 * 凭据文件：**刻意沿用原版文件名** `dsh-webui-auth.json`。
 * 这里存的是原版就有的 username / hash / ttl；换了名字用户的账号就找不到了。
 */
function configPath() {
  return DATA_DIR + '/dsh-webui-auth.json'
}

/**
 * 本插件独有的配置文件：`dsh-webui-oauth.json`，目前存放 OIDC 段
 * （issuer / clientId / clientSecret / scope / redirectBase / trustBrowserOrigin）。
 *
 * 为什么要独立成文件，而不是继续塞进 dsh-webui-auth.json 的 oidc 段：
 *   1. 语义自洽——OIDC 是本插件独有的能力，原版没有这个功能，配置却存在
 *      一个叫 dsh-webui-auth.json 的文件里，运维看目录会困惑"这份 secret
 *      到底归谁"；
 *   2. 让"接管/复制原版数据"安全——原版数据只有 dsh-webui-auth.json，
 *      复制时不必担心把 clientSecret 复制成两份、两边各自修改而分叉；
 *   3. 向后兼容——旧版曾把 oidc 段写在 dsh-webui-auth.json 里，读取时
 *      仍会回落到那一段（见 readOidcConfig），首次写入新文件时完成迁移。
 */
function oidcConfigPath() {
  return DATA_DIR + '/dsh-webui-oauth.json'
}

/** H3: 会话持久化文件（JSONL，一行一个会话）。 */
function sessionsPath() {
  return DATA_DIR + '/sessions.jsonl'
}

/** H5: HMAC 密钥文件，用于审计 IP 的假名化。 */
function hmacKeyPath() {
  return DATA_DIR + '/audit-hmac-key'
}

function ensureDataDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
  } catch (e) { /* 目录存在或创建失败：后续写入会报错并被上层捕获 */ }
}

async function readCredentials(ctx) {
  let raw = null
  try {
    const target = await ctx.fs.resolve(configPath())
    raw = await ctx.fs.readText(target)
  } catch (e) {
    raw = null
  }
  let parsed = null
  if (raw) {
    try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
  }
  if (parsed && typeof parsed === 'object') return parsed
  return null
}

async function writeCredentials(ctx, creds) {
  ensureDataDir()
  const target = await ctx.fs.resolve(configPath())
  await ctx.fs.writeText(target, JSON.stringify(creds), undefined, undefined, { mode: 'danger-full-access' })
}

/**
 * 读取 OIDC 配置。优先独立文件 dsh-webui-oauth.json；不存在时回落到
 * dsh-webui-auth.json 的 oidc 段（旧版布局），实现无感升级。
 * 返回 { oidc, legacy } —— legacy 为 true 表示来源是旧布局（下次写入会迁移）。
 */
async function readOidcConfig(ctx, creds) {
  let raw = null
  try {
    const target = await ctx.fs.resolve(oidcConfigPath())
    raw = await ctx.fs.readText(target)
  } catch (e) {
    raw = null
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.oidc && typeof parsed.oidc === 'object') {
        return { oidc: parsed.oidc, legacy: false }
      }
    } catch (e) { /* 文件损坏：继续回落旧布局 */ }
  }
  // 旧布局：oidc 段曾在凭据文件里
  const legacyOidc = creds && creds.oidc && typeof creds.oidc === 'object' ? creds.oidc : null
  if (legacyOidc) return { oidc: legacyOidc, legacy: true }
  return { oidc: null, legacy: false }
}

/** 写入 OIDC 配置（独立文件，0600 由数据目录权限兜底）。 */
async function writeOidcConfig(ctx, oidc) {
  ensureDataDir()
  const target = await ctx.fs.resolve(oidcConfigPath())
  await ctx.fs.writeText(target, JSON.stringify({ v: 1, oidc }), undefined, undefined, { mode: 'danger-full-access' })
}

/** 从凭据对象里剥离历史遗留的 oidc 段（迁移到独立文件后不再重复保存）。 */
function stripLegacyOidc(creds) {
  if (!creds || typeof creds !== 'object') return creds
  if (!Object.prototype.hasOwnProperty.call(creds, 'oidc')) return creds
  const copy = { ...creds }
  delete copy.oidc
  return copy
}

function isEnabled(creds) {
  return !!(creds && typeof creds.username === 'string' && typeof creds.hash === 'string')
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/

function usernameError(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3-32 位字母、数字、下划线或连字符'
  }
  return null
}

// ---------------- 审计日志（H5：IP 假名化） ----------------

const AUDIT_FILE = 'audit.jsonl'

function auditFileForCli() {
  return DATA_DIR + '/' + AUDIT_FILE
}

async function auditFilePath(ctx) {
  try {
    const r = await ctx.fs.resolve(DATA_DIR + '/' + AUDIT_FILE)
    if (r && typeof r.displayPath === 'string') return r.displayPath
    if (r && typeof r.targetKey === 'string') return r.targetKey
  } catch (e) { /* fall through */ }
  return DATA_DIR + '/' + AUDIT_FILE
}

/**
 * H5: 审计 IP 假名化。HMAC-SHA256(key, ip) 取前 8 hex，再附 /24（IPv4）
 * 或 /64（IPv6）网络前缀明文，便于聚合分析同时不落原始地址。
 * 密钥文件首次生成，0600，与凭据同目录。
 */
let auditHmacKeyCache = null
function auditHmacKey() {
  if (auditHmacKeyCache !== null) return auditHmacKeyCache
  const kp = hmacKeyPath()
  try {
    const existing = readFileSync(kp, 'utf8').trim()
    if (existing.length >= 32) {
      auditHmacKeyCache = existing
      return existing
    }
  } catch (e) { /* not present yet */ }
  ensureDataDir()
  const key = randomBytes(32).toString('hex')
  try {
    writeFileSync(kp, key + '\n', { mode: 0o600 })
    auditHmacKeyCache = key
    return key
  } catch (e) {
    // 落盘失败：仍缓存本次生成的 key，保证同一进程内同一 IP 的假名一致（可聚合）
    auditHmacKeyCache = 'fallback-key-unavailable-' + key.slice(0, 8)
    return auditHmacKeyCache
  }
}

function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return null
  let pseudo = null
  try {
    pseudo = createHmac('sha256', auditHmacKey()).update(ip).digest('hex').slice(0, 8)
  } catch (e) {
    pseudo = 'err'
  }
  // 网络 /24 或 /64 前缀（聚合分析用）；IPv4-mapped IPv6（::ffff:a.b.c.d）先还原为 IPv4，
  // 否则会产出 "::ffff:1.2.3.0/24" 这类畸形前缀。
  let v = ip
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) v = mapped[1]
  let net = null
  if (v.includes('.')) {
    const parts = v.split('.').slice(0, 3).join('.')
    net = parts + '.0/24'
  } else {
    const groups = v.split(':').slice(0, 4).join(':')
    net = groups + '::/64'
  }
  return `hmac:${pseudo}|${net}`
}

async function auditLog(ctx, event, fields) {
  let target = null
  try {
    target = await auditFilePath(ctx)
    if (!target) return
    ensureDataDir()
    const entry = { ts: new Date().toISOString(), event }
    for (const key of Object.keys(fields || {})) {
      let v = fields[key]
      if (v === undefined) continue
      if (key === 'ip' && typeof v === 'string') v = anonymizeIp(v)
      entry[key] = typeof v === 'string' || typeof v === 'number' ? v : String(v)
    }
    appendFileSync(target, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    try {
      ctx.logger.warn('[dsh-webui-oauth] audit write failed: ' + (e && e.message ? e.message : String(e)))
    } catch (err) { /* ignore */ }
  }
}

function requestMeta(req) {
  let ip = null
  try { ip = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : null } catch (e) { /* ignore */ }
  // H4: 反代场景取真实客户端 IP。仅当 socket 是回环（本机 caddy/cloudflared）时信任代理头，
  // 且取 X-Forwarded-For 最左侧（最初的客户端），CF-Connecting-IP 次之。
  if (ip && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
    try {
      const cf = req.headers['cf-connecting-ip']
      if (typeof cf === 'string' && cf.trim()) {
        ip = cf.trim()
      } else {
        const xff = req.headers['x-forwarded-for']
        if (typeof xff === 'string' && xff.trim()) {
          ip = xff.split(',')[0].trim() || ip
        }
      }
    } catch (e) { /* keep socket address */ }
  }
  let ua = null
  try { ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null } catch (e) { /* ignore */ }
  return { ip, ua }
}

async function readAuditEntries(ctx, limit) {
  let target = null
  try {
    target = await auditFilePath(ctx)
    if (!target) return []
    const lines = readFileSync(target, 'utf8').split('\n').filter((l) => l.trim())
    const out = []
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])) } catch (e) { /* skip malformed line */ }
    }
    return out
  } catch (e) {
    return []
  }
}

// ---------------- 会话有效期 / 密码强度 ----------------

const TTL_OPTIONS = [0, 1, 12, 24, 72]
const TTL_DEFAULT = 12
const SESSION_BROWSER_TTL_MS = 30 * 60 * 1000

function ttlOf(creds) {
  return (creds && typeof creds.ttl === 'number' && TTL_OPTIONS.includes(creds.ttl)) ? creds.ttl : TTL_DEFAULT
}

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~]/

function passwordStrength(p) {
  if (typeof p !== 'string' || p.length < 8) return { ok: false, reason: 'length' }
  if (!/[a-z]/.test(p)) return { ok: false, reason: 'lower' }
  if (!/[A-Z]/.test(p)) return { ok: false, reason: 'upper' }
  if (!/[0-9]/.test(p)) return { ok: false, reason: 'digit' }
  if (!SPECIAL_CHARS.test(p)) return { ok: false, reason: 'special' }
  return { ok: true, reason: null }
}

// ---------------- HTTP 工具 ----------------

function sendJson(res, status, body, extraHeaders) {
  const text = JSON.stringify(body)
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  }
  // Set-Cookie 是唯一允许重复的响应头：一次响应可能既要下发会话 Cookie、又要清除
  // 一次性的 state Cookie。普通对象合并会互相覆盖，故这里把 Set-Cookie 收集成数组
  // （node:http 对数组值会逐条写出多个同名头）。
  const setCookies = []
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const k of Object.keys(extraHeaders)) {
      if (k.toLowerCase() === 'set-cookie') {
        const v = extraHeaders[k]
        if (Array.isArray(v)) setCookies.push(...v)
        else if (v !== undefined) setCookies.push(v)
        continue
      }
      headers[k] = extraHeaders[k]
    }
  }
  if (setCookies.length === 1) headers['Set-Cookie'] = setCookies[0]
  else if (setCookies.length > 1) headers['Set-Cookie'] = setCookies
  res.writeHead(status, headers)
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req, res) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch (e) {
    sendJson(res, 400, { error: '请求体不是有效 JSON' })
    return null
  }
}

function cookieOf(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * 恒定时间令牌比较：先对两侧做 HMAC-SHA256 归一化（消除长度侧信道），
 * 再 timingSafeEqual。用于 setup token 校验（128-bit 随机值，网络时序本难利用，
 * 但恒定时间是正确的习惯）。
 */
function safeTokenEquals(supplied, expected) {
  const a = createHmac('sha256', 'dsh-webui-auth-token-cmp').update(String(supplied)).digest()
  const b = createHmac('sha256', 'dsh-webui-auth-token-cmp').update(String(expected)).digest()
  return timingSafeEqual(a, b)
}

// ---------------- 会话管理（H3：持久化到磁盘） ----------------

const COOKIE_NAME = 'dsh_wua_session'
// OIDC 登录 CSRF 绑定 Cookie：与 state 同值，回调时必须一致。
const COOKIE_OIDC_STATE = 'dsh_wua_oidc_state'

function sessionCookie(token, maxAgeSeconds) {
  let c = COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/'
  if (maxAgeSeconds !== undefined) c += '; Max-Age=' + maxAgeSeconds
  return c
}

function clearSessionCookie() {
  return COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
}

/**
 * H3: 持久化会话存储。
 * - 内存 Map 为热路径；每次创建/删除都追加 JSONL 事件（add/remove），启动时重放恢复。
 * - 重放规则：按行序应用 add/remove；过期的会话在重放时丢弃。
 * - 文件损坏（个别行解析失败）跳过该行，不影响其余会话。
 */
class PersistentSessions {
  constructor() {
    this.live = new Map()
    this.ok = true // 持久化通道健康标志（写失败置 false，不影响认证本身）
  }

  load() {
    let lines = []
    try {
      lines = readFileSync(sessionsPath(), 'utf8').split('\n').filter((l) => l.trim())
    } catch (e) { return /* 无文件 = 全新状态 */ }
    for (const line of lines) {
      let ev = null
      try { ev = JSON.parse(line) } catch (e) { continue }
      if (!ev || typeof ev.op !== 'string' || typeof ev.token !== 'string') continue
      if (ev.op === 'add' && ev.sess && typeof ev.sess === 'object') {
        const s = { username: String(ev.sess.username || ''), expiresAt: Number(ev.sess.expiresAt) || 0, browser: !!ev.sess.browser }
        if (s.expiresAt > Date.now()) this.live.set(ev.token, s)
      } else if (ev.op === 'remove') {
        this.live.delete(ev.token)
      } else if (ev.op === 'remove-many' && Array.isArray(ev.tokens)) {
        for (const t of ev.tokens) this.live.delete(t)
      } else if (ev.op === 'clear') {
        this.live.clear()
      }
    }
  }

  append(ev) {
    try {
      ensureDataDir()
      // 会话 token 是裸的 bearer 凭据：文件权限收紧到 0600（与 setup-token / audit-hmac-key 一致）
      appendFileSync(sessionsPath(), JSON.stringify(ev) + '\n', { encoding: 'utf8', mode: 0o600 })
      this.ok = true
    } catch (e) {
      this.ok = false // 磁盘写失败：认证继续，仅丢失重启恢复能力
    }
  }

  // 压缩：live 状态整体重写（启动时调用一次，防止文件无限增长）
  compact() {
    try {
      ensureDataDir()
      const out = []
      const now = Date.now()
      for (const [token, s] of this.live) {
        if (s.expiresAt > now) out.push({ op: 'add', token, sess: s })
      }
      writeFileSync(sessionsPath(), out.map((e) => JSON.stringify(e)).join('\n') + (out.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 })
    } catch (e) { /* 压缩失败不影响运行 */ }
  }

  get(token) { return this.live.get(token) }
  has(token) { return this.live.has(token) }
  delete(token) {
    this.live.delete(token)
    this.append({ op: 'remove', token })
  }
  set(token, sess) {
    this.live.set(token, sess)
    this.append({ op: 'add', token, sess })
  }
  // 批量移除（除 keepToken 外全部）：只追加一条 remove-many 事件，避免逐个 append 的写放大
  deleteAllExcept(keepToken) {
    const removed = []
    for (const k of [...this.live.keys()]) {
      if (k !== keepToken) {
        this.live.delete(k)
        removed.push(k)
      }
    }
    if (removed.length > 0) this.append({ op: 'remove-many', tokens: removed })
  }
  clear() {
    this.live.clear()
    this.append({ op: 'clear', token: '*' })
  }
}

// ---------------- 登录页（与上游一致，追加 setup-token 输入框） ----------------

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>DSH WebUI 认证</title>
<style>
  body {
    --dsw-alias-bg-base: rgb(255, 255, 255);
    --dsw-alias-bg-layer-1: rgb(255, 255, 255);
    --dsw-alias-bg-layer-2: rgb(255, 255, 255);
    --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
    --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
    --dsw-alias-label-primary: rgb(15, 17, 21);
    --dsw-alias-label-secondary: rgb(97, 102, 107);
    --dsw-alias-brand-primary: rgb(15, 17, 21);
    --dsw-alias-state-error-primary: rgb(236, 19, 19);
    --dsw-alias-state-success-primary: rgb(34, 197, 94);
    --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  }
  body[data-ds-dark-theme] {
    --dsw-alias-bg-base: rgb(21, 21, 23);
    --dsw-alias-bg-layer-1: rgb(35, 35, 36);
    --dsw-alias-bg-layer-2: rgb(44, 44, 46);
    --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
    --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
    --dsw-alias-label-primary: rgb(249, 250, 251);
    --dsw-alias-label-secondary: rgb(207, 211, 214);
    --dsw-alias-brand-primary: rgb(249, 250, 251);
    --dsw-alias-state-error-primary: rgb(242, 90, 90);
    --dsw-alias-state-success-primary: rgb(34, 197, 94);
    --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--dsw-alias-bg-base, #f7f7f8); font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .card { width: 340px; max-width: calc(100vw - 48px); padding: 28px 24px; box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #ddd);
    border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,.08); }
  h1 { margin: 0 0 4px; font-size: 18px; color: var(--dsw-alias-label-primary, #222); }
  .sub { margin: 0 0 6px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); }
  label { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); margin: 12px 0 5px; }
  input { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222);
    background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; outline: none; }
  input:focus { border-color: var(--dsw-alias-brand-primary, #4a7cf7); }
  input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
    -webkit-text-fill-color: var(--dsw-alias-label-primary, #222);
    -webkit-box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset;
    box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset;
    caret-color: var(--dsw-alias-label-primary, #222);
    transition: background-color 999999s ease-in-out 0s;
  }
  button { width: 100%; margin-top: 18px; padding: 8px 18px; font-size: 13px; cursor: pointer;
    color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-1, #fff);
    border: 1px solid var(--dsw-alias-border-l2, #999); border-radius: 4px; }
  button:disabled { opacity: .55; cursor: default; }
  .sso-row { display: none; margin-top: 12px; }
  .sso-btn { margin-top: 0; }
  .sso-sep { margin: 16px 0 0; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }
  .sso-sep::before, .sso-sep::after { content: ''; display: inline-block; width: 36px; height: 1px;
    background: var(--dsw-alias-border-l2, #ccc); vertical-align: middle; margin: 0 10px; }
  .err { display: none; margin: 10px 0 0; font-size: 12px; color: var(--dsw-alias-state-error-primary, #d1242f); }
  .hint { margin: 14px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888);
    border-top: 1px solid var(--dsw-alias-border-l1, #e5e5e5); padding-top: 10px; }
  .token-row { display: none; }
</style>
</head>
<body>
<script>
(function () {
  var preference = "__THEME_PREFERENCE__";
  if (preference !== 'light' && preference !== 'dark') preference = 'system';
  var mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    var systemDark = preference === 'system' && !!mq && mq.matches;
    var dark = preference === 'dark' || systemDark;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.toggleAttribute('data-ds-dark-theme', dark);
  }
  apply();
  if (preference === 'system' && mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
    else if (typeof mq.addListener === 'function') mq.addListener(apply);
  }
})();
</script>
<div class="card">
  <h1>DSH WebUI</h1>
  <p class="sub" id="sub"></p>
  <form id="f">
    <div class="token-row" id="tokenrow">
      <label for="t">初始化令牌（见 dsh 启动日志）</label>
      <input id="t" type="password" autocomplete="off" spellcheck="false">
    </div>
    <label for="u">用户名</label>
    <input id="u" type="text" autocomplete="username" autofocus spellcheck="false">
    <label for="p" id="pl">密码</label>
    <input id="p" type="password" autocomplete="current-password">
    <div id="pc" style="display:none">
      <label for="p2">确认密码</label>
      <input id="p2" type="password" autocomplete="new-password">
    </div>
    <button id="b" type="submit">登录</button>
    <p class="err" id="e"></p>
    <div class="sso-row" id="ssorow">
      <p class="sso-sep">或</p>
      <button class="sso-btn" id="sso" type="button">使用 SSO 单点登录</button>
    </div>
  </form>
  <p class="hint">忘记密码：删除插件数据目录的 dsh-webui-auth.json 文件即可重置。</p>
</div>
<script>
var MODE = "__MODE__";
var OIDC_ENABLED = "__OIDC_ENABLED__";
var sub = document.getElementById('sub'), pl = document.getElementById('pl'), pc = document.getElementById('pc'), e = document.getElementById('e'),
  u = document.getElementById('u'), p = document.getElementById('p'), p2 = document.getElementById('p2'), b = document.getElementById('b'),
  f = document.getElementById('f'), t = document.getElementById('t'), tokenrow = document.getElementById('tokenrow'),
  ssorow = document.getElementById('ssorow'), sso = document.getElementById('sso');
function show(msg) { e.textContent = msg; e.style.display = 'block'; }
if (MODE === 'setup') {
  sub.textContent = '首次使用：输入初始化令牌并创建管理员账号密码，之后访问 WebUI 需要登录。';
  tokenrow.style.display = 'block';
  pl.textContent = '密码（至少 8 位，含大小写、数字、特殊符号）';
  pc.style.display = 'block';
  b.textContent = '创建账号';
} else {
  sub.textContent = '此界面已启用身份认证，请登录后继续使用。';
}
// SSO 入口：仅登录模式且 OIDC 已配置时显示。跳转交给浏览器自身决定的重定向
// （base 由 location.origin 上报；服务端 trustBrowserOrigin=true 时优先采信）。
if (OIDC_ENABLED === 'true' && MODE === 'login') {
  ssorow.style.display = 'block';
}
if (sso) {
  sso.addEventListener('click', function () {
    var base = location.origin || '';
    var target = '/dsh-webui-oauth/oidc/login' + (base ? '?base=' + encodeURIComponent(base) : '');
    location.href = target;
  });
}
function validUsername(name) { return /^[A-Za-z0-9_-]{3,32}$/.test(name); }
function goTo(target) {
  var url = (typeof target === 'string' && target) ? target : '/';
  // 兜底（0.3.3）：页面跑在 https 下、后端却返回同源 http:// 地址时（旧后端 /
  // 反代未下发 X-Forwarded-Proto），浏览器会拿明文请求去撞 TLS 端口 → 握手
  // 失败、页面「点了没反应」。仅同 authority 单向升级 https，反向不动（不降级）。
  try {
    if (location.protocol === 'https:' && url.slice(0, 7) === 'http://') {
      if (new URL(url).host === location.host) { location.href = 'https://' + url.slice(7); return; }
    }
  } catch (err) { /* fall through */ }
  location.href = url;
}
f.addEventListener('submit', function (ev) {
  ev.preventDefault();
  var username = u.value.trim(), password = p.value, token = t ? t.value.trim() : '';
  if (MODE === 'setup') {
    if (!token) return show('请输入初始化令牌（dsh 启动日志中查找 [dsh-webui-oauth] setup token）');
    if (!validUsername(username)) return show('用户名需为 3-32 位字母、数字、下划线或连字符');
    if (password.length < 8) return show('密码至少需要 8 位');
    if (!/[a-z]/.test(password)) return show('密码必须包含小写字母');
    if (!/[A-Z]/.test(password)) return show('密码必须包含大写字母');
    if (!/[0-9]/.test(password)) return show('密码必须包含数字');
    if (!/[!@#$%^&*()_+\\-=\\[\\]{}|;:,.<>?/~]/.test(password)) return show('密码必须包含特殊符号');
    if (password !== p2.value) return show('两次输入的密码不一致');
  }
  b.disabled = true; b.textContent = '请稍候…';
  var body = { username: username, password: password };
  if (MODE === 'setup') body.token = token;
  fetch(MODE === 'setup' ? '/dsh-webui-oauth/setup' : '/dsh-webui-oauth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(function (r) {
    if (r && r.ok) { goTo(r.redirect); return; }
    b.disabled = false; b.textContent = MODE === 'setup' ? '创建账号' : '登录';
    if (r && r.error === 'rate-limited') show('尝试次数过多，请一分钟后重试');
    else if (r && r.error === 'setup-token-required') show('初始化令牌缺失或不正确（见 dsh 启动日志）');
    else if (r && r.error === 'weak-password') show('密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号');
    else if (r && r.error === 'username-invalid') show('用户名需为 3-32 位字母、数字、下划线或连字符');
    else if (r && r.error === 'not-configured') show('凭据尚未配置，请刷新页面后重新创建');
    else if (r && r.error === 'already-configured') show('认证已启用，请使用登录模式');
    else show(MODE === 'setup' ? '创建失败，请检查输入' : '用户名或密码错误');
  }).catch(function () {
    b.disabled = false; b.textContent = MODE === 'setup' ? '创建账号' : '登录';
    show('无法连接认证服务，请刷新重试');
  });
});
</script>
</body>
</html>`

// ---------------- H2: 运行时路由包装（零核心补丁） ----------------
//
// /api 与 WebSocket 的会话闸门通过包装 webServer 服务的路由表实现：
// 1. 对已注册的 /api prefix 路由与 /api/events.* upgrade 路由做 handler 原地包装；
// 2. 同时替换 prefixes/upgrades 为带拦截的 Map，捕获后续注册（如热重载/插件管理器）；
// 3. 卸载（effect disposer）时恢复原始 handler 与原始 Map —— 完全可逆。
//
// 若找不到预期路由（dsh 内部结构变化），shapeCheck 失败并明确报错，
// 且 setup/configure 拒绝启用闸门（fail-closed：宁可不可用，不可裸奔）。

const API_PREFIX = '/api'
const PLUGINS_PREFIX = '/plugins'
// alpha.2 起事件流 WebSocket 由 dsh-api-gateway 的 /api/remote.mux 承载；
// 旧的 events.mux/events.host 已删除。候选列表按"存在即包装"，兼容新旧核心。
const UPGRADE_CANDIDATES = ['/api/remote.mux', '/api/events.mux', '/api/events.host']

function rejectUpgrade401(socket) {
  try {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 13\r\n\r\nunauthorized\n')
  } catch (e) { /* ignore */ }
  try { socket.destroy() } catch (e) { /* ignore */ }
}

// ---------------- 顶掉原版 dsh-webui-auth ----------------
//
// 本插件（dsh-webui-oauth）是原版 dsh-webui-auth 的增强替代。两者都通过运行时包装
// webServer 路由实现认证：同时加载会出现【双闸门】——同一请求被两套会话校验各拦一次，
// 且两套 /dsh-webui-* 端点并存，登录态互不相认（在一个闸门登录，另一个仍返回 302/401），
// 表现为「登录后反复跳转」。
//
// 因此这里主动停掉已加载的原版：遍历 cordis 插件注册表，按插件名找到原版 runtime，
// 逐个 dispose 它的 fiber。卸掉后原版的 ctx.effect 清理函数会执行，其路由包装与
// 端点注册被完整撤销（原版自身就是可逆设计），随后由本插件接管全部闸门。
//
// 边界：只按【插件名】匹配，不碰任何其他插件；找不到原版时静默继续（正常路径）。
const DISPLACED_PLUGIN_NAMES = ['dsh-webui-auth']

function displaceOriginalPlugins(ctx, log) {
  const displaced = []
  try {
    const registry = ctx.registry
    if (!registry || typeof registry.values !== 'function') return displaced
    // 先收集再 dispose：遍历过程中直接删除会破坏迭代。
    const victims = []
    for (const runtime of registry.values()) {
      const rtName = runtime && runtime.name
      if (typeof rtName === 'string' && DISPLACED_PLUGIN_NAMES.includes(rtName)) {
        victims.push(runtime)
      }
    }
    for (const runtime of victims) {
      // registry.delete(callback) 会 dispose 该插件的全部 fiber；
      // 用 runtime.callback 作为 key（这正是 map 的键）。
      const removed = typeof registry.delete === 'function' ? registry.delete(runtime.callback) : undefined
      const fibers = (removed && removed.fibers) || runtime.fibers
      // 双保险：即使 registry.delete 未生效，也逐个 dispose 掉 fiber。
      if (fibers && typeof fibers[Symbol.iterator] === 'function') {
        for (const fiber of fibers) {
          try {
            if (fiber && typeof fiber.dispose === 'function') fiber.dispose()
          } catch (e) { /* 单个 fiber 清理失败不应阻断接管 */ }
        }
      }
      displaced.push(runtime.name)
    }
  } catch (e) {
    // 注册表结构变化时不能让接管流程崩溃：退化为「不做替换」，
    // 由调用方记录警告，运维可从日志发现双装。
    try { log('displace failed: ' + (e && e.message ? e.message : String(e))) } catch (err) { /* ignore */ }
  }
  return displaced
}

/**
 * 安装运行时路由闸门。带周期重扫：apply() 可能早于 client-connection 的
 * 路由注册执行（loader 波次顺序不保证），每 2 秒重扫路由表直到全部
 * 找到（上限 60 秒）。gate 状态动态更新，供 status 端点与 fail-closed
 * 检查读取。
 * @returns {{ ok: () => boolean, problems: () => string[], undo: () => void }}
 */
function installRouteGate(ctx, checkRequest, log) {
  const ws = ctx.webServer
  const problems = new Set()
  const undos = []
  let undone = false

  const wrapHttp = (route, opts) => {
    const original = route.handler
    const loopbackDeputy = !!(opts && opts.loopbackDeputy)
    // alpha.2 起核心自带 Connection 浏览器认证（BrowserAuth + trusted-host fence）：
    // /api handler 内建 requestRejection，且 browser cookie 按 Host authority 绑定 ——
    // 再改写 Host/Origin 会破坏 cookie 匹配。仅旧核心（无 connection.requestRejection）
    // 需要 loopback 伪装来通过 PRIVILEGED_METHODS fence。
    let coreHasRequestGate = false
    try {
      const connection = ctx.get('connection')
      coreHasRequestGate = !!(connection && typeof connection.requestRejection === 'function')
    } catch (e) { coreHasRequestGate = false }
    const useDeputy = loopbackDeputy && !coreHasRequestGate
    const wrapped = async (req, res) => {
      if (!checkRequest(req)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('unauthorized')
        return
      }
      if (useDeputy) {
        // Authenticated + this is the /api surface on a legacy core: present the request
        // to the core as loopback so PRIVILEGED_METHODS' strict fence (settings.*,
        // credentials.*, agentPreset.*, llm.discoverModels) admits it. Our session gate
        // already proved operator identity — strictly stronger than the Host-header
        // heuristic it replaces for these callers.
        req.headers.host = '127.0.0.1'
        // Origin/Fetch-Metadata 一并移除：以"非浏览器回环客户端"形状呈现。
        // 不能只改写 Origin 的 host——Host 带 127.0.0.1:3080 端口而改写后的
        // Origin 无端口时 host 比对仍不相等（实测 403）。删除后走 fence 的
        // 无-Origin 回环放行路径（实测 200），语义也更干净：代理后的请求
        // 本来就不是浏览器直连。
        delete req.headers.origin
        delete req.headers['sec-fetch-site']
        delete req.headers['sec-fetch-mode']
        delete req.headers['sec-fetch-dest']
      }
      return original(req, res)
    }
    route.handler = wrapped
    return () => { route.handler = original }
  }
  const wrapUpgrade = (route) => {
    const original = route.handler
    const wrapped = (req, socket, head) => {
      if (checkRequest(req)) return original(req, socket, head)
      rejectUpgrade401(socket)
    }
    route.handler = wrapped
    return () => { route.handler = original }
  }

  // 已包装的路由打标记，避免重复包装
  const wrapped = new WeakSet()
  const PROTECTED_PREFIXES = [API_PREFIX, PLUGINS_PREFIX]
  const scanOnce = () => {
    if (undone) return
    for (const pfx of PROTECTED_PREFIXES) {
      const route = ws.prefixes.get(pfx)
      if (route !== undefined && !wrapped.has(route)) {
        wrapped.add(route)
        undos.push(wrapHttp(route, { loopbackDeputy: pfx === API_PREFIX }))
        problems.delete(`prefix route "${pfx}" not registered yet`)
        log(`wrapped prefix route ${pfx}`)
      } else if (route === undefined) {
        problems.add(`prefix route "${pfx}" not registered yet`)
      }
    }
    // alpha.2 起仅存在 /api/remote.mux（由 api-gateway 注册）；旧核心仍用
    // events.mux/events.host。候选列表兼容两代：已注册的全部包装，其余不计问题。
    for (const path of UPGRADE_CANDIDATES) {
      const r = ws.upgrades.get(path)
      if (r !== undefined && !wrapped.has(r)) {
        wrapped.add(r)
        undos.push(wrapUpgrade(r))
        log(`wrapped upgrade route ${path}`)
      }
    }
    if (UPGRADE_CANDIDATES.every((path) => ws.upgrades.get(path) === undefined)) {
      problems.add('no upgrade route registered yet (looked for ' + UPGRADE_CANDIDATES.join(', ') + ')')
    } else {
      problems.delete('no upgrade route registered yet (looked for ' + UPGRADE_CANDIDATES.join(', ') + ')')
    }
  }

  scanOnce()

  // 周期重扫：捕获晚注册（loader 波次/服务重挂载）。全找到后停止（但保留
  // 低频兜底扫描，防止服务重建后路由对象被替换）。
  let elapsed = 0
  let scans = 0
  let transitioned = false
  const rescan = setInterval(() => {
    if (undone) { clearInterval(rescan); return }
    scanOnce()
    elapsed += 2
    scans += 1
    if (!transitioned && problems.size === 0 && elapsed > 60) {
      // 全部就位后降频为 10s 兜底（服务 fiber 重建时路由对象会换新）；
      // 仅迁移一次，避免每个 tick 重复创建慢速 interval 造成泄漏。
      transitioned = true
      clearInterval(rescan)
      const slow = setInterval(() => { if (!undone) scanOnce(); else clearInterval(slow) }, 10000)
      undos.push(() => clearInterval(slow))
      return
    }
    if (problems.size > 0 && scans >= 150) {
      // 5 分钟（@2s）内路由始终未注册：停止重扫，保持 fail-closed（setup/configure
      // 不会启用认证）并记录明确错误，避免无限空转。
      clearInterval(rescan)
      log('route gate: stopped rescanning after ' + scans + ' attempts — routes never registered: ' + [...problems].join('; '))
    }
  }, 2000)
  undos.push(() => clearInterval(rescan))

  const undo = () => {
    undone = true
    for (const u of undos.splice(0).reverse()) { try { u() } catch (e) { /* ignore */ } }
  }
  return { ok: () => problems.size === 0, problems: () => [...problems], undo }
}

// ---------------- DSH 外观偏好 ----------------

const THEME_NAMESPACE = 'ui-theme'
const THEME_PREFERENCE_DEFAULT = 'system'

function themePreference(ctx) {
  try {
    const settings = ctx.get('settings')
    if (settings === undefined) return THEME_PREFERENCE_DEFAULT
    const section = settings.get(THEME_NAMESPACE)
    if (section === undefined) return THEME_PREFERENCE_DEFAULT
    const preference = section.preference
    return (preference === 'light' || preference === 'dark') ? preference : THEME_PREFERENCE_DEFAULT
  } catch (e) {
    return THEME_PREFERENCE_DEFAULT
  }
}

// alpha.2 起核心自带 Connection 浏览器认证：/ 与 /api 需要 launch-token 换取的
// 签名 cookie。插件登录成功只是第一道门，还必须引导浏览器完成核心的
// token→cookie 交换，否则后续请求会被核心 401 拦截（死锁）。
// authenticatedUrl(baseUrl) 返回带本进程 launch token 的应用根 URL。
// baseUrl 用请求自身的 Host（保持反代/LAN 场景的 authority 一致；#6），
// scheme 由 resolveRedirectScheme 按请求实际使用的协议解析（0.3.3；#7）。
const PUBLIC_BASE_NAMESPACE = 'remote-web-ui'

// 取首个逗号分隔值并小写化（代理头可能被多级代理追加，如 "https,http"）。
function firstHop(value) {
  return typeof value === 'string' ? value.split(',')[0].trim().toLowerCase() : ''
}

// 从标准代理头解析原始请求协议：X-Forwarded-Proto 优先，其次 RFC 7239 Forwarded。
// 仅接受 http/https 白名单值——同时杜绝 CRLF 头注入与任意 scheme 注入。
function proxyProto(req) {
  try {
    const headers = req && req.headers
    if (!headers) return null
    const xfp = firstHop(headers['x-forwarded-proto'])
    if (xfp === 'http' || xfp === 'https') return xfp
    const forwarded = typeof headers.forwarded === 'string' ? headers.forwarded.split(',')[0] : ''
    const m = /(?:^|;)\s*proto\s*=\s*"?([A-Za-z]+)"?/.exec(forwarded)
    if (m) {
      const p = m[1].toLowerCase()
      if (p === 'http' || p === 'https') return p
    }
  } catch (e) { /* ignore */ }
  return null
}

/**
 * 从标准代理头解析浏览器侧看到的原始主机（authority 形式 host[:port]）。
 * X-Forwarded-Host 优先，其次 RFC 7239 Forwarded 的 host= 参数。
 *
 * 为什么需要它：反代常把 Host 改写成内网回环地址（如 127.0.0.1:3080），此时
 * req.headers.host 已不是浏览器侧地址。若反代下发了原始主机头，采信它才能
 * 在反代场景下正确决定跳转目标。
 *
 * 仅接受 host[:port] 形状（字母/数字/点/连字符/下划线，可选端口；IPv6 加方括号），
 * 且拒绝任何控制字符与路径分隔符——杜绝 CRLF 头注入与把 origin 污染成 URL。
 */
function proxyHost(req) {
  try {
    const headers = req && req.headers
    if (!headers) return null
    const candidate = firstHop(headers['x-forwarded-host'])
      || (() => {
        const forwarded = typeof headers.forwarded === 'string' ? headers.forwarded.split(',')[0] : ''
        const m = /(?:^|;)\s*host\s*=\s*"?([^";\s]+)"?/.exec(forwarded)
        return m ? m[1].trim() : ''
      })()
    const raw = String(candidate || '').trim()
    if (!raw) return null
    if (/[\x00-\x1f\x7f/\\?#@]/.test(raw)) return null
    if (!/^(\[[0-9a-f:]+\]|[a-z0-9._-]+)(:\d{1,5})?$/.test(raw.toLowerCase())) return null
    return raw
  } catch (e) { /* ignore */ }
  return null
}

// 判断 authority 是否指向回环/本机 —— 反代改写 Host 的典型特征。此时服务端
// 不可能从请求 Host 得知浏览器侧地址，配置的确定性 origin 才是正确答案。
const LOOPBACK_NAMES = [
  '127.0.0.1', '::1', '[::1]', 'localhost', '0.0.0.0',
  '::ffff:127.0.0.1', '[::ffff:127.0.0.1]',
]
function isLoopbackHost(host) {
  const raw = String(host || '').trim().toLowerCase()
  if (!raw) return false
  // 逐个候选形态皆比：原样、去尾端口、方括号内地址。
  // 裸 IPv6（"::1"、"::1:3080"）不能用 split(':')[0] 取主机名（会得空串），
  // 用 Realm URL 规范化也不可靠（"::1" 不是合法 URL），故直接做字面比对。
  const candidates = [raw]
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end !== -1) {
      candidates.push(raw.slice(0, end + 1)) // 含方括号的地址
      candidates.push(raw.slice(1, end))    // 去方括号
    }
  } else {
    const i = raw.lastIndexOf(':')
    if (i > 0 && raw.indexOf(':') === i) {
      candidates.push(raw.slice(0, i))       // 普通 host:port → host
    } else if (i > 0 && raw.slice(0, i).includes(':')) {
      candidates.push(raw.slice(0, i))       // 裸 IPv6:port → IPv6
    }
  }
  return candidates.some((c) => LOOPBACK_NAMES.includes(c))
}

// 拆分 authority 为 hostname + 端口（未显式给端口时按 fallbackScheme 取默认值）。
function splitAuthority(authority, fallbackScheme) {
  const raw = String(authority || '').trim().toLowerCase()
  let hostname = raw
  let port = fallbackScheme === 'https' ? '443' : '80'
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end !== -1) {
      hostname = raw.slice(0, end + 1)
      const rest = raw.slice(end + 1)
      if (rest.startsWith(':')) port = rest.slice(1)
    }
  } else {
    const i = raw.lastIndexOf(':')
    if (i !== -1 && raw.indexOf(':') === i) {
      hostname = raw.slice(0, i)
      port = raw.slice(i + 1)
    }
  }
  return { hostname, port }
}

// 操作者显式声明：dsh settings 的 remote-web-ui.publicBaseUrl（如
// "https://dsh.example.com:8443"）。**仅当其 authority 与本次请求的 Host 一致**
// 时才采信，因为：
//   - 局域网直连（http://192.168.x.x:3080）若被改写成公网地址，会跨源跳转、
//     丢掉刚下发的插件会话 Cookie（登录死循环）；
//   - 不做 Host 匹配就等于把用户可控的 Host 变成开放重定向。
function declaredScheme(ctx, host) {
  try {
    const settings = ctx.get('settings')
    if (!settings || typeof settings.get !== 'function') return null
    const section = settings.get(PUBLIC_BASE_NAMESPACE)
    const raw = section && typeof section.publicBaseUrl === 'string' ? section.publicBaseUrl.trim() : ''
    if (!raw) return null
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const scheme = url.protocol.slice(0, -1)
    const declared = splitAuthority(url.host, scheme)
    const incoming = splitAuthority(host, scheme)
    if (declared.hostname !== incoming.hostname || declared.port !== incoming.port) return null
    return scheme
  } catch (e) {
    return null
  }
}

// 解析跳转应使用的 scheme。优先级：
//   1. 操作者显式声明（remote-web-ui.publicBaseUrl，且 authority 匹配）；
//   2. 标准代理头 X-Forwarded-Proto / Forwarded: proto=；
//   3. socket 自身是 TLS（插件直接终结 TLS 时 socket.encrypted 为 true）；
//   4. 兜底 http。
// 刻意**不**使用「非 IP 域名即 https」的猜测：那会把纯 http 的内网域名访问
// （http://nas.local:3080）打成 https 死链。此类部署应显式声明 publicBaseUrl，
// 或让反代下发 X-Forwarded-Proto。
// 1/2 的取值都只影响「发起本次请求的那个浏览器」自身的跳转（三个调用点都在
// 已认证响应内），不构成跨用户影响，也不构成开放重定向。
function resolveRedirectScheme(ctx, req, host) {
  const declared = declaredScheme(ctx, host)
  if (declared) return declared
  const proxied = proxyProto(req)
  if (proxied) return proxied
  try {
    if (req && req.socket && req.socket.encrypted === true) return 'https'
  } catch (e) { /* ignore */ }
  return 'http'
}

function postLoginRedirect(ctx, req) {
  try {
    const conn = ctx.get('connection')
    if (!conn || typeof conn.authenticatedUrl !== 'function') return '/'
    const headerHost = (req && req.headers && typeof req.headers.host === 'string' && req.headers.host.trim())
      ? req.headers.host.trim()
      : ''
    // 浏览器侧地址：原始主机头优先（反代常改写 Host，此时请求 Host 是内网地址），
    // 其次才用请求 Host。这与 scheme 侧的解析（proxyProto 优先于 socket）相对称。
    const proxiedHost = proxyHost(req)
    const brawserHost = proxiedHost || headerHost
    const scheme = brawserHost ? resolveRedirectScheme(ctx, req, brawserHost) : 'http'
    // 与 OIDC 回调共用同一个开关。判据用**浏览器侧地址**：
    //   1. 反代下发了原始主机头 → 它是权威的，据开关决定是否采信（关闭则回退配置）；
    //   2. 否则地址为回环/本机 → 反代改写 Host 的典型特征，服务端无法得知浏览器侧
    //      地址，直接用配置的确定性 origin（publicBaseUrl 来自 settings.yaml，运维可控，
    //      非攻击者可控，不构成开放重定向）；
    //   3. 其余（Host 已透传原始地址）→ 据开关决定，关闭则回退配置。
    const policy = trustedOriginPolicy(ctx, null)
    const configured = configuredOrigin(ctx)
    if (proxiedHost) {
      if (!policy.trust) {
        if (configured !== null) return conn.authenticatedUrl(configured)
      }
    } else if (headerHost && isLoopbackHost(headerHost)) {
      if (configured !== null) return conn.authenticatedUrl(configured)
    } else if (headerHost) {
      if (!policy.trust) {
        if (configured !== null) return conn.authenticatedUrl(configured)
      }
    }
    const host = brawserHost || ('127.0.0.1:' + String((ctx.get('webServer') && ctx.get('webServer').port) || ''))
    return conn.authenticatedUrl(scheme + '://' + host)
  } catch (e) {
    return '/'
  }
}

// ================= OIDC SSO（可选，Logto 为安全基准） =================
//
// 认证模式：authorization_code + PKCE，机密客户端（必须 client_secret）。
// 依据部署者决策：trustBrowserOrigin 默认 true = 交给浏览器自行处理重定向；
// 关闭时仅用 redirectBase。redirectBase 是反代重写 host/origin 时的确定性答案。
//
// 安全要点：
//   - redirect_uri = base + 固定路径 '/dsh-webui-oauth/oidc/callback'，不允许改路径。
//   - state 防 CSRF、nonce 防重放、PKCE S256 防授权码拦截（配合 secret 双重防护）。
//   - id_token 验证：JWKS(RS256) 验签 + iss/aud/exp/iat/nbf/nonce。
//   - 端点仅接受 HTTPS（issuer 必须 https，回调同源由浏览器/配置决定）。
//   - 审计只记录 sanitizeSub() 过滤后的 subject，杜绝注入。

const OIDC_CALLBACK_PATH = '/dsh-webui-oauth/oidc/callback'
// 授权请求状态（state / nonce / PKCE verifier）的存活时间。三次握手应在分钟内
// 完成，10 分钟足够覆盖用户在 IdP 侧慢慢登录的情形，又限制了被滥用的窗口。
const OIDC_STATE_TTL_MS = 10 * 60 * 1000
// 同时在途的授权请求上限。`/oidc/login` 是公开端点，若只按 TTL 淘汰，攻击者可在
// 10 分钟窗口内灌入无上限的 state 把内存撑爆（每条约几百字节）。超过上限时按
// 【最早创建】淘汰，保证正常用户（并发量远低于此）不受影响。
const OIDC_MAX_PENDING_STATES = 1000

// 纯 origin 格式校验：http/https、无 path/query/hash、无 userinfo。
// 刻意**不做** host 匹配——trustBrowserOrigin 语义即"信前端 origin"，
// 这里只挡"明显构造的垃圾值/注入"，保底格式合法性。
export function isValidOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return false
  // 拒绝控制字符（\r \n \t 等）：WHATWG URL 解析器会静默剥离 CRLF 产生看似合法的畸形 URL，
  // 这里在解析前显式拦截，杜绝 CRLF/控制字符注入。
  if (/[\x00-\x1f\x7f]/.test(raw)) return false
  let url
  try {
    url = new URL(raw)
  } catch (e) {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.pathname !== '/' && url.pathname !== '') return false
  if (url.search !== '' || url.hash !== '') return false
  if (url.username !== '' || url.password !== '') return false
  return true
}

/**
 * 统一的"是否采信浏览器可影响的 origin"开关。同一个开关同时约束两处：
 *   - OIDC 回调 base（浏览器上报的前端 location.origin）；
 *   - 登录成功后交给核心的 token 跳转（authority 取自请求 Host，同样由浏览器发出）。
 *
 * 配置位置：dsh settings 的 remote-web-ui 段（部署级）：
 *   remote-web-ui:
 *     publicBaseUrl: 'https://dsh.example.com:8443'   # 关闭开关时的确定性 origin
 *     trustBrowserOrigin: false
 * 省略时默认 true（保持旧行为）；为兼容旧部署，settings 未配置时回退 OIDC 配置对象
 * 内的 trustBrowserOrigin。
 *
 * 刻意**只留开关、不做 origin 白名单**：采信判定本身已有格式校验（isValidOrigin /
 * proxyHost 的形状白名单），且 OIDC 侧还有 PKCE + client_secret + id_token 验签
 * （iss/aud/nonce/jwks）多重把关，密码侧有强度要求——再加一层 origin 白名单属于
 * 重复设防，反而让反代改写 Host 的部署难以配置。
 *
 * @returns {{ trust: boolean }}
 */
export function trustedOriginPolicy(ctx, oidc) {
  let section = null
  try {
    const settings = ctx && typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    if (settings && typeof settings.get === 'function') section = settings.get(PUBLIC_BASE_NAMESPACE)
  } catch (e) { section = null }
  const trust = section && typeof section.trustBrowserOrigin === 'boolean'
    ? section.trustBrowserOrigin
    : (!oidc || oidc.trustBrowserOrigin !== false)
  return { trust }
}

// 取配置的确定性 origin（remote-web-ui.publicBaseUrl 的 scheme://host[:port]）。
// 开关关闭或浏览器侧地址不可得时用它替代。
function configuredOrigin(ctx) {
  try {
    const settings = ctx.get('settings')
    if (!settings || typeof settings.get !== 'function') return null
    const section = settings.get(PUBLIC_BASE_NAMESPACE)
    const raw = section && typeof section.publicBaseUrl === 'string' ? section.publicBaseUrl.trim() : ''
    if (!raw) return null
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.protocol.slice(0, -1) + '://' + url.host
  } catch (e) {
    return null
  }
}

/**
 * 决定 OIDC 回调的 base origin。
 *   trust=true  → 前端 origin 优先（须过 isValidOrigin），缺失/非法则回退 redirectBase；
 *   trust=false → 仅 redirectBase；
 *   两者都不可用 → null（调用方 fail-closed 报错）。
 * policy 省略时回退到 oidc.trustBrowserOrigin（旧配置），再回退默认 true。
 */
export function resolveOidcBase(oidc, frontendOrigin, policy) {
  const trust = policy ? policy.trust : (!oidc || oidc.trustBrowserOrigin !== false)
  const configBase = oidc && typeof oidc.redirectBase === 'string' ? oidc.redirectBase : null
  if (trust) {
    if (isValidOrigin(frontendOrigin)) return frontendOrigin
    if (isValidOrigin(configBase)) return configBase
    return null
  }
  if (isValidOrigin(configBase)) return configBase
  return null
}

// OIDC subject 字符集白名单：OIDC sub 理论是任意字符串，不能直接拼进审计/日志。
// 保留字母数字与常见分隔符，其余转义。返回永不包含换行/引号注入的字符串。
export function sanitizeSub(raw) {
  if (typeof raw !== 'string') return 'unknown'
  const s = raw.replace(/[^\w.\-:/@+]/g, '_').slice(0, 128)
  return s.length ? s : 'unknown'
}

// 一次性随机值（state / nonce / PKCE verifier）。base64url，长度 >= 24 字节熵。
export function oidcRandom(byteLen = 24) {
  return Buffer.from(randomBytes(byteLen)).toString('base64url')
}

function oidcChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

// 安全的 base64url 解码（容忍缺 padding）。
function b64urlDecode(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4) b += '='
  const buf = Buffer.from(b, 'base64')
  if (buf.length === 0 && s) throw new Error('bad base64url')
  return buf
}

// 解析 JWT 三段。返回 { header, payload, sig }，均 base64url 原文。
export function parseJwt(jwt) {
  if (typeof jwt !== 'string') return null
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  let header = null
  let payload = null
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'))
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'))
  } catch (e) {
    return null
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null
  return { header, payload, sig: parts[2] }
}

// 用 JWK 验签：支持 RS256/384/512、ES256/384/512、EdDSA。
// jwk 来自 JWKS（kid 已由调用方挑选）。
// 注意：crypto.verify 的第一个参数是哈希算法名（'sha256'）不是 JWT alg（'RS256'），
// 且它不接收裸 JWK 对象——须用 createPublicKey({key, format:'jwk'}) 转 KeyObject；
// ECDSA JWT 签名是 JOSE 原始 R||S（ieee-p1363），非 DER，须指定 dsaEncoding。
function jwtAlgToDigest(alg) {
  const m = {
    RS256: 'sha256', RS384: 'sha384', RS512: 'sha512',
    ES256: 'sha256', ES384: 'sha384', ES512: 'sha512',
    PS256: 'sha256', PS384: 'sha384', PS512: 'sha512',
  }
  return m[alg] || null
}
export function verifyJwtSignature(jwt, jwk) {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return false
    const data = Buffer.from(parts[0] + '.' + parts[1], 'utf8')
    const sig = b64urlDecode(parts[2])
    const header = parseJwt(jwt) && parseJwt(jwt).header
    const alg = (jwk && jwk.alg) || (header && header.alg)
    if (!alg) return false
    let jwkKey = jwk
    if (jwk && jwk.kty === 'EC') {
      jwkKey = { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
    } else if (jwk && jwk.kty === 'OKP') {
      jwkKey = { kty: 'OKP', crv: jwk.crv, x: jwk.x }
    } else if (jwk && jwk.kty === 'RSA') {
      jwkKey = { kty: 'RSA', n: jwk.n, e: jwk.e }
    }
    const key = createPublicKey({ key: jwkKey, format: 'jwk' })
    if (alg === 'EdDSA') {
      return cryptoVerify(null, data, key, sig)
    }
    const digest = jwtAlgToDigest(alg)
    if (!digest) return false
    // ECDSA JWT 签名采用 JOSE/ieee-p1363 原始 R||S 格式，而 crypto.verify 默认期望 DER——
    // 须显式指定 dsaEncoding，否则 ES384/ES512 会验签失败（ES256 因曲线小偶尔误中）。
    if (alg.startsWith('ES')) {
      return cryptoVerify(digest, data, { key, dsaEncoding: 'ieee-p1363' }, sig)
    }
    return cryptoVerify(digest, data, key, sig)
  } catch (e) {
    return false
  }
}

// 从 JWKS 中按 kid 选 key；无 kid 时取首枚算法匹配的 key。
// 命中 kid 后仍校验 alg 与 key 类型一致：攻击者可用 RSA key 的 kid 配 ES256 头，
// 若直接采信会把"该用哪种算法验签"的决定权交给 token 本身（算法混淆的温床）。
function algMatchesKty(alg, kty) {
  if (alg === 'EdDSA') return kty === 'OKP'
  if (alg.startsWith('RS') || alg.startsWith('PS')) return kty === 'RSA'
  if (alg.startsWith('ES')) return kty === 'EC'
  return false
}
export function findJwk(jwks, header) {
  if (!jwks || !Array.isArray(jwks.keys) || !header) return null
  const alg = typeof header.alg === 'string' ? header.alg : ''
  if (!alg) return null // 无 alg 一律拒绝，不做猜测
  const usable = (k) => !!k && typeof k === 'object' && algMatchesKty(alg, k.kty)
  if (header.kid) {
    const hit = jwks.keys.find((k) => usable(k) && k.kid === header.kid)
    if (hit) return hit
    return null // 指定了 kid 却无匹配（或类型不符）：不再退化为"随便挑一把"
  }
  if (alg.startsWith('RS') || alg.startsWith('PS')) {
    return jwks.keys.find((k) => usable(k)) || null
  }
  if (alg.startsWith('ES')) {
    return jwks.keys.find((k) => usable(k)) || null
  }
  if (alg === 'EdDSA') {
    return jwks.keys.find((k) => usable(k)) || null
  }
  return null
}

// 验证 id_token 的声明与签名。返回 { ok, error, payload }。
// opts: { issuer, clientId, nonce, jwks, now? }
export function validateIdToken(idToken, opts) {
  const parsed = parseJwt(idToken)
  if (!parsed) return { ok: false, error: 'malformed-jwt', payload: null }
  const { header, payload } = parsed
  const now = opts.now || Date.now()

  const iss = payload.iss
  if (typeof iss !== 'string' || iss !== opts.issuer) return { ok: false, error: 'bad-iss', payload }
  // aud 校验：只接受字符串或字符串数组（杜绝 null/数字的类型混淆），
  // 且多值 aud 时按 RFC/OIDC 必须同时校验 azp —— 否则一个针对多个 client
  // 签发的 token 可被我们误认为"发给自己"。
  const aud = payload.aud
  let audOk = false
  if (typeof aud === 'string') {
    audOk = aud === opts.clientId
  } else if (Array.isArray(aud) && aud.every((a) => typeof a === 'string')) {
    audOk = aud.includes(opts.clientId)
    if (audOk && aud.length > 1) {
      if (typeof payload.azp !== 'string' || payload.azp !== opts.clientId) {
        return { ok: false, error: 'bad-azp', payload }
      }
    }
  }
  if (!audOk) return { ok: false, error: 'bad-aud', payload }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return { ok: false, error: 'expired', payload }
  if (typeof payload.iat === 'number' && payload.iat * 1000 > now + 60_000) return { ok: false, error: 'future-iat', payload }
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) return { ok: false, error: 'not-yet-valid', payload }
  if (typeof opts.nonce === 'string') {
    if (payload.nonce !== opts.nonce) return { ok: false, error: 'bad-nonce', payload }
  }
  if (typeof payload.sub !== 'string' || !payload.sub) return { ok: false, error: 'missing-sub', payload }

  // alg 白名单：拒绝 none 与 HS*（对称算法会用公钥当前缀伪造，是经典混淆攻击）。
  // 必须在声明校验之前判定：签名与算法合法性不通过时不得泄露任何声明校验结果。
  const alg = header.alg
  if (typeof alg !== 'string' || alg === 'none' || alg.startsWith('HS') || !(jwtAlgToDigest(alg) || alg === 'EdDSA')) {
    return { ok: false, error: 'bad-alg', payload }
  }

  const jwk = findJwk(opts.jwks, header)
  if (!jwk) return { ok: false, error: 'no-signing-key', payload }
  if (!verifyJwtSignature(idToken, jwk)) return { ok: false, error: 'bad-signature', payload }

  return { ok: true, error: null, payload }
}

// 拉取并解析 OIDC Discovery 文档（{issuer}/.well-known/openid-configuration）。
// 仅接受 HTTPS issuer。返回 { ok, error, metadata }。
export async function fetchOidcDiscovery(issuer, opts) {
  try {
    if (typeof issuer !== 'string' || !issuer.trim()) return { ok: false, error: 'bad-issuer', metadata: null }
    const issuerUrl = new URL(issuer.trim())
    if (issuerUrl.protocol !== 'https:') return { ok: false, error: 'issuer-not-https', metadata: null }
    // RFC 8414 / OIDC Discovery：issuer 路径拼接 .well-known。
    const base = issuerUrl.href.replace(/\/$/, '')
    const url = base + '/.well-known/openid-configuration'
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-webui-oauth/0.4.0' },
      // 不跟随重定向：issuer 是部署者配置的信任锚，跟随跳转就把它交给远端决定
      // （可被用来把 discovery 引到任意主机）。需要跳转的部署应直接配置最终 issuer。
      redirect: 'error',
      signal: opts && opts.signal ? opts.signal : undefined,
    })
    if (!res.ok) return { ok: false, error: 'discovery-http-' + res.status, metadata: null }
    const text = await res.text()
    let meta
    try { meta = JSON.parse(text) } catch (e) { return { ok: false, error: 'discovery-bad-json', metadata: null } }
    if (!meta || typeof meta !== 'object') return { ok: false, error: 'discovery-bad-shape', metadata: null }
    if (typeof meta.issuer !== 'string' || meta.issuer.replace(/\/$/, '') !== issuerUrl.href.replace(/\/$/, '')) {
      return { ok: false, error: 'discovery-issuer-mismatch', metadata: null }
    }
    for (const ep of ['authorization_endpoint', 'token_endpoint']) {
      if (typeof meta[ep] !== 'string' || !/^https:\/\//.test(meta[ep])) {
        return { ok: false, error: 'discovery-insecure-' + ep, metadata: null }
      }
    }
    if (meta.jwks_uri !== undefined && (typeof meta.jwks_uri !== 'string' || !/^https:\/\//.test(meta.jwks_uri))) {
      return { ok: false, error: 'discovery-insecure-jwks_uri', metadata: null }
    }
    return { ok: true, error: null, metadata: meta }
  } catch (e) {
    return { ok: false, error: 'discovery-fetch-failed', metadata: null }
  }
}

// 拉取 JWKS 并缓存（内存 1h，失败则下次重试）。
function makeDiscoveryCache() {
  const cache = new Map() // issuer -> { ts, metadata, jwks }
  async function get(issuer) {
    const now = Date.now()
    const hit = cache.get(issuer)
    // 命中缓存时必须返回与未命中【完全相同的结构】({ok,error,metadata,jwks})——
    // 曾经这里直接 return 内部记录 {ts,meta,jwks}，调用方读 disc.ok/disc.metadata
    // 得到 undefined，于是缓存生效后的每一次登录都被误判为“Discovery 失败”。
    if (hit && now - hit.ts < 3600_000 && hit.metadata) {
      return { ok: true, error: null, metadata: hit.metadata, jwks: hit.jwks }
    }
    const r = await fetchOidcDiscovery(issuer)
    if (!r.ok) return { ...r, jwks: null }
    let jwks = null
    // jwks_uri 必须与 issuer 同源：否则一次 discovery 响应就能把密钥来源指向任意主机
    // （IdP 被攻破/配置错误时，这是把信任边界从 IdP 挪到第三方的捷径）。
    if (r.metadata.jwks_uri) {
      try {
        const jwksUrl = new URL(r.metadata.jwks_uri)
        if (jwksUrl.origin !== new URL(issuer).origin) {
          return { ok: false, error: 'jwks-cross-origin', metadata: r.metadata, jwks: null }
        }
        const jres = await fetch(r.metadata.jwks_uri, { headers: { accept: 'application/json' }, redirect: 'error' })
        if (jres.ok) {
          const jtxt = await jres.text()
          const parsed = JSON.parse(jtxt)
          if (parsed && Array.isArray(parsed.keys)) jwks = parsed
        }
      } catch (e) { /* keep jwks null → token validation will fail cleanly */ }
    }
    // jwks 为空（取不到/非法）时不写缓存：否则一次瞬时故障会被钉住一小时。
    if (jwks === null) {
      return { ok: false, error: 'jwks-unavailable', metadata: r.metadata, jwks: null }
    }
    cache.set(issuer, { ts: now, metadata: r.metadata, jwks })
    return { ok: true, error: null, metadata: r.metadata, jwks }
  }
  return { get }
}

/**
 * OIDC 授权请求的临时状态表（state → nonce / PKCE verifier / redirectUri）。
 *
 * TTL 语义（要点：**过期判定在读取时同步完成**，不能只依赖后台轮询）：
 *   - 写入时即算出 expiresAt = now + ttlMs；
 *   - take() 读到已过期条目按"不存在"处理并顺手删除——否则后台轮询（60s 一次）
 *     之间的空档里，过期 state 仍能兑换授权码，TTL 形同虚设；
 *   - 后台轮询仅作兜底回收（长时间无请求时清残留），不承担正确性；
 *   - 超过 maxPending 时淘汰**最早创建**的条目：`/oidc/login` 是公开端点，
 *     只按 TTL 淘汰的话，攻击者能在 TTL 窗口内灌入无上限条目把内存撑爆；
 *     正常并发量远低于该上限，故不会影响真实用户。
 * nonce / verifier 与 state 同生共死：它们只在这一次授权往返中有意义。
 *
 * 抽成独立工厂便于单测（可用注入的 now/ttl 精确验证过期边界）。
 */
function makeOidcStateStore(opts) {
  const ttlMs = (opts && opts.ttlMs) || OIDC_STATE_TTL_MS
  const maxPending = (opts && opts.maxPending) || OIDC_MAX_PENDING_STATES
  const now = (opts && opts.now) || Date.now
  const map = new Map() // 保持插入序：首个即最旧

  function purge() {
    const t = now()
    for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k)
  }

  function put(state, data) {
    const t = now()
    // 先回收过期项，再按容量淘汰最旧者。
    for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k)
    while (map.size >= maxPending) {
      const oldest = map.keys().next()
      if (oldest.done) break
      map.delete(oldest.value)
    }
    map.set(state, { ...data, createdAt: t, expiresAt: t + ttlMs })
    return true
  }

  /** 取出并消费；不存在或已过期均返回 null（过期项顺手清理）。 */
  function take(state) {
    if (typeof state !== 'string' || !state) return null
    const entry = map.get(state)
    if (!entry) return null
    map.delete(state) // 一次性：无论是否过期都不再可用
    if (entry.expiresAt <= now()) return null
    return entry
  }

  /**
   * 仅查询存在性（不消费、不判过期）。用于把"从未见过的 state"与"见过但已过期"
   * 在审计里区分开——注意它**不能**替代 take() 的过期判定。
   */
  function has(state) {
    return typeof state === 'string' && !!state && map.has(state)
  }

  return { put, take, has, purge, size: () => map.size }
}

export async function apply(ctx) {
  // 顶掉原版 dsh-webui-auth（若已加载）：必须在安装本插件闸门之前完成，
  // 否则会出现两套闸门并存的窗口。
  const displaced = displaceOriginalPlugins(ctx, (m) => {
    try { ctx.logger.warn('[dsh-webui-oauth] ' + m) } catch (e) { /* ignore */ }
  })
  if (displaced.length > 0) {
    ctx.logger.info('[dsh-webui-oauth] displaced original plugin(s): ' + displaced.join(', ')
      + ' — this plugin takes over the auth gate; credentials/data directory are shared.')
  }

  // H1: 每次启动生成随机 setup token，仅打印到宿主日志。
  const SETUP_TOKEN = randomBytes(16).toString('hex')

  let enabledFlag = false
  async function refreshEnabled() {
    const creds = await readCredentials(ctx)
    enabledFlag = isEnabled(creds)
  }
  await refreshEnabled()

  // H3: 持久化会话（启动重放 + 压缩）
  const sessions = new PersistentSessions()
  sessions.load()
  sessions.compact()

  // H4: 按 IP 限流 { ip -> [timestamps] }
  const failuresByIp = new Map()
  const RATE_WINDOW_MS = 60_000
  const RATE_MAX = 5

  function ipRateLimited(ip) {
    if (!ip) return false
    const now = Date.now()
    const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
    if (arr.length >= RATE_MAX) {
      failuresByIp.set(ip, arr)
      return true
    }
    return false
  }
  function recordFailure(ip) {
    if (!ip) return
    const now = Date.now()
    const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
    arr.push(now)
    failuresByIp.set(ip, arr)
    if (failuresByIp.size > 10000) {
      for (const [key, times] of failuresByIp) {
        const alive = times.filter((t) => now - t < RATE_WINDOW_MS)
        if (alive.length === 0) failuresByIp.delete(key)
      }
    }
  }

  function checkRequest(req) {
    if (!enabledFlag) return true
    const token = cookieOf(req, COOKIE_NAME)
    if (!token) return false
    const s = sessions.get(token)
    if (!s) return false
    if (s.expiresAt <= Date.now()) {
      sessions.delete(token)
      return false
    }
    if (s.browser === true) s.expiresAt = Date.now() + SESSION_TTL_MS
    return true
  }

  const SESSION_TTL_MS = SESSION_BROWSER_TTL_MS

  function createSession(username, ttl) {
    const token = randomBytes(24).toString('hex')
    const ttlMs = ttl > 0 ? ttl * 3600 * 1000 : SESSION_TTL_MS
    sessions.set(token, { username, expiresAt: Date.now() + ttlMs, browser: ttl <= 0 })
    return { token, maxAge: ttl > 0 ? ttl * 3600 : undefined }
  }

  function destroySession(req) {
    const token = cookieOf(req, COOKIE_NAME)
    if (token) sessions.delete(token)
  }

  function destroyAllSessionsExcept(keepToken) {
    sessions.deleteAllExcept(keepToken)
  }

  // H2: 安装运行时路由闸门
  const gate = installRouteGate(ctx, checkRequest, (m) => ctx.logger.info('[dsh-webui-oauth] ' + m))
  ctx.effect(() => gate.undo, 'dsh-webui-oauth: route gate')
  if (!gate.ok()) {
    ctx.logger.error('[dsh-webui-oauth] ROUTE GATE INCOMPLETE — ' + gate.problems().join('; ')
      + '. /api and/or WebSocket may be unprotected; the gate will still wrap them if they register later.')
  }

  ctx.logger.info('[dsh-webui-oauth] started, credentials file: ' + configPath())
  if (!enabledFlag) {
    // H1: token 同时落盘（0600，仅本机操作者可读），setup 成功后删除。
    // 解决 ctx.logger 输出在某些部署（systemd）下不可见的问题。
    try {
      ensureDataDir()
      writeFileSync(DATA_DIR + '/setup-token', SETUP_TOKEN + '\n', { mode: 0o600 })
    } catch (e) { /* 落盘失败时仍可从日志读取 */ }
    ctx.logger.info('[dsh-webui-oauth] setup token (first-run administrator creation): ' + SETUP_TOKEN)
  }

  // ---------------- OIDC SSO（可选） ----------------

  // 授权请求状态表（TTL + 容量上限），见 makeOidcStateStore 的说明。
  // 必须在后台定时器使用 purge 之前定义。
  const oidcStateStore = makeOidcStateStore()
  const purgeExpiredOidcStates = oidcStateStore.purge

  // 后台任务：过期会话清理 + enabled 状态刷新
  const bgTimer = setInterval(async () => {
    const now = Date.now()
    for (const [k, s] of sessions.live) if (s.expiresAt <= now) sessions.delete(k)
    purgeExpiredOidcStates()
    try {
      const creds = await readCredentials(ctx)
      enabledFlag = isEnabled(creds)
    } catch (e) { /* keep last state */ }
  }, 60000)
  ctx.effect(() => () => clearInterval(bgTimer), 'dsh-webui-oauth: background timer')
  const oidcDiscovery = makeDiscoveryCache()
  // OIDC 配置改由独立文件承载（dsh-webui-oauth.json），读取回落旧布局，
  // 因此这里变成异步。oidcOf/oidcEnabled 统一走这条路径，避免各处各自读。
  async function oidcOf(creds) {
    const r = await readOidcConfig(ctx, creds)
    return r.oidc
  }
  async function oidcEnabled(creds) {
    const o = await oidcOf(creds)
    return !!(o && o.enabled === true && typeof o.issuer === 'string' && typeof o.clientId === 'string' && typeof o.clientSecret === 'string')
  }

  // ---------------- 端点 ----------------

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/login',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const credsNow = await readCredentials(ctx)
          const oidcOn = await oidcEnabled(credsNow)
          const page = LOGIN_PAGE
            .replace('__MODE__', enabledFlag ? 'login' : 'setup')
            .replace('__OIDC_ENABLED__', oidcOn ? 'true' : 'false')
            .replace('__THEME_PREFERENCE__', themePreference(ctx))
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'x-robots-tag': 'noindex, nofollow',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          })
          res.end(page)
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req, res)
          if (body === null) return
          if (!enabledFlag) {
            sendJson(res, 200, { ok: false, error: 'not-configured' })
            return
          }
          const username = String(body.username || '').trim()
          const password = String(body.password || '')
          const creds = await readCredentials(ctx)
          if (!isEnabled(creds)) {
            sendJson(res, 200, { ok: false, error: 'not-configured' })
            return
          }
          const meta = requestMeta(req)
          if (ipRateLimited(meta.ip)) {
            await auditLog(ctx, 'login_rate_limited', { username: username || null, ip: meta.ip, ua: meta.ua })
            sendJson(res, 200, { ok: false, error: 'rate-limited' })
            return
          }
          let valid = false
          if (username === creds.username && typeof creds.hash === 'string') {
            valid = await verifyPassword(password, creds.hash)
          } else {
            valid = await dummyVerify(password)
          }
          if (!valid) {
            recordFailure(meta.ip)
            await auditLog(ctx, 'login_failure', { username: username || null, ip: meta.ip, ua: meta.ua })
            sendJson(res, 200, { ok: false, error: 'invalid' })
            return
          }
          const s = createSession(username, ttlOf(creds))
          res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge))
          await auditLog(ctx, 'login_success', { username, ip: meta.ip, ua: meta.ua })
          sendJson(res, 200, { ok: true, redirect: postLoginRedirect(ctx, req) })
          return
        }
        sendJson(res, 405, { error: '仅支持 GET/POST' })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: login page')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/setup',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag) {
          const meta = requestMeta(req)
          await auditLog(ctx, 'setup_failure', { username: null, ip: meta.ip, ua: meta.ua, detail: '已初始化，拒绝重复配置' })
          sendJson(res, 200, { ok: false, error: 'already-configured' })
          return
        }
        // H1: 首次配置必须携带本次启动的 setup token
        const body = await readJsonBody(req, res)
        if (body === null) return
        const suppliedToken = typeof body.token === 'string' ? body.token.trim() : ''
        const meta = requestMeta(req)
        if (!safeTokenEquals(suppliedToken, SETUP_TOKEN)) {
          await auditLog(ctx, 'setup_failure', { username: null, ip: meta.ip, ua: meta.ua, detail: 'setup token 缺失或不匹配' })
          sendJson(res, 200, { ok: false, error: 'setup-token-required' })
          return
        }
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const nameErr = usernameError(username)
        if (nameErr) {
          await auditLog(ctx, 'setup_failure', { username: username || null, ip: meta.ip, ua: meta.ua, detail: '用户名格式不合法' })
          sendJson(res, 200, { ok: false, error: 'username-invalid' })
          return
        }
        const st = passwordStrength(password)
        if (!st.ok) {
          await auditLog(ctx, 'setup_failure', { username, ip: meta.ip, ua: meta.ua, detail: '密码强度不足' })
          sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
          return
        }
        // H2 fail-closed：路由闸门不完整时拒绝启用认证（防止"开了登录却裸奔 /api"）
        if (!gate.ok()) {
          await auditLog(ctx, 'setup_failure', { username, ip: meta.ip, ua: meta.ua, detail: '路由闸门不完整，拒绝启用' })
          sendJson(res, 200, { ok: false, error: 'gate-incomplete', problem: gate.problems()[0] || '' })
          return
        }
        await writeCredentials(ctx, { v: 3, username, hash: await hashPassword(password), ttl: TTL_DEFAULT })
        try { unlinkSync(DATA_DIR + '/setup-token') } catch (e) { /* already gone */ }
        enabledFlag = true
        const s = createSession(username, TTL_DEFAULT)
        res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge))
        await auditLog(ctx, 'setup_success', { username, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true, redirect: postLoginRedirect(ctx, req) })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: setup')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/logout',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        const token = cookieOf(req, COOKIE_NAME)
        const s = token ? sessions.get(token) : null
        destroySession(req)
        res.setHeader('Set-Cookie', clearSessionCookie())
        const meta = requestMeta(req)
        await auditLog(ctx, 'logout', { username: s ? s.username : null, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: logout')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/status',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const creds = await readCredentials(ctx)
        const enabled = isEnabled(creds)
        const oidcCfg = await oidcOf(creds)
        const oidcOn = !!(oidcCfg && oidcCfg.enabled === true && typeof oidcCfg.issuer === 'string' && typeof oidcCfg.clientId === 'string' && typeof oidcCfg.clientSecret === 'string')
        sendJson(res, 200, {
          enabled,
          username: enabled ? creds.username : null,
          ttl: ttlOf(creds),
          sessionsPersisted: sessions.ok,
          gate: { ok: gate.ok(), problems: gate.problems().slice(0, 3) },
          trustedOrigin: (() => {
            try {
              const pol = trustedOriginPolicy(ctx, oidcCfg)
              return { trustBrowserOrigin: pol.trust, configuredOrigin: configuredOrigin(ctx) }
            } catch (e) { return null }
          })(),
          oidc: oidcOn ? { enabled: true, issuer: oidcCfg.issuer, clientId: oidcCfg.clientId, scope: oidcCfg.scope, redirectBase: oidcCfg.redirectBase, trustBrowserOrigin: oidcCfg.trustBrowserOrigin !== false } : { enabled: false },
        })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/audit',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        let limit = 10
        if (typeof req.url === 'string') {
          const m = /[?&]limit=(\d+)/.exec(req.url)
          if (m) limit = Math.min(Math.max(Number(m[1]), 1), 100)
        }
        const entries = await readAuditEntries(ctx, limit)
        sendJson(res, 200, { ok: true, entries })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: audit')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/configure',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const body = await readJsonBody(req, res)
        if (body === null) return
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const current = String(body.current || '')
        const creds = await readCredentials(ctx)
        const meta = requestMeta(req)
        const nameErr = usernameError(username)
        if (nameErr) {
          await auditLog(ctx, 'configure_failure', { username: username || null, ip: meta.ip, ua: meta.ua, detail: '用户名格式不合法' })
          sendJson(res, 200, { ok: false, error: 'username-invalid' })
          return
        }
        const wasEnabled = isEnabled(creds)
        const hashIsScrypt = creds !== null && typeof creds.hash === 'string' && creds.hash.startsWith(SCRYPT_PREFIX)
        const keepPassword = wasEnabled && !password && hashIsScrypt
        if (wasEnabled && !password && !hashIsScrypt) {
          await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: '旧版哈希不支持保留，必须设置新密码' })
          sendJson(res, 200, { ok: false, error: 'legacy-hash' })
          return
        }
        if (!keepPassword) {
          const st = passwordStrength(password)
          if (!st.ok) {
            await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: '密码强度不足' })
            sendJson(res, 200, { ok: false, error: 'weak-password', reason: st.reason })
            return
          }
        }
        if (wasEnabled) {
          const curValid = current && typeof creds.hash === 'string' && await verifyPassword(current, creds.hash)
          if (!curValid) {
            await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: '当前密码不正确' })
            sendJson(res, 200, { ok: false, error: 'current-invalid' })
            return
          }
        }
        // H2 fail-closed：闸门不完整时拒绝启用
        if (!wasEnabled && !gate.ok()) {
          await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: '路由闸门不完整，拒绝启用' })
          sendJson(res, 200, { ok: false, error: 'gate-incomplete', problem: gate.problems()[0] || '' })
          return
        }
        let ttl = wasEnabled ? ttlOf(creds) : TTL_DEFAULT
        if (body.ttl !== undefined) {
          ttl = Number(body.ttl)
          if (!Number.isInteger(ttl) || !TTL_OPTIONS.includes(ttl)) {
            sendJson(res, 200, { ok: false, error: 'ttl-invalid' })
            return
          }
        }
        // OIDC 配置（可选）
        const oidcIn = body.oidc && typeof body.oidc === 'object' ? body.oidc : null
        if (oidcIn && typeof oidcIn.enabled === 'boolean' && typeof oidcIn.issuer === 'string' && typeof oidcIn.clientId === 'string') {
          if (oidcIn.trustBrowserOrigin !== undefined && typeof oidcIn.trustBrowserOrigin !== 'boolean') {
            await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: 'OIDC 配置：trustBrowserOrigin 须为 boolean' })
            sendJson(res, 200, { ok: false, error: 'oidc-invalid', reason: 'trustBrowserOrigin 须为 boolean' })
            return
          }
          if (oidcIn.clientSecret !== undefined && (typeof oidcIn.clientSecret !== 'string' || !oidcIn.clientSecret.trim())) {
            await auditLog(ctx, 'configure_failure', { username, ip: meta.ip, ua: meta.ua, detail: 'OIDC 配置：clientSecret 须为非空字符串（或留空保留旧值）' })
            sendJson(res, 200, { ok: false, error: 'oidc-invalid', reason: 'clientSecret 须为非空字符串' })
            return
          }
        }
        // 合并 OIDC 配置：oidcIn 提供时整段替换（secret 留空则保留旧值）；否则关闭。
        let oidcOut = null
        if (oidcIn && typeof oidcIn.enabled === 'boolean' && typeof oidcIn.issuer === 'string' && typeof oidcIn.clientId === 'string') {
          // 旧值可能来自旧布局（凭据文件内的 oidc 段），readOidcConfig 已做回落。
          const prevCfg = (await readOidcConfig(ctx, creds)).oidc
          const prevSecret = (prevCfg && typeof prevCfg.clientSecret === 'string') ? prevCfg.clientSecret : ''
          oidcOut = {
            enabled: oidcIn.enabled,
            issuer: oidcIn.issuer,
            clientId: oidcIn.clientId,
            clientSecret: (typeof oidcIn.clientSecret === 'string' && oidcIn.clientSecret) ? oidcIn.clientSecret : prevSecret,
            scope: typeof oidcIn.scope === 'string' ? oidcIn.scope : undefined,
            redirectBase: typeof oidcIn.redirectBase === 'string' && oidcIn.redirectBase.trim() ? oidcIn.redirectBase.trim() : undefined,
            trustBrowserOrigin: oidcIn.trustBrowserOrigin !== undefined ? oidcIn.trustBrowserOrigin : true,
          }
        } else if (oidcIn && oidcIn.enabled === false) {
          oidcOut = { enabled: false }
        }
        let credsOut
        if (keepPassword && typeof creds.hash === 'string') {
          credsOut = { v: 3, username, hash: creds.hash, ttl }
        } else {
          credsOut = { v: 3, username, hash: await hashPassword(password), ttl }
        }
        // 凭据文件只保留账号字段（OIDC 走独立文件）；写入时自然剥掉历史遗留的 oidc 段，
        // 完成旧布局 → 新布局迁移，不让旧 secret 继续躺在凭据文件里。
        await writeCredentials(ctx, credsOut)
        // OIDC 仅当本次请求涉及它时才写，避免"只改密码"把 OIDC 配置意外清掉。
        if (oidcOut) await writeOidcConfig(ctx, oidcOut)
        enabledFlag = true
        if (wasEnabled) {
          const keepToken = cookieOf(req, COOKIE_NAME)
          destroyAllSessionsExcept(keepToken)
        } else {
          const s = createSession(username, ttl)
          res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge))
        }
        const detailParts = []
        if (!keepPassword) detailParts.push('密码已修改')
        if (body.ttl !== undefined) detailParts.push('有效期已修改')
        await auditLog(ctx, 'configure_success', { username, ip: meta.ip, ua: meta.ua, detail: detailParts.length ? detailParts.join('，') : null })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: configure')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/disable',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const body = await readJsonBody(req, res)
        if (body === null) return
        const current = String(body.current || '')
        const creds = await readCredentials(ctx)
        const meta = requestMeta(req)
        if (!isEnabled(creds)) {
          sendJson(res, 200, { ok: true })
          return
        }
        const curValid = current && typeof creds.hash === 'string' && await verifyPassword(current, creds.hash)
        if (!curValid) {
          await auditLog(ctx, 'disable_failure', { username: creds.username, ip: meta.ip, ua: meta.ua, detail: '当前密码不正确' })
          sendJson(res, 200, { ok: false, error: 'current-invalid' })
          return
        }
        await writeCredentials(ctx, { v: 1, enabled: false })
        sessions.clear()
        res.setHeader('Set-Cookie', clearSessionCookie())
        enabledFlag = false
        await auditLog(ctx, 'disable_success', { username: creds.username, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: disable')

  // ---------------- OIDC SSO 端点 ----------------

  // 发起 OIDC 授权：GET /dsh-webui-oauth/oidc/login?base=<前端origin>
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/oidc/login',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        const creds = await readCredentials(ctx)
        const o = await oidcOf(creds)
        if (!(await oidcEnabled(creds))) {
          sendJson(res, 200, { ok: false, error: 'oidc-not-configured' })
          return
        }
        // 决定回调 base：与登录后 token 跳转共用 remote-web-ui 段的统一开关。
        let frontendBase = null
        if (typeof req.url === 'string') {
          const m = /[?&]base=([^&]+)/.exec(req.url)
          if (m) { try { frontendBase = decodeURIComponent(m[1]) } catch (e) { frontendBase = null } }
        }
        const base = resolveOidcBase(o, frontendBase, trustedOriginPolicy(ctx, o))
        if (!base) {
          sendJson(res, 200, { ok: false, error: 'oidc-base-unresolvable', hint: '请在设置中配置 redirectBase（反代场景），或让浏览器从登录页发起 SSO 登录' })
          return
        }
        const redirectUri = base.replace(/\/$/, '') + OIDC_CALLBACK_PATH
        // 拉取 Discovery（缓存）；失败则引导检查 issuer 配置。
        const disc = await oidcDiscovery.get(o.issuer)
        if (!disc.ok || !disc.metadata) {
          const meta = requestMeta(req)
          await auditLog(ctx, 'oidc_discovery_failure', { issuer: o.issuer, ip: meta.ip, ua: meta.ua, detail: disc.error })
          sendJson(res, 200, { ok: false, error: 'oidc-discovery-failed', detail: disc.error })
          return
        }
        // 生成 state / nonce / PKCE verifier，按 TTL 暂存（含容量上限，防灌爆）。
        const state = oidcRandom(24)
        const nonce = oidcRandom(24)
        const verifier = oidcRandom(32)
        oidcStateStore.put(state, { nonce, verifier, redirectUri })
        const authUrl = new URL(disc.metadata.authorization_endpoint)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('client_id', o.clientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('scope', typeof o.scope === 'string' && o.scope.trim() ? o.scope.trim() : 'openid profile email')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('nonce', nonce)
        authUrl.searchParams.set('code_challenge', oidcChallenge(verifier))
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('prompt', 'select_account')
        // 登录 CSRF 绑定：把 state 同时写进一个 HttpOnly 短时效 Cookie。回调时两者必须
        // 同时匹配——否则攻击者可先在自己的浏览器发起授权拿到 state，再诱导受害者带着
        // 该 state 完成回调，把受害者的浏览器登录进攻击者的账号（会话固定/登录 CSRF）。
        res.setHeader('Set-Cookie', COOKIE_OIDC_STATE + '=' + state + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(OIDC_STATE_TTL_MS / 1000))
        res.writeHead(302, { location: authUrl.href })
        res.end()
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: oidc login')

  // OIDC 回调：GET /dsh-webui-oauth/oidc/callback?code&state
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/oidc/callback',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '仅支持 GET' })
          return
        }
        const params = new URL(req.url || '/', 'http://dsh.invalid').searchParams
        const code = params.get('code')
        const state = params.get('state')
        const meta = requestMeta(req)
        const creds = await readCredentials(ctx)
        const o = await oidcOf(creds)
        if (!(await oidcEnabled(creds))) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'OIDC 未配置' })
          sendJson(res, 200, { ok: false, error: 'oidc-not-configured' })
          return
        }
        // state 校验（防 CSRF/重放）：读取时同步判定 TTL 并消费。
        // 区分"未知/已用"与"已过期"，便于审计与用户排查；两者都拒绝。
        const known = oidcStateStore.has(state)
        const st = oidcStateStore.take(state)
        // 无论成功与否都清掉绑定 Cookie：它只服务于这一次授权往返。
        const clearStateCookie = { 'Set-Cookie': COOKIE_OIDC_STATE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }
        if (!st) {
          const why = known ? 'state 已过期（TTL ' + Math.round(OIDC_STATE_TTL_MS / 60000) + ' 分钟）' : 'state 无效、已使用或不存在'
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: why })
          sendJson(res, 200, { ok: false, error: 'oidc-invalid-state' }, clearStateCookie)
          return
        }
        // 登录 CSRF 绑定：回调必须由发起授权的同一浏览器完成（携带同值 Cookie）。
        // 只校验 state 存在于服务端集合不足以阻止“攻击者取 state、受害者完成回调”。
        if (cookieOf(req, COOKIE_OIDC_STATE) !== state) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'state Cookie 不匹配（疑似登录 CSRF）' })
          sendJson(res, 200, { ok: false, error: 'oidc-invalid-state' }, clearStateCookie)
          return
        }
        if (!code) {
          const err = params.get('error') || 'missing-code'
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: '授权被拒或缺少 code: ' + sanitizeSub(err) })
          sendJson(res, 200, { ok: false, error: 'oidc-authorize-failed', detail: err })
          return
        }
        // 换 token（authorization_code + PKCE verifier + client_secret）
        const disc = await oidcDiscovery.get(o.issuer)
        if (!disc.ok || !disc.metadata) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'Discovery 失败 ' + disc.error })
          sendJson(res, 200, { ok: false, error: 'oidc-discovery-failed' })
          return
        }
        const tokParams = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: st.redirectUri,
          client_id: o.clientId,
          client_secret: o.clientSecret,
          code_verifier: st.verifier,
        })
        let tokenRes
        try {
          tokenRes = await fetch(disc.metadata.token_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: tokParams,
            redirect: 'error',
          })
        } catch (e) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'token 端点连接失败' })
          sendJson(res, 200, { ok: false, error: 'oidc-token-failed' })
          return
        }
        const tokenText = await tokenRes.text()
        let tokenBody = null
        try { tokenBody = JSON.parse(tokenText) } catch (e) { /* ignore */ }
        const idToken = tokenBody && typeof tokenBody.id_token === 'string' ? tokenBody.id_token : null
        if (!idToken) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'token 响应缺少 id_token' })
          sendJson(res, 200, { ok: false, error: 'oidc-no-id-token' })
          return
        }
        // 验证 id_token
        const vres = validateIdToken(idToken, { issuer: o.issuer, clientId: o.clientId, nonce: st.nonce, jwks: disc.jwks })
        if (!vres.ok) {
          await auditLog(ctx, 'oidc_login_failure', { ip: meta.ip, ua: meta.ua, detail: 'id_token 验证失败: ' + vres.error })
          sendJson(res, 200, { ok: false, error: 'oidc-invalid-id-token', detail: vres.error })
          return
        }
        // 建本地会话。身份用**原始 sub**（sanitize 是有损的：'a/b' 与 'a_b' 会塌成同一个
        // 本地用户名，拿它当身份会张冠李戴）；审计里才用 sanitizeSub 过滤后的短标识。
        const rawSub = vres.payload.sub
        const auditName = sanitizeSub(rawSub)
        const s = createSession(rawSub, ttlOf(creds))
        await auditLog(ctx, 'oidc_login_success', { username: auditName, ip: meta.ip, ua: meta.ua })
        // 授权往返结束：同时下发会话 Cookie 并清除一次性的 state 绑定 Cookie。
        // Set-Cookie 必须走数组（sendJson 已支持多值），否则后者会覆盖前者、
        // 导致"登录成功却没有会话"。
        sendJson(res, 200, { ok: true, redirect: postLoginRedirect(ctx, req) }, {
          'Set-Cookie': [sessionCookie(s.token, s.maxAge), clearStateCookie['Set-Cookie']],
        })
      } catch (e) {
        // 这里可能带上用户可控内容（如 code 解码、payload 结构异常），
        // 若原样回显会变成反射型注入的落点，因此固定文案、细节只进服务端日志。
        ctx.logger?.warn?.('[dsh-webui-oauth] oidc callback 处理失败:', e)
        sendJson(res, 500, { error: 'oidc-callback-failed' })
      }
    },
  }), 'dsh-webui-oauth: oidc callback')

  // 简单版 OIDC 登出：POST /dsh-webui-oauth/oidc/logout
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webui-oauth/oidc/logout',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST' })
          return
        }
        if (enabledFlag && !checkRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const token = cookieOf(req, COOKIE_NAME)
        const s = token ? sessions.get(token) : null
        destroySession(req)
        res.setHeader('Set-Cookie', clearSessionCookie())
        const meta = requestMeta(req)
        await auditLog(ctx, 'oidc_logout', { username: s ? s.username : null, ip: meta.ip, ua: meta.ua })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
      }
    },
  }), 'dsh-webui-oauth: oidc logout')

  // ---------------- 传输层拦截 ----------------

  // 兜底拦截：所有未被 exact / 更长前缀认领的请求（index.html、/assets/*、SPA 路由等）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '',
    handler: async (req, res) => {
      try {
        if (checkRequest(req)) {
          // alpha.2+：插件会话通过后，核心 BrowserAuth 可能仍未认领该浏览器
          // （核心 cookie 缺失/过期）。主动引导去带 launch token 的根 URL 完成
          // 核心 token→cookie 交换，否则 fallback 的 authorizeIndex 会 401 死锁。
          // 请求已带 token（核心正在交换中/前端保留 query）时不再跳转。
          const connection = ctx.get('connection')
          if (connection && typeof connection.requestRejection === 'function') {
            let hasToken = false
            try { hasToken = new URL(req.url || '/', 'http://x').searchParams.has('token') } catch (e) { /* ignore */ }
            if (!hasToken && connection.requestRejection(req) === 401) {
              res.writeHead(302, { location: postLoginRedirect(ctx, req) })
              res.end()
              return
            }
          }
          const fallback = ctx.webServer.fallback
          if (fallback !== undefined) {
            await fallback(req, res)
            return
          }
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(302, { location: '/dsh-webui-oauth/login' })
        res.end()
      } catch (e) {
        ctx.logger.warn('[dsh-webui-oauth] intercept error: ' + (e && e.message ? e.message : String(e)))
        if (!res.headersSent) {
          res.writeHead(500)
          res.end()
        } else {
          res.destroy()
        }
      }
    },
  }), 'dsh-webui-oauth: transport gate')
}

// ---------------- CLI：node index.js audit [--limit N] ----------------

let metaFilePath = null
try {
  let u = import.meta.url
  const q = u.indexOf('?')
  if (q !== -1) u = u.slice(0, q)
  const h = u.indexOf('#')
  if (h !== -1) u = u.slice(0, h)
  metaFilePath = fileURLToPath(u)
} catch (e) { /* not a file URL */ }

const isCliEntry = metaFilePath !== null && (() => {
  try {
    const entry = process.argv[1]
    if (!entry) return false
    const self = process.platform === 'win32' ? metaFilePath.toLowerCase() : metaFilePath
    const resolved = resolvePath(entry)
    return (process.platform === 'win32' ? resolved.toLowerCase() : resolved) === self
  } catch (e) {
    return false
  }
})()

if (isCliEntry) {
  const cmd = process.argv[2]
  if (cmd === 'audit') {
    const li = process.argv.indexOf('--limit')
    let limit = 20
    if (li >= 0 && process.argv[li + 1] !== undefined) {
      const n = Number(process.argv[li + 1])
      if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), 200)
    }
    const file = auditFileForCli()
    const rows = []
    if (file) {
      try {
        const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
        for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
          try { rows.push(JSON.parse(lines[i])) } catch (e) { /* skip malformed */ }
        }
      } catch (e) { /* 文件尚不存在 */ }
    }
    console.log('[dsh-webui-oauth] 审计日志：最近 ' + rows.length + ' 条' + (file ? '（文件: ' + file + '）' : ''))
    if (rows.length === 0) {
      console.log('（暂无审计记录；登录/配置等安全事件会追加写入插件目录的 audit.jsonl）')
    }
    for (const r of rows) {
      const parts = [r.ts || '?', r.event || '?']
      if (r.username) parts.push('user=' + r.username)
      if (r.ip) parts.push('ip=' + r.ip)
      if (r.detail) parts.push('detail=' + String(r.detail))
      console.log('  ' + parts.join('  '))
    }
  } else {
    console.log('[dsh-webui-oauth] 用法: node index.js audit [--limit N]')
  }
  process.exit(0)
}
