/**
 * 审计日志字段类型回归（upstream 0.3.6 的同类修复）。
 *
 * 旧实现：entry[key] = typeof v === 'string' || typeof v === 'number' ? v : String(v)
 * 于是 null 变成字符串 "null"、false 变成 "false"，日志里读起来像故障。
 * 现在 null/boolean 原样保留。
 *
 * 运行：node test/audit-null.test.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditLog } from '../index.js'

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

const dir = mkdtempSync(join(tmpdir(), 'dsh-audit-null-'))
const target = join(dir, 'audit.jsonl')
const ctx = {
  fs: { resolve: async () => ({ displayPath: target }) },
  logger: { warn() {}, error() {}, info() {} },
}

try {
  await auditLog(ctx, 'test_event', {
    username: null, detail: null, ok: false, count: 3, note: 'x',
  })
  const line = readFileSync(target, 'utf8').trim().split('\n').pop()
  const entry = JSON.parse(line)

  eq('event 保留', entry.event, 'test_event')
  eq('null 保持 null（不是字符串 "null"）', entry.username, null)
  eq('detail null 保持 null', entry.detail, null)
  eq('boolean 保持 boolean', entry.ok, false)
  eq('number 保持 number', entry.count, 3)
  eq('string 保持 string', entry.note, 'x')
  eq('undefined 字段被跳过', Object.prototype.hasOwnProperty.call(entry, 'missing'), false)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
