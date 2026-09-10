/**
 * 登录后跳转目标（scheme/authority）回归测试 —— 覆盖 issue #6 / #7。
 *
 * 运行：node test/redirect-scheme.test.mjs   （或 npm test）
 * 零依赖，直接 import 插件模块并调用导出的纯函数。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveRedirectScheme, postLoginRedirect } from '../index.js'

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

// 伪造 ctx：settings/section、webServer.port、connection.authenticatedUrl
function mkCtx(settings, port) {
  return {
    get(ns) {
      if (ns === 'settings') {
        return settings === undefined ? undefined : { get: (k) => settings[k] }
      }
      if (ns === 'webServer') return { port: port || 3080 }
      if (ns === 'connection') {
        return { authenticatedUrl: (base) => base + '/?token=abc' }
      }
      return undefined
    },
  }
}
const req = (headers, encrypted) => ({
  headers,
  socket: { encrypted: !!encrypted, remoteAddress: '127.0.0.1' },
})
const PUBLIC = { 'remote-web-ui': { publicBaseUrl: 'https://www.example.com:8443' } }

console.log('— resolveRedirectScheme：优先级 —')
eq('无任何信号（回环直连）', resolveRedirectScheme(mkCtx({}), req({ host: '127.0.0.1:3080' }), '127.0.0.1:3080'), 'http')
eq('XFP=https（#7 拓扑）', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example:8443', 'x-forwarded-proto': 'https' }), 'dsh.example:8443'), 'https')
eq('XFP 多级代理取最左', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', 'x-forwarded-proto': 'https, http' }), 'dsh.example'), 'https')
eq('XFP 大小写/空格容错', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', 'x-forwarded-proto': ' HTTPS ' }), 'dsh.example'), 'https')
eq('Forwarded proto=https', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', forwarded: 'for=1.2.3.4;proto=https;host=dsh.example' }), 'dsh.example'), 'https')
eq('Forwarded proto 居首', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', forwarded: 'proto=https' }), 'dsh.example'), 'https')
eq('Forwarded 无 proto 回落 http', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', forwarded: 'for=1.2.3.4' }), 'dsh.example'), 'http')
eq('socket.encrypted（插件直接终结 TLS）', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example:3080' }, true), 'dsh.example:3080'), 'https')
eq('publicBaseUrl authority 匹配', resolveRedirectScheme(mkCtx(PUBLIC), req({ host: 'www.example.com:8443' }), 'www.example.com:8443'), 'https')
eq('publicBaseUrl 优先于矛盾的 XFP', resolveRedirectScheme(mkCtx(PUBLIC), req({ host: 'www.example.com:8443', 'x-forwarded-proto': 'http' }), 'www.example.com:8443'), 'https')

console.log('\n— resolveRedirectScheme：默认端口规范化 —')
const sDefault = mkCtx({ 'remote-web-ui': { publicBaseUrl: 'https://a.com' } })
eq('https://a.com + Host a.com:443', resolveRedirectScheme(sDefault, req({ host: 'a.com:443' }), 'a.com:443'), 'https')
eq('https://a.com + Host a.com', resolveRedirectScheme(sDefault, req({ host: 'a.com' }), 'a.com'), 'https')
eq('https://a.com + Host a.com:8443（端口不符不采信）', resolveRedirectScheme(sDefault, req({ host: 'a.com:8443' }), 'a.com:8443'), 'http')

console.log('\n— resolveRedirectScheme：必须忽略的非法输入 —')
eq('XFP 任意 scheme 注入', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', 'x-forwarded-proto': 'javascript:alert(1)' }), 'dsh.example'), 'http')
eq('XFP CRLF 头注入', resolveRedirectScheme(mkCtx({}), req({ host: 'dsh.example', 'x-forwarded-proto': 'https\r\nx-evil: 1' }), 'dsh.example'), 'http')
eq('publicBaseUrl 非 http(s)', resolveRedirectScheme(mkCtx({ 'remote-web-ui': { publicBaseUrl: 'ftp://a.com' } }), req({ host: 'a.com' }), 'a.com'), 'http')
eq('publicBaseUrl 垃圾值', resolveRedirectScheme(mkCtx({ 'remote-web-ui': { publicBaseUrl: 'not a url' } }), req({ host: 'a.com' }), 'a.com'), 'http')
eq('settings 服务缺失', resolveRedirectScheme(mkCtx(undefined), req({ host: 'a.com' }), 'a.com'), 'http')
eq('内网域名不得被猜测成 https', resolveRedirectScheme(mkCtx({}), req({ host: 'nas.local:3080' }), 'nas.local:3080'), 'http')

console.log('\n— 开放重定向防护：publicBaseUrl 只对匹配的 Host 生效 —')
eq('局域网直连不被改写到公网', resolveRedirectScheme(mkCtx(PUBLIC), req({ host: '192.168.3.5:3080' }), '192.168.3.5:3080'), 'http')
eq('其他域名 + XFP 仍按 XFP', resolveRedirectScheme(mkCtx(PUBLIC), req({ host: 'lan.internal:8443', 'x-forwarded-proto': 'https' }), 'lan.internal:8443'), 'https')
eq('其他域名 + 无信号 → http（不跳公网）', resolveRedirectScheme(mkCtx(PUBLIC), req({ host: 'evil.example' }), 'evil.example'), 'http')

console.log('\n— postLoginRedirect —')
eq('#7 复现：XFP=https → https 跳转', postLoginRedirect(mkCtx({}), req({ host: 'www.kongjianzhan.top:8443', 'x-forwarded-proto': 'https' })), 'https://www.kongjianzhan.top:8443/?token=abc')
eq('#7 复现：publicBaseUrl → https 跳转', postLoginRedirect(mkCtx({ 'remote-web-ui': { publicBaseUrl: 'https://www.kongjianzhan.top:8443' } }), req({ host: 'www.kongjianzhan.top:8443' })), 'https://www.kongjianzhan.top:8443/?token=abc')
eq('#6：authority 取自请求 Host（非写死 127.0.0.1）', postLoginRedirect(mkCtx({}), req({ host: 'dsh.homelab.lan:8443' })), 'http://dsh.homelab.lan:8443/?token=abc')
eq('无 Host 头 → 回环 http 兜底', postLoginRedirect(mkCtx({}), req({})), 'http://127.0.0.1:3080/?token=abc')
eq('无 Host 头 + XFP=https → 回环仍 http', postLoginRedirect(mkCtx({}), req({ 'x-forwarded-proto': 'https' })), 'http://127.0.0.1:3080/?token=abc')
eq('host 非字符串 → 回环兜底', postLoginRedirect(mkCtx({}), { headers: { host: 123 }, socket: {} }), 'http://127.0.0.1:3080/?token=abc')
eq('connection 服务缺失 → "/"', postLoginRedirect({ get: () => undefined }, req({ host: 'a.com' })), '/')

console.log('\n— 前端登录页兜底（https 页面收到同源 http:// 跳转）—')
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'index.js'), 'utf8')
const start = src.indexOf('const LOGIN_PAGE = `')
const rawLiteral = src.slice(start + 'const LOGIN_PAGE = `'.length, src.indexOf('`', src.indexOf('</html>', start)))
// 用 JS 自身求值模板字面量，等价于模块加载时的产物（含转义还原）
const page = new Function('return `' + rawLiteral + '`')() // eslint-disable-line no-new-func
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
eq('登录页内联 script 数量', String(scripts.length), '2')
scripts.forEach((body, i) => {
  let err = ''
  try { new Function(body) } catch (e) { err = e.message }
  eq('登录页 script#' + (i + 1) + ' 语法', err === '' ? 'OK' : err, 'OK')
})
const goToSrc = /function goTo\(target\) \{[\s\S]*?\n\}/.exec(page)[0]
function runGoTo(target, protocol, host) {
  const navigated = []
  const location = {
    protocol,
    host,
    get href() { return navigated[navigated.length - 1] },
    set href(v) { navigated.push(v) },
  }
  new Function('location', 'URL', goToSrc + '\nreturn goTo(arguments[2]);')(location, URL, target) // eslint-disable-line no-new-func
  return navigated[navigated.length - 1]
}
eq('https 页 + 同源 http:// → 升级 https', runGoTo('http://dsh.example:8443/?token=abc', 'https:', 'dsh.example:8443'), 'https://dsh.example:8443/?token=abc')
eq('https 页 + 同源 https:// → 不动', runGoTo('https://dsh.example:8443/?token=abc', 'https:', 'dsh.example:8443'), 'https://dsh.example:8443/?token=abc')
eq('http 页 + http:// → 不动（不降级）', runGoTo('http://192.168.3.5:3080/?token=abc', 'http:', '192.168.3.5:3080'), 'http://192.168.3.5:3080/?token=abc')
eq('https 页 + 异源 http:// → 不动', runGoTo('http://evil.example/?token=abc', 'https:', 'dsh.example:8443'), 'http://evil.example/?token=abc')
eq('redirect 缺失 → "/"', runGoTo(undefined, 'https:', 'dsh.example'), '/')
eq('redirect 非字符串 → "/"', runGoTo({ evil: 1 }, 'https:', 'dsh.example'), '/')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
