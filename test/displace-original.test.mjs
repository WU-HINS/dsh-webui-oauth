/**
 * 「与原版 dsh-webui-auth 双装」行为测试。
 *
 * 历史：早期版本尝试在运行时接管原版（先后用过 dispose fiber、disable 条目两种
 * 手段），两者都被隔离实例证明【必然导致 dsh 启动失败或静默失效】：
 *   - dispose fiber → 原版 apply 撞 INACTIVE_EFFECT，进程启动失败；
 *   - disable 条目   → 原版路由已注册，本插件注册时撞 duplicate route，进程启动失败；
 *   - 两者都不动     → 进程能起，但只有原版生效，本插件端点全部 404。
 * 根因：webServer 路由表先到先得，且条目不含属主信息，运行时无法安全接管。
 *
 * 因此当前契约是【不接管、只检测】：
 *   1. 不 dispose / 不 disable 任何兄弟条目或 fiber；
 *   2. 检测到原版启用时，明确报错，避免"装好了却没生效"的静默失效；
 *   3. 未检测到原版时保持安静（正常路径）。
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

/**
 * 构造一个假的宿主：loader 条目表 + cordis 注册表。
 *
 * 测试契约是【不接管】：本插件不得 dispose/disable 任何兄弟条目或 fiber。
 * 因此这里的 disable()/dispose() 都记账，任何一次调用都会让断言失败——
 * 这正是我们要守住的不变量（旧实现会在这些记账里留下痕迹）。
 */
function makeHost({ withOriginal = true, withOtherPlugin = true, withLoader = true, originalDisabled = false } = {}) {
  const disposed = []
  const disabled = []
  const warns = []
  const errors = []
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

  const entries = []
  const addEntry = (entryName, disabledFlag = false) => {
    const entry = {
      options: { id: entryName, name: entryName },
      disabled: disabledFlag,
      fiber: makeFiber(entryName + '-fiber'),
      disable() {
        disabled.push(entryName)
        const f = entry.fiber
        entry.fiber = undefined
        if (f) f.dispose()
      },
    }
    entries.push(entry)
    return entry
  }
  if (withLoader) {
    if (withOriginal) addEntry('dsh-webui-auth', originalDisabled)
    addEntry('dsh-webui-oauth')
  }

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
  const loader = withLoader ? { entries() { return entries.values() } } : undefined
  const ctx = {
    registry,
    loader,
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
      if (ns === 'loader') return loader
      return undefined
    },
    logger: {
      info() {},
      warn(m) { warns.push(String(m)) },
      error(m) { errors.push(String(m)); warns.push(String(m)) },
    },
    effect(fn) { return fn() },
  }
  return { ctx, disposed, disabled, warns, errors, runtimes, entries }
}

console.log('\n— 双装：直接抛错拒绝启动（fail-fast），且绝不碰原版的条目 / fiber / 路由 —')
{
  const { ctx, disposed, disabled, errors, runtimes, entries } = makeHost({ withOriginal: true, withOtherPlugin: true })
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('apply 抛出错误（拒绝启动）', threw !== null, String(threw))
  eq('错误信息说明检测到原版冲突', /检测到原版 dsh-webui-auth 同时启用/.test(String(threw)), String(threw))
  eq('错误信息含可执行的修复指令', /移除 dsh-webui-auth/.test(String(threw)) && /disabled: true/.test(String(threw)), String(threw))
  eq('错误也写进 stderr 之外的 logger（双通道）', errors.some((m) => /检测到原版/.test(m)), JSON.stringify(errors.slice(0, 2)))
  eq('未停用原版条目（抛错前不做任何接管）', !disabled.includes('dsh-webui-auth'), JSON.stringify(disabled))
  eq('原版条目 fiber 保持原样', entries[0].fiber !== undefined)
  eq('未 dispose 原版 fiber', !disposed.includes('orig-1') && !disposed.includes('orig-2'), JSON.stringify(disposed))
  eq('未停用自家条目', !disabled.includes('dsh-webui-oauth'), JSON.stringify(disabled))
  eq('未误伤其他插件', !disabled.includes('dsh-some-other-plugin') && !disposed.includes('other-1'), JSON.stringify(disabled))
  eq('原版 runtime 仍在注册表', [...runtimes.values()].some((r) => r.name === 'dsh-webui-auth'),
    JSON.stringify([...runtimes.values()].map((r) => r.name)))
}

