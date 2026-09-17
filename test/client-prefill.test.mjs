/**
 * 设置页「回显/预填」行为测试。
 *
 * 验收标准（部署者定义）：**只过滤密钥，其余全部预填**——
 * 用户名、OIDC 入口(issuer)、OIDC APP ID(clientId)、Scope、Redirect Base
 * 都应在打开设置页时显示当前值。clientSecret 永不回显。
 *
 * 重点回归：曾经用【模块级】变量做"只回填一次"的开关。模块变量只在整页刷新时
 * 重置，而用户在 SPA 内切走再切回设置页时组件会重新挂载（局部 state 归零）却
 * 不复位该变量，于是整块回填被跳过——表现为「切页回来字段全空，手动刷新才正常」。
 * 现在改为组件内的 ref，随挂载生命周期失效。
 *
 * 本测试用一个还原了关键语义的 React 替身直接驱动真实组件源码：
 *   - useState：同一挂载期内保持状态；卸载后丢弃
 *   - useRef  ：同一挂载期内返回同一个对象；卸载后是新对象（本修复成立的关键）
 *
 * 运行：node test/client-prefill.test.mjs
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'lib/client.js'), 'utf8')

// ---- 还原关键语义的 React 替身 ----
let captured = null
const slots = []
let mountState = []   // 本挂载期的 useState 单元
let mountRefs = []    // 本挂载期的 ref 对象
let hookIdx = 0

const react = {
  createElement: (t, p, ...c) => ({ __el: true, type: t, props: p || {}, children: c }),
  useState: (init) => {
    const i = hookIdx++
    if (mountState[i] === undefined) mountState[i] = { v: init }
    const cell = mountState[i]
    return [cell.v, (nv) => { cell.v = typeof nv === 'function' ? nv(cell.v) : nv }]
  },
  useEffect: (fn) => { fn() },
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useRef: (init) => {
    const i = hookIdx++
    if (mountRefs[i] === undefined) mountRefs[i] = { current: init }
    return mountRefs[i]
  },
  Fragment: 'Fragment',
}

const loader = {
  load({ id, factory }) {
    captured = factory((n) => {
      if (n === 'react') return react
      throw new Error('unexpected require: ' + n)
    })
    return captured
  },
}
const document = { createElement: () => ({ setAttribute() {}, textContent: '' }), head: { appendChild() {} }, getElementById: () => null }

// 服务端会返回的 status（注意：**不含** clientSecret）
const STATUS = {
  enabled: true,
  username: 'HINS',
  ttl: 24,
  oidc: {
    enabled: true,
    issuer: 'https://idp.example.com',
    clientId: 'my-app-id',
    scope: 'openid profile email',
    redirectBase: 'https://dsh.example.com',
    trustBrowserOrigin: true,
    bound: true,
    boundSubHint: 'su****ce',
    redirectUri: 'https://dsh.example.com/dsh-webui-oauth/oidc/callback',
    callbackPath: '/dsh-webui-oauth/oidc/callback',
  },
}

const sandbox = {
  window: { __ModuleLoader__: loader }, document, console, Symbol, Object, Array, JSON, Error,
  String, Number, Boolean, Math, Date, Promise, RegExp, Map, Set,
  location: { origin: 'http://x' },
  fetch: (u) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(String(u).includes('/status') ? STATUS : { ok: true, entries: [] }),
  }),
  setTimeout, clearTimeout,
}
runInContext(src, createContext(sandbox))
const ctx = { effect: (fn) => { fn(); return () => {} }, slots: { inject: (n, fn) => fn(), register: (m, c) => { slots.push({ meta: m, comp: c }); return () => {} } } }
captured.apply(ctx)
const Comp = slots[0].comp

/** 渲染一次并收集所有非密码 input 的 value。 */
function renderFields() {
  hookIdx = 0
  const out = []
  const walk = (n) => {
    if (!n || n === false) return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.__el) {
      if (n.type === 'input') out.push({ type: n.props.type, value: n.props.value })
      n.children.forEach(walk)
    }
  }
  walk(Comp())
  return out
}
/** 模拟组件卸载：本挂载期的 hook 状态与 ref 全部丢弃。 */
function unmount() { mountState = []; mountRefs = []; hookIdx = 0 }
const tick = () => new Promise((r) => setTimeout(r, 50))

console.log('\n— 1. 首次进入设置页：除密钥外全部预填 —')
{
  const fields = await (async () => { renderFields(); await tick(); return renderFields() })()
  const values = fields.map((f) => f.value)
  eq('用户名已预填', values.includes('HINS'), JSON.stringify(values))
  eq('OIDC 入口(issuer) 已预填', values.includes('https://idp.example.com'), JSON.stringify(values))
  eq('OIDC APP ID(clientId) 已预填', values.includes('my-app-id'), JSON.stringify(values))
  eq('Scope 已预填', values.includes('openid profile email'), JSON.stringify(values))
  eq('Redirect Base 已预填', values.includes('https://dsh.example.com'), JSON.stringify(values))
  const pw = fields.filter((f) => f.type === 'password').map((f) => f.value)
  eq('所有密码框均为空（含 clientSecret）', pw.every((v) => !v), JSON.stringify(pw))
}

console.log('\n— 2. 切走再切回（组件重挂载）：仍须回填 —')
{
  // 这是曾经失败的场景：模块级开关不复位，回填被整体跳过。
  unmount()
  renderFields()
  await tick()
  const values = renderFields().map((f) => f.value)
  eq('切回后用户名回填', values.includes('HINS'), JSON.stringify(values))
  eq('切回后 APP ID 回填', values.includes('my-app-id'), JSON.stringify(values))
  eq('切回后 OIDC 入口回填', values.includes('https://idp.example.com'), JSON.stringify(values))
}

console.log('\n— 3. 连续多次切换都要回填（不能只靠第一次侥幸）—')
{
  let allOk = true
  for (let i = 0; i < 3; i++) {
    unmount()
    renderFields()
    await tick()
    const v = renderFields().map((f) => f.value)
    if (!v.includes('HINS') || !v.includes('my-app-id')) allOk = false
  }
  eq('三次切换后均正常回填', allOk)
}

console.log('\n— 4. clientSecret 永不回显 —')
{
  // 服务端 status 本来就不带 clientSecret；这里额外确认即使有人往里塞，
  // 组件也不该把它渲染到界面上。
  const before = STATUS.oidc.clientSecret
  STATUS.oidc.clientSecret = 'leaked-secret'
  unmount()
  renderFields()
  await tick()
  const fields = renderFields()
  const values = fields.map((f) => f.value)
  eq('clientSecret 不出现在任何输入框', !values.includes('leaked-secret'), JSON.stringify(values))
  if (before === undefined) delete STATUS.oidc.clientSecret
  else STATUS.oidc.clientSecret = before
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
