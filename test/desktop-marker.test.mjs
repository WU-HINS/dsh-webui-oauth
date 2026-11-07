/**
 * DSH Desktop 标记透传（upstream 0.3.5 / #8）的纯函数回归。
 *
 * 该适配层只做两件事：
 *   remember() —— 文档 URL 带 dsh-desktop-* 时把标记写进 HttpOnly Cookie；
 *   restore()  —— 之后落到干净 "/" 时 302 回带标记的 URL。
 *
 * 它**不参与认证判定**：调用点在 checkRequest 之后（见 index.js 网关 handler）。
 * 门禁不受影响的端到端断言在 oidc-bind.test.mjs 的 1f 节。
 *
 * 运行：node test/desktop-marker.test.mjs
 */
import {
  remember, restore, desktopMarkersOf, desktopStashCookie, desktopStashQuery,
  collectDesktopMarkers, DESKTOP_STASH_COOKIE,
} from '../lib/desktop-adapter.js'

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

const req = (url, headers = {}, method = 'GET') => ({ method, url, headers })
const res = () => ({
  status: null, headers: {}, body: null,
  setHeader(k, v) { this.headers[k] = v },
  writeHead(s, h) { this.status = s; if (h) for (const k of Object.keys(h)) this.headers[k] = h[k] },
  end(b) { this.body = b === undefined ? '' : String(b) },
})
const DESKTOP_URL = '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'

console.log('— 1. 标记提取 —')
{
  const m = desktopMarkersOf(DESKTOP_URL)
  eq('识别 mode + platform', JSON.stringify(m), JSON.stringify([
    ['dsh-desktop-mode', 'advanced'], ['dsh-desktop-platform', 'win32'],
  ]))
  eq('缺 mode → 整体放弃', desktopMarkersOf('/?dsh-desktop-platform=win32'), null)
  eq('非法 mode → 整体放弃', desktopMarkersOf('/?dsh-desktop-mode=weird'), null)
  eq('非 dsh-desktop 前缀不采信', desktopMarkersOf('/?foo=bar'), null)
  eq('空值被跳过', JSON.stringify(collectDesktopMarkers(new URLSearchParams('dsh-desktop-mode=advanced&dsh-desktop-platform='))),
    JSON.stringify([['dsh-desktop-mode', 'advanced']]))
  eq('超长值被跳过', JSON.stringify(collectDesktopMarkers(new URLSearchParams('dsh-desktop-mode=advanced&dsh-desktop-x=' + 'a'.repeat(65)))),
    JSON.stringify([['dsh-desktop-mode', 'advanced']]))
}

console.log('\n— 2. 暂存与还原 —')
{
  const markers = desktopMarkersOf(DESKTOP_URL)
  const cookie = desktopStashCookie(markers)
  eq('暂存 Cookie 为 HttpOnly/SameSite/12h', /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && /Max-Age=43200/.test(cookie), true)
  const pair = cookie.split(';')[0]
  eq('暂存 Cookie 名正确', pair.startsWith(DESKTOP_STASH_COOKIE + '='), true)
  const restored = desktopStashQuery(req('/', { cookie: pair }))
  eq('还原出的 query 可再次被识别', restored, 'dsh-desktop-mode=advanced&dsh-desktop-platform=win32')
  eq('损坏的 Cookie 返回 null', desktopStashQuery(req('/', { cookie: DESKTOP_STASH_COOKIE + '=%E0%A4%A' })), null)
  eq('非法标记的 Cookie 返回 null', desktopStashQuery(req('/', { cookie: DESKTOP_STASH_COOKIE + '=' + encodeURIComponent('dsh-desktop-mode=weird') })), null)
}

console.log('\n— 3. remember：只在文档根写暂存 —')
{
  const r1 = res()
  eq('GET / 带标记 → 记住', remember(req(DESKTOP_URL), r1), true)
  eq('写入 Set-Cookie', String(r1.headers['Set-Cookie'] || '').startsWith(DESKTOP_STASH_COOKIE + '='), true)

  const r2 = res()
  eq('GET / 无标记 → 不写', remember(req('/'), r2), false)
  eq('无 Set-Cookie', r2.headers['Set-Cookie'], undefined)

  const r3 = res()
  eq('资源路径 → 不写', remember(req('/assets/index.js?dsh-desktop-mode=advanced'), r3), false)

  const r4 = res()
  eq('POST → 不写', remember(req(DESKTOP_URL, {}, 'POST'), r4), false)
}

console.log('\n— 4. restore：只在干净 "/" 补投 —')
{
  const stash = desktopStashCookie(desktopMarkersOf(DESKTOP_URL)).split(';')[0]

  const r1 = res()
  eq('干净 / + 暂存 → 302', restore(req('/', { cookie: stash }), r1), true)
  eq('补投目标正确', r1.headers.location, DESKTOP_URL)

  const r2 = res()
  eq('带 token 的 / → 不抢跳（核心交换优先）', restore(req('/?token=abc', { cookie: stash }), r2), false)

  const r3 = res()
  eq('已经带标记 → 不重复跳', restore(req(DESKTOP_URL, { cookie: stash }), r3), false)

  const r4 = res()
  eq('非根路径 → 不动', restore(req('/settings', { cookie: stash }), r4), false)

  const r5 = res()
  eq('没有暂存 → 不动', restore(req('/'), r5), false)

  const r6 = res()
  eq('POST → 不动', restore(req('/', { cookie: stash }, 'POST'), r6), false)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
