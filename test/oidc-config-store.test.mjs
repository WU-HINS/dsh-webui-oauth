/**
 * OIDC 配置独立存储验证（dsh-webui-oauth.json）。
 *
 * 覆盖：
 *   1. 新布局写入：OIDC 落到独立文件；
 *   2. 旧布局回落：仅凭据文件内有 oidc 段时仍能读到（无感升级）；
 *   3. 新布局优先于旧布局；
 *   4. 两者都没有时不报错；
 *   5. 数据目录支持环境变量覆盖，且两个文件命名正确
 *      （凭据沿用 dsh-webui-auth.json，OIDC 用 dsh-webui-oauth.json）。
 *
 * DATA_DIR 在模块加载时确定，故用「子进程 + DSH_WEBUI_AUTH_DATA_DIR」让每个
 * 场景落到独立临时目录：走真实 fs、互不干扰，也不污染源码目录。
 *
 * 运行：node test/oidc-config-store.test.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

const here = dirname(fileURLToPath(import.meta.url))
const modulePath = join(here, '..', 'index.js')

// 探针用的真实文件 fs 桩（读）
const REAL_FS = `{ async resolve(p){return p}, async readText(p){ const fs=await import('node:fs'); try { return fs.readFileSync(p,'utf8') } catch(e) { return null } } }`

function probe(dataDir, code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DSH_WEBUI_AUTH_DATA_DIR: dataDir },
    encoding: 'utf8',
    cwd: here,
  })
  if (r.status !== 0) return { error: (r.stderr || '').split('\n').filter(Boolean).slice(-5).join(' | ') }
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  try { return JSON.parse(line) } catch (e) { return { error: 'bad output: ' + line } }
}

const dirs = []
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), 'oidc-store-')); dirs.push(d); return d }

const CRED = { v: 3, username: 'admin', hash: 'scrypt:1:1:1:x:y', ttl: 12 }
const OIDC = { enabled: true, issuer: 'https://idp.test', clientId: 'cid', clientSecret: 'sec' }

console.log('\n— 1. 新布局：OIDC 写入独立文件 —')
{
  const d = freshDir()
  const r = probe(d, `
    import { writeOidcConfig } from ${JSON.stringify(modulePath)}
    const fs = await import('node:fs')
    await writeOidcConfig({ fs: { async resolve(p){return p}, async writeText(p,data){ fs.writeFileSync(p,data) } } }, ${JSON.stringify(OIDC)})
    console.log(JSON.stringify({ ok: true }))
  `)
  eq('写入未报错', r.ok === true, JSON.stringify(r))
  const oidcFile = join(d, 'dsh-webui-oauth.json')
  eq('独立文件已创建', existsSync(oidcFile), oidcFile)
  if (existsSync(oidcFile)) {
    const parsed = JSON.parse(readFileSync(oidcFile, 'utf8'))
    eq('独立文件含 clientSecret', !!(parsed.oidc && parsed.oidc.clientSecret === 'sec'), JSON.stringify(parsed))
  }
}

console.log('\n— 2. 旧布局回落：仅凭据文件有 oidc 段时仍读到 —')
{
  const d = freshDir()
  writeFileSync(join(d, 'dsh-webui-auth.json'), JSON.stringify({ ...CRED, oidc: OIDC }))
  const r = probe(d, `
    import { readOidcConfig } from ${JSON.stringify(modulePath)}
    const res = await readOidcConfig({ fs: ${REAL_FS} }, ${JSON.stringify({ ...CRED, oidc: OIDC })})
    console.log(JSON.stringify({ oidc: res.oidc, legacy: res.legacy }))
  `)
  eq('回落到旧布局的 oidc', !!(r.oidc && r.oidc.clientSecret === 'sec'), JSON.stringify(r))
  eq('标记为 legacy', r.legacy === true, JSON.stringify(r))
}

console.log('\n— 3. 新布局优先于旧布局 —')
{
  const d = freshDir()
  writeFileSync(join(d, 'dsh-webui-auth.json'), JSON.stringify({ ...CRED, oidc: { enabled: true, issuer: 'https://old.test', clientId: 'old', clientSecret: 'oldsec' } }))
  writeFileSync(join(d, 'dsh-webui-oauth.json'), JSON.stringify({ v: 1, oidc: { enabled: true, issuer: 'https://new.test', clientId: 'new', clientSecret: 'newsec' } }))
  const r = probe(d, `
    import { readOidcConfig } from ${JSON.stringify(modulePath)}
    const res = await readOidcConfig({ fs: ${REAL_FS} }, ${JSON.stringify({ ...CRED, oidc: { issuer: 'https://old.test' } })})
    console.log(JSON.stringify({ issuer: res.oidc && res.oidc.issuer, legacy: res.legacy }))
  `)
  eq('采信独立文件', r.issuer === 'https://new.test', JSON.stringify(r))
  eq('非 legacy', r.legacy === false, JSON.stringify(r))
}

console.log('\n— 4. 两者都没有：返回空且不报错 —')
{
  const d = freshDir()
  const r = probe(d, `
    import { readOidcConfig } from ${JSON.stringify(modulePath)}
    const res = await readOidcConfig({ fs: { async resolve(p){return p}, async readText(){ return null } } }, null)
    console.log(JSON.stringify({ oidc: res.oidc, legacy: res.legacy }))
  `)
  eq('oidc 为 null', r.oidc === null, JSON.stringify(r))
  eq('未标 legacy', r.legacy === false, JSON.stringify(r))
}

console.log('\n— 5. 数据目录覆盖与文件命名 —')
{
  const d = freshDir()
  const r = probe(d, `
    import { DATA_DIR, configPath, oidcConfigPath } from ${JSON.stringify(modulePath)}
    console.log(JSON.stringify({ dataDir: DATA_DIR, cred: configPath(), oidc: oidcConfigPath() }))
  `)
  const norm = (p) => String(p).replace(/\\/g, '/')
  eq('DATA_DIR 采用覆盖值', norm(r.dataDir) === norm(d), JSON.stringify(r))
  eq('凭据文件沿用原名', String(r.cred).endsWith('/dsh-webui-auth.json'), r.cred)
  eq('OIDC 文件为 dsh-webui-oauth.json', String(r.oidc).endsWith('/dsh-webui-oauth.json'), r.oidc)
}

for (const d of dirs) rmSync(d, { recursive: true, force: true })

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
