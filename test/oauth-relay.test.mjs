/**
 * 官方 DeepSeek 账号登录的远程兼容层回归。
 *
 * 上游 loginOrigin() 只接受 http://localhost|127.0.0.1|[::1]:<port>；
 * 远程部署下浏览器到不了回环回调，插件把 callbackOrigin 桥接到回环，
 * 并提供「回调中转」端点把用户粘贴的 URL 在服务端内部重放。
 *
 * 运行：node test/oauth-relay.test.mjs
 */
import {
  isLoopbackLoginOrigin, parseOAuthRelayUrl, installAccountLoginBridge,
} from '../index.js'

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

console.log('— 1. 回环 origin 判定（与上游 loginOrigin 对齐）—')
{
  eq('127.0.0.1 + 端口', isLoopbackLoginOrigin('http://127.0.0.1:3080'), true)
  eq('localhost + 端口 + 尾斜杠', isLoopbackLoginOrigin('http://localhost:3080/'), true)
  eq('IPv6 回环', isLoopbackLoginOrigin('http://[::1]:3080'), true)
  eq('https 拒绝', isLoopbackLoginOrigin('https://127.0.0.1:3080'), false)
  eq('缺端口拒绝', isLoopbackLoginOrigin('http://127.0.0.1'), false)
  eq('端口 0 拒绝', isLoopbackLoginOrigin('http://127.0.0.1:0'), false)
  eq('远程域名拒绝', isLoopbackLoginOrigin('https://dsh.example.com'), false)
  eq('带路径拒绝', isLoopbackLoginOrigin('http://127.0.0.1:3080/x'), false)
  eq('非字符串拒绝', isLoopbackLoginOrigin(null), false)
}

console.log('\n— 2. 回调 URL 校验（中转端点）—')
{
  const ok = parseOAuthRelayUrl('http://127.0.0.1:3080/oauth/callback?code=abc&state=xyz', 3080)
  eq('合法 URL 通过', ok.ok, true)
  eq('抽出 query', ok.query, 'code=abc&state=xyz')

  eq('localhost 也接受', parseOAuthRelayUrl('http://localhost:3080/oauth/callback?code=a&state=s', 3080).ok, true)
  eq('IPv6 也接受', parseOAuthRelayUrl('http://[::1]:3080/oauth/callback?code=a&state=s', 3080).ok, true)
  eq('https 拒绝', parseOAuthRelayUrl('https://127.0.0.1:3080/oauth/callback?code=a&state=s', 3080).ok, false)
  eq('端口不符拒绝', parseOAuthRelayUrl('http://127.0.0.1:9999/oauth/callback?code=a&state=s', 3080).ok, false)
  eq('远程 host 拒绝（防 SSRF）', parseOAuthRelayUrl('http://evil.example:3080/oauth/callback?code=a&state=s', 3080).ok, false)
  eq('路径不符拒绝', parseOAuthRelayUrl('http://127.0.0.1:3080/other?code=a&state=s', 3080).ok, false)
  eq('缺 code 拒绝', parseOAuthRelayUrl('http://127.0.0.1:3080/oauth/callback?state=s', 3080).ok, false)
  eq('缺 state 拒绝', parseOAuthRelayUrl('http://127.0.0.1:3080/oauth/callback?code=a', 3080).ok, false)
  eq('重复 code 拒绝', parseOAuthRelayUrl('http://127.0.0.1:3080/oauth/callback?code=a&code=b&state=s', 3080).ok, false)
  eq('带 hash 拒绝', parseOAuthRelayUrl('http://127.0.0.1:3080/oauth/callback?code=a&state=s#x', 3080).ok, false)
  eq('空串拒绝', parseOAuthRelayUrl('', 3080).ok, false)
}

console.log('\n— 3. startSignIn 桥接 —')
{
  const makeCtx = (account, port = 3080) => {
    const ctx = {
      webServer: { port },
      logger: { info() {}, warn() {}, error() {} },
      effect(fn) { return fn() },
      inject(deps, cb) { cb({ deepseekAccount: account, effect: ctx.effect, logger: ctx.logger }) },
    }
    return ctx
  }

  // 远程（域名）origin → 改写成 127.0.0.1:<port>
  {
    let received = null
    const account = {
      startSignIn(client, origin, source) { received = { origin, source }; return 'ok' },
    }
    const ctx = makeCtx(account)
    eq('桥接安装成功', installAccountLoginBridge(ctx), true)
    account.startSignIn({}, 'https://dsh.example.com', 'web')
    eq('域名 origin 被改写为回环', received.origin, 'http://127.0.0.1:3080')
    eq('loginSource 原样保留', received.source, 'web')
    eq('重复安装不会二次包装', installAccountLoginBridge(ctx), true)
  }

  // 本地回环 origin → 原样保留（cookie 同 host）
  {
    let received = null
    const account = { startSignIn(c, origin) { received = origin } }
    installAccountLoginBridge(makeCtx(account))
    account.startSignIn({}, 'http://localhost:3080', 'web')
    eq('本地回环 origin 原样保留', received, 'http://localhost:3080')
  }

  // 服务不存在 / 无 inject：安全跳过
  eq('无 inject 时不抛异常', installAccountLoginBridge({}), false)
  {
    let threw = false
    try { installAccountLoginBridge({ inject() {} }) } catch (e) { threw = true }
    eq('inject 回调未触发也不抛异常', threw, false)
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
