/**
 * 「顶掉原版 dsh-webui-auth」行为测试。
 *
 * 场景：用户原先装了原版 dsh-webui-auth，现改装 dsh-webui-oauth。两者都包装
 * webServer 路由实现认证，若同时存活会出现双闸门（登录后反复跳转）。本插件
 * 必须在启动时主动 dispose 掉原版。
 *
 * 运行：node test/displace-original.test.mjs
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyPlugin } from '../index.js'

// apply() 会往插件源码目录写 sessions.jsonl / setup-token（源码安装下 DATA_DIR 即
// 源码目录），测试前后快照并还原，保证测试对工作区零副作用、可重复运行。
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

/** 构造一个假的 cordis 风格注册表：runtime 带 name 与 fibers。 */
function makeHost({ withOriginal = true, withOtherPlugin = true } = {}) {
  const disposed = []
  function makeFiber(label) {
    return { label, dispose() { disposed.push(label) } }
  }
  const runtimes = new Map()
  const add = (rtName, fiberLabels) => {
    const callback = { apply() {} }
    const rt = { name: rtName, callback, fibers: fiberLabels.map(makeFiber) }
    runtimes.set(callback, rt)
    return rt
  }
  if (withOriginal) add('dsh-webui-auth', ['orig-1', 'orig-2'])
  if (withOtherPlugin) add('dsh-some-other-plugin', ['other-1'])
  add('dsh-webui-oauth', ['self-1'])

  const registry = {
    values() { return runtimes.values() },
    delete(callback) {
      const rt = runtimes.get(callback)
      if (!rt) return undefined
      runtimes.delete(callback)
      for (const f of rt.fibers) f.dispose()
      return rt
    },
  }
  const routes = new Map()
  const ctx = {
    registry,
    fs: {
      async resolve(p) { return p },
      async readText() { return null },
      async writeText() {},
    },
    webServer: {
      port: 3080,
      prefixes: new Map([['/api', {}], ['', {}], ['/plugins', {}]]),
      upgrades: new Map(),
      fallback: undefined,
      register(r) { routes.set(r.path, r); return r },
    },
    get(ns) {
      if (ns === 'settings') return { get: () => undefined }
      if (ns === 'connection') return { authenticatedUrl: (b) => b + '/?token=x', requestRejection: () => 401 }
      return undefined
    },
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) { return fn() },
  }
  return { ctx, disposed, runtimes }
}

console.log('\n— 存在原版：应被 dispose 掉，其他插件不受影响 —')
{
  const { ctx, disposed, runtimes } = makeHost({ withOriginal: true, withOtherPlugin: true })
  await applyPlugin(ctx)
  eq('原版 fiber 全部被 dispose', disposed.includes('orig-1') && disposed.includes('orig-2'), JSON.stringify(disposed))
  eq('原版 runtime 已从注册表移除', ![...runtimes.values()].some((r) => r.name === 'dsh-webui-auth'),
    JSON.stringify([...runtimes.values()].map((r) => r.name)))
  eq('其他插件未被误伤', !disposed.includes('other-1'), JSON.stringify(disposed))
  eq('其他插件仍在注册表', [...runtimes.values()].some((r) => r.name === 'dsh-some-other-plugin'),
    JSON.stringify([...runtimes.values()].map((r) => r.name)))
  eq('自身未被误伤', !disposed.includes('self-1'), JSON.stringify(disposed))
}

console.log('\n— 不存在原版：静默继续，不报错 —')
{
  const { ctx, disposed } = makeHost({ withOriginal: false, withOtherPlugin: true })
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('apply 不抛异常', threw === null, String(threw))
  eq('未误伤其他插件', !disposed.includes('other-1'), JSON.stringify(disposed))
}

console.log('\n— registry 缺失/异常：退化为不替换，但仍能启动 —')
{
  const { ctx } = makeHost({ withOriginal: false })
  delete ctx.registry
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('无 registry 时 apply 不抛异常', threw === null, String(threw))
}
{
  const { ctx } = makeHost({ withOriginal: false })
  ctx.registry = { values() { throw new Error('registry boom') } }
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('registry.values 抛错时 apply 不抛异常', threw === null, String(threw))
}

console.log('\n— 插件名已改名 —')
{
  const mod = await import('../index.js')
  eq('插件 name 为 dsh-webui-oauth', mod.name, 'dsh-webui-oauth')
}

restoreRuntimeFiles()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
