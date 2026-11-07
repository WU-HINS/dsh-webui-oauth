/**
 * 远程访问信任（原 dsh-remote-trust 的可选内置）回归。
 *
 * 行为约定：
 *   - 默认关闭；只有 remote-web-ui.trustRemoteHost === true 才注入；
 *   - 注入是幂等的：index 里已有 ownsHost（例如同时装了 dsh-remote-trust）就不再重复；
 *   - webServer.tapIndex 不存在（核心改动/旧版本）时**安全降级**：记 warn、返回 false、
 *     绝不抛异常，插件其余功能照常；
 *   - 卸载时 tap 的 disposer 挂在 ctx.effect 上。
 *
 * 运行：node test/remote-trust.test.mjs
 */
import {
  injectRemoteTrust, installRemoteTrust, remoteTrustEnabled,
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

const HTML = '<html><head><title>x</title></head><body>ok</body></html>'

console.log('— 1. index 变换 —')
{
  const out = injectRemoteTrust(HTML)
  eq('注入了 ownsHost', out.includes('ownsHost'), true)
  eq('脚本在 </head> 之前', out.indexOf('ownsHost') < out.indexOf('</head>'), true)
  eq('页面其余内容不变', out.replace(/<script>.*?<\/script>/, ''), HTML)
  eq('幂等：已有 ownsHost 不重复注入', injectRemoteTrust(out), out)
  eq('缺 </head> 时原样返回', injectRemoteTrust('<html><body>x</body></html>'), '<html><body>x</body></html>')
  eq('非字符串原样返回', injectRemoteTrust(null), null)
  eq('与 dsh-remote-trust 的注入共存（不重复）',
    injectRemoteTrust('<head><script>globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});</script></head>')
      .match(/ownsHost/g).length, 1)
}

console.log('\n— 2. 配置读取 —')
{
  const mk = (section) => ({ get: (ns) => ns === 'settings' ? { get: () => section } : undefined })
  eq('默认关闭', remoteTrustEnabled(mk({})), false)
  eq('显式 false', remoteTrustEnabled(mk({ trustRemoteHost: false })), false)
  eq('显式 true', remoteTrustEnabled(mk({ trustRemoteHost: true })), true)
  eq('无 settings 服务 → 关闭', remoteTrustEnabled({ get: () => undefined }), false)
  eq('settings 抛错 → 关闭', remoteTrustEnabled({ get: () => { throw new Error('x') } }), false)
}

console.log('\n— 3. 安装与版本兼容 —')
{
  const mkCtx = (section, ws) => {
    const ctx = {
      webServer: ws,
      get(ns) { return ns === 'settings' ? { get: () => section } : undefined },
      warned: false,
      effectCalled: false,
      logger: {
        info() {},
        warn(m) { ctx.warned = true; ctx.lastWarn = m },
        error() {},
      },
      effect(fn) { ctx.effectCalled = true; return fn() },
    }
    return ctx
  }

  // 关闭：不碰 tapIndex
  {
    let called = 0
    const ws = { tapIndex() { called++; return () => {} } }
    eq('关闭时不安装', installRemoteTrust(mkCtx({}, ws)), false)
    eq('关闭时不调用 tapIndex', called, 0)
  }

  // 开启 + tapIndex 可用
  {
    let transform = null
    const ws = { tapIndex(fn) { transform = fn; return () => { transform = null } } }
    const ctx = mkCtx({ trustRemoteHost: true }, ws)
    eq('开启时安装', installRemoteTrust(ctx), true)
    eq('拿到 index 变换', typeof transform, 'function')
    eq('变换会注入', transform(HTML).includes('ownsHost'), true)
    eq('挂到 ctx.effect 上（可卸载）', ctx.effectCalled, true)
  }

  // 开启但 tapIndex 缺失：安全降级
  {
    const ctx = mkCtx({ trustRemoteHost: true }, {})
    let threw = false
    let result = null
    try { result = installRemoteTrust(ctx) } catch (e) { threw = true }
    eq('tapIndex 缺失不抛异常', threw, false)
    eq('tapIndex 缺失返回 false', result, false)
    eq('写了一条 warn', ctx.warned, true)
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
