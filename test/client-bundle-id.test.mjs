/**
 * 验证 lib/client.js 注册的 id 与 bundle 行名一致。
 * 生产报错根因：client.js 用 id 'dsh-webui-auth' 注册，而 bundle 注入的行名是
 * 'dsh-webui-oauth'，client-modules 找不到对应注册 → 插件面板加载失败。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

// 相对测试文件定位仓库根，绝不硬编码绝对路径——否则换个机器/CI 必挂。
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

const m = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)
eq('client.js 有 __ModuleLoader__.load 调用', m !== null)
const registeredId = m ? m[1] : null
console.log('    注册 id =', registeredId)

const patchId = /- id:\s*([A-Za-z0-9_-]+)/.exec(patch)?.[1]
console.log('    patch 行 id =', patchId)
eq('client 注册 id === patch 行 id', registeredId === patchId, registeredId + ' vs ' + patchId)
eq('client 注册 id === 包名', registeredId === pkg.name, registeredId + ' vs ' + pkg.name)

// 不得把旧插件名当作「插件标识」使用（例外：凭据文件名 dsh-webui-auth.json
// 刻意沿用原名以保证账号不丢，那不是插件标识）。
const asIdentity = [...client.matchAll(/dsh-webui-auth(?!\.json)/g)].length
eq('client.js 无残留旧插件名（凭据文件名除外）', asIdentity === 0, '出现 ' + asIdentity + ' 次')
eq('凭据文件名仍沿用 dsh-webui-auth.json（账号不丢）', client.includes('dsh-webui-auth.json'))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
