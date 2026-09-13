/**
 * 「接管原版数据目录」行为测试。
 *
 * 本插件是原版 dsh-webui-auth 的替代品：用户很可能已有账号，甚至已登录会话。
 * 改包名后若直接用自己的目录，会出现"装上就丢账号"。规则：
 *   - 自身已有凭据 → 不动（不覆盖新插件已建立的数据）；
 *   - 自身无凭据 → 依次查找含凭据的原版目录：
 *       ① 同级 ../dsh-webui-auth/
 *       ② $DSH_HOME/dsh-webui-auth/
 *     找到则【复用】（不是复制：复制会让两份凭据各自修改而分叉）。
 *
 * 通过「子进程 + 临时工作目录」构造真实目录布局来验证（不 mock fs 判断逻辑）。
 *
 * 运行：node test/adopt-data-dir.test.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

const here = dirname(fileURLToPath(import.meta.url))
const modulePath = join(here, '..', 'index.js')

const roots = []
const freshRoot = () => { const d = mkdtempSync(join(tmpdir(), 'adopt-')); roots.push(d); return d }

/**
 * 在给定的宿主目录里放一个"插件目录"，并以该目录为基准解析数据目录。
 * 由于模块按 import.meta.url 定位自身，这里用软链把插件源码链进宿主，
 * 从而让 pluginDir() 落在宿主的插件目录上，真实复现同级布局。
 */
function probeDataDir({ pluginDirName, hostDir, dshHome, selfHasCred, siblings }) {
  // 构造宿主的插件目录
  const selfDir = join(hostDir, pluginDirName)
  mkdirSync(selfDir, { recursive: true })
  copyFileSync(modulePath, join(selfDir, 'index.js'))
  if (selfHasCred) writeFileSync(join(selfDir, 'dsh-webui-auth.json'), JSON.stringify({ v: 3, username: 'self' }))
  for (const [name, cred] of Object.entries(siblings || {})) {
    const d = join(hostDir, name)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'dsh-webui-auth.json'), JSON.stringify(cred))
  }
  const code = `
    const m = await import(${JSON.stringify(join(selfDir, 'index.js'))})
    console.log(JSON.stringify({ dataDir: m.DATA_DIR }))
  `
  const env = { ...process.env, DSH_WEBUI_AUTH_DATA_DIR: '' }
  if (dshHome) env.DSH_HOME = dshHome
  else delete env.DSH_HOME
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', cwd: hostDir })
  if (r.status !== 0) return { error: (r.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ') }
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  try { return JSON.parse(line) } catch (e) { return { error: 'bad output: ' + line } }
}

const cred = (name) => ({ v: 3, username: name, hash: 'scrypt:1:1:1:x:y', ttl: 12 })

console.log('\n— 1. 自身无凭据 + 同级有原版 → 接管同级 —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  const r = probeDataDir({
    pluginDirName: 'dsh-webui-oauth',
    hostDir: host,
    dshHome,
    selfHasCred: false,
    siblings: { 'dsh-webui-auth': cred('orig') },
  })
  eq('数据目录落在同级原版目录', String(r.dataDir).replace(/\\/g, '/') === join(host, 'dsh-webui-auth').replace(/\\/g, '/'), JSON.stringify(r))
}

console.log('\n— 2. 自身已有凭据 → 不接管（保护新数据） —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  const r = probeDataDir({
    pluginDirName: 'dsh-webui-oauth',
    hostDir: host,
    dshHome,
    selfHasCred: true,
    siblings: { 'dsh-webui-auth': cred('orig') },
  })
  eq('数据目录留在自身', String(r.dataDir).replace(/\\/g, '/') === join(host, 'dsh-webui-oauth').replace(/\\/g, '/'), JSON.stringify(r))
}

console.log('\n— 3. 自身无凭据 + 同级无原版 + $DSH_HOME 有原版 → 接管兜底位置 —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  mkdirSync(join(dshHome, 'dsh-webui-auth'), { recursive: true })
  writeFileSync(join(dshHome, 'dsh-webui-auth', 'dsh-webui-auth.json'), JSON.stringify(cred('legacy')))
  const r = probeDataDir({
    pluginDirName: 'dsh-webui-oauth',
    hostDir: host,
    dshHome,
    selfHasCred: false,
    siblings: {},
  })
  eq('数据目录落在 $DSH_HOME 原版目录',
    String(r.dataDir).replace(/\\/g, '/') === join(dshHome, 'dsh-webui-auth').replace(/\\/g, '/'),
    JSON.stringify(r))
}

console.log('\n— 4. 两处都没有 → 用自身目录（全新安装） —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  mkdirSync(dshHome, { recursive: true })
  const r = probeDataDir({
    pluginDirName: 'dsh-webui-oauth',
    hostDir: host,
    dshHome,
    selfHasCred: false,
    siblings: {},
  })
  eq('数据目录为自身', String(r.dataDir).replace(/\\/g, '/') === join(host, 'dsh-webui-oauth').replace(/\\/g, '/'), JSON.stringify(r))
}

console.log('\n— 5. 同级目录有 dsh-webui-auth 但没有凭据 → 不接管（避免空目录劫持） —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  mkdirSync(join(host, 'dsh-webui-auth'), { recursive: true }) // 只有目录，没有凭据文件
  const r = probeDataDir({
    pluginDirName: 'dsh-webui-oauth',
    hostDir: host,
    dshHome,
    selfHasCred: false,
    siblings: {},
  })
  eq('无凭据则不接管', String(r.dataDir).replace(/\\/g, '/') === join(host, 'dsh-webui-oauth').replace(/\\/g, '/'), JSON.stringify(r))
}

console.log('\n— 6. 显式 DSH_WEBUI_AUTH_DATA_DIR 覆盖优先于接管 —')
{
  const host = freshRoot()
  const dshHome = join(host, 'dshhome')
  const forced = join(host, 'forced-data')
  const selfDir = join(host, 'dsh-webui-oauth')
  mkdirSync(selfDir, { recursive: true })
  copyFileSync(modulePath, join(selfDir, 'index.js'))
  mkdirSync(join(host, 'dsh-webui-auth'), { recursive: true })
  writeFileSync(join(host, 'dsh-webui-auth', 'dsh-webui-auth.json'), JSON.stringify(cred('orig')))
  mkdirSync(forced, { recursive: true })
  const code = `
    const m = await import(${JSON.stringify(join(selfDir, 'index.js'))})
    console.log(JSON.stringify({ dataDir: m.DATA_DIR }))
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DSH_WEBUI_AUTH_DATA_DIR: forced, DSH_HOME: dshHome },
    encoding: 'utf8', cwd: host,
  })
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  let parsed = {}
  try { parsed = JSON.parse(line) } catch (e) { parsed = { error: line } }
  eq('采用显式覆盖值', String(parsed.dataDir).replace(/\\/g, '/') === forced.replace(/\\/g, '/'), JSON.stringify(parsed))
}

for (const d of roots) rmSync(d, { recursive: true, force: true })

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
