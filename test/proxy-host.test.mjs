/**
 * 反代改写 Host 场景下的跳转目标回归测试。
 *
 * 关键场景：反代把 Host 改写成内网回环地址（如 127.0.0.1:3080），浏览器侧地址
 * 在服务端不可得。此时：
 *   - 反代下发了原始主机头 → 采信它（权威的浏览器侧地址）；
 *   - 什么都没下发 → 判为回环，用配置的确定性 origin（publicBaseUrl）；
 *   - Host 已透传公网 → 按统一开关与白名单判断。
 *
 * 运行：node test/proxy-host.test.mjs   （或 npm test）
 */
import { postLoginRedirect } from '../index.js'

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

function mkCtx(settings) {
  return {
    get(ns) {
      if (ns === 'settings') return settings === undefined ? undefined : { get: (k) => settings[k] }
      if (ns === 'webServer') return { port: 3080 }
      if (ns === 'connection') return { authenticatedUrl: (base) => base + '/?token=abc' }
      return undefined
    },
  }
}
const req = (headers) => ({ headers, socket: {} })
const SEC = (o) => ({ 'remote-web-ui': o })
const PUB = SEC({ publicBaseUrl: 'https://dsh.example.com:8443' })

console.log('— 反代改写 Host：原始主机头优先 —')
eq('X-Forwarded-Host 被采信（改写成回环）',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'dsh.example.com:8443', 'x-forwarded-proto': 'https' })),
  'https://dsh.example.com:8443/?token=abc')
eq('Forwarded host= 亦被采信',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', forwarded: 'for=1.2.3.4;host=dsh.example.com:8443;proto=https' })),
  'https://dsh.example.com:8443/?token=abc')
eq('原始头端口缺省时按 scheme 补',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'dsh.example.com', 'x-forwarded-proto': 'https' })),
  'https://dsh.example.com/?token=abc')

console.log('\n— 反代什么都不下发：判为回环，回退配置 origin —')
eq('改写成回环 + 无原始头 → 用 publicBaseUrl',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080' })),
  'https://dsh.example.com:8443/?token=abc')
eq('改写成 localhost → 同上',
  postLoginRedirect(mkCtx(PUB), req({ host: 'localhost:3080' })),
  'https://dsh.example.com:8443/?token=abc')
eq('改写成 ::1 → 同上',
  postLoginRedirect(mkCtx(PUB), req({ host: '::1' })),
  'https://dsh.example.com:8443/?token=abc')
eq('回环但无配置 origin → 兜底回环（不引入新失败态）',
  postLoginRedirect(mkCtx(SEC({})), req({ host: '127.0.0.1:3080' })),
  'http://127.0.0.1:3080/?token=abc')

console.log('\n— Host 已透传原始地址：按统一开关 —')
eq('透传公网 + 默认开关 → 用请求 Host',
  postLoginRedirect(mkCtx(PUB), req({ host: 'dsh.example.com:8443', 'x-forwarded-proto': 'https' })),
  'https://dsh.example.com:8443/?token=abc')
eq('透传公网 + 开关关闭 → 用配置 origin',
  postLoginRedirect(mkCtx(SEC({ publicBaseUrl: 'https://dsh.example.com:8443', trustBrowserOrigin: false })), req({ host: 'lan.internal:8443' })),
  'https://dsh.example.com:8443/?token=abc')
eq('透传公网 + 开关开启 → 用请求 Host（不约束）',
  postLoginRedirect(mkCtx(PUB), req({ host: 'lan.internal:8443' })),
  'http://lan.internal:8443/?token=abc')

console.log('\n— 原始主机头必须经形状校验（防注入与污染）—')
eq('原始头带路径 → 拒收，回退配置',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'evil.example/../x' })),
  'https://dsh.example.com:8443/?token=abc')
eq('原始头带 CRLF → 拒收',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'a.com\r\nx-evil: 1' })),
  'https://dsh.example.com:8443/?token=abc')
eq('原始头非主机形状 → 拒收',
  postLoginRedirect(mkCtx(PUB), req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'not a host' })),
  'https://dsh.example.com:8443/?token=abc')
eq('原始头合法形状 → 采信（开关开启时不额外约束）',
  postLoginRedirect(mkCtx(PUB),
    req({ host: '127.0.0.1:3080', 'x-forwarded-host': 'other.example:8443', 'x-forwarded-proto': 'https' })),
  'https://other.example:8443/?token=abc')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