console.log('\n— 原版被配置层 disabled：不算冲突，保持安静 —')
{
  // 这是推荐的双装解法：profile 的补丁层写 disabled: true。条目不会加载，
  // 本插件不该报错刷屏。
  const { ctx, errors, disabled } = makeHost({ withOriginal: true, originalDisabled: true })
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('apply 不抛异常', threw === null, String(threw))
  eq('不误报冲突', !errors.some((m) => /检测到原版/.test(m)), JSON.stringify(errors))
  eq('未动任何条目', disabled.length === 0, JSON.stringify(disabled))
}

console.log('\n— 未装原版：完全安静（正常路径）—')
{
  const { ctx, disposed, errors } = makeHost({ withOriginal: false, withOtherPlugin: true })
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('apply 不抛异常', threw === null, String(threw))
  eq('不报冲突', !errors.some((m) => /检测到原版/.test(m)), JSON.stringify(errors))
  eq('未误伤其他插件', !disposed.includes('other-1'), JSON.stringify(disposed))
}

console.log('\n— 历史崩溃的两条路径都不得复现 —')
{
  // 路径 1：原版正在加载中（fiber 尚未注册）。旧实现此刻 dispose 原版 fiber，
  // 会让原版随后的 registry.plugin() 撞 INACTIVE_EFFECT，整个进程启动失败。
  const { ctx, errors } = makeHost({ withOriginal: true, withOtherPlugin: true })
  const realPlugin = ctx.registry
  ctx.registry = {
    values() { return realPlugin.values() },
    delete() { throw new Error('cannot create effect on inactive context') },
  }
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('抛的不是 INACTIVE_EFFECT（而是我们自己的冲突错误）',
    !(threw !== null && /inactive/i.test(threw)) && /检测到原版/.test(String(threw)), String(threw))
  eq('冲突被报出', errors.some((m) => /检测到原版/.test(m)), JSON.stringify(errors.slice(0, 2)))
}
{
  // 路径 2：注册表删条目会触发 fiber dispose 链。当前实现根本不调用 registry.delete。
  // 注意：本用例的原版条目并不在 loader 里（values 返回空），故不会触发 fail-fast，
  // 正好用来验证"不碰别人生命周期"这条不变量。
  const { ctx, disposed } = makeHost({ withOriginal: true, withOtherPlugin: true })
  let deleteCalled = 0
  ctx.registry = {
    values() { return new Map().values() },
    delete() { deleteCalled += 1; throw new Error('should not be called') },
  }
  // loader 里移除原版条目，避免 fail-fast 抢先抛错
  ctx.get = (ns) => {
    if (ns === 'loader') return undefined
    if (ns === 'settings') return { get: () => undefined }
    return undefined
  }
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('不调用 registry.delete', deleteCalled === 0, String(deleteCalled))
  eq('不抛异常', threw === null, String(threw))
  eq('未 dispose 任何 fiber', disposed.length === 0, JSON.stringify(disposed))
}

console.log('\n— registry / loader 缺失或异常：退化为不检测，但仍能启动 —')
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
{
  const { ctx, disabled } = makeHost({ withOriginal: true })
  delete ctx.loader
  ctx.get = (ns) => (ns === 'loader' ? undefined : (ns === 'settings' ? { get: () => undefined } : undefined))
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('无 loader 时 apply 不抛异常', threw === null, String(threw))
  eq('无 loader 时不误停用任何条目', disabled.length === 0, JSON.stringify(disabled))
}
{
  const { ctx, disabled } = makeHost({ withOriginal: true })
  ctx.get = (ns) => {
    if (ns === 'loader') throw new Error('loader boom')
    if (ns === 'settings') return { get: () => undefined }
    return undefined
  }
  let threw = null
  try { await applyPlugin(ctx) } catch (e) { threw = e.message }
  eq('loader 异常时 apply 不抛异常', threw === null, String(threw))
  eq('loader 异常时不误动条目', disabled.length === 0, JSON.stringify(disabled))
}

console.log('\n— 插件名已改名 —')
{
  const mod = await import('../index.js')
  eq('插件 name 为 dsh-webui-oauth', mod.name, 'dsh-webui-oauth')
}

restoreRuntimeFiles()

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
