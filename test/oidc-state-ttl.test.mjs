/**
 * OIDC 授权请求状态（state / nonce / PKCE verifier）的 TTL 语义验证。
 *
 * 这些值只在一次授权往返内有意义，因此设计为「内存暂存 + TTL + 一次性」。
 * 关键正确性要求（曾经缺失）：
 *   1. 过期判定必须在 take() 读取时同步完成 —— 只靠后台 60s 轮询的话，
 *      轮询间隙内过期 state 仍能兑换授权码，TTL 等于失效；
 *   2. state 是一次性的：消费后即便未过期也不能再用（防重放）；
 *   3. 必须有容量上限 —— `/oidc/login` 是公开端点，只按 TTL 淘汰会被灌爆内存；
 *      超限时淘汰最早创建者，正常并发量远低于上限故不影响真实用户。
 *
 * 通过注入 now()/ttl 精确控制时间，不依赖真实等待。
 *
 * 运行：node test/oidc-state-ttl.test.mjs
 */
import { makeOidcStateStore } from '../index.js'

let pass = 0, fail = 0
const eq = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + '  ' + (x === undefined ? '' : x)) } }

/** 可控时钟：手动推进毫秒。 */
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

const TTL = 10 * 60 * 1000

console.log('\n— 1. 未过期：可取出一次 —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st1', { nonce: 'n1', verifier: 'v1', redirectUri: 'https://x/cb' })
  eq('存在性可查', s.has('st1') === true)
  const got = s.take('st1')
  eq('取到内容', !!(got && got.nonce === 'n1' && got.verifier === 'v1'), JSON.stringify(got))
  eq('带 createdAt', typeof got.createdAt === 'number', JSON.stringify(got))
  eq('带 expiresAt = createdAt + TTL', got.expiresAt - got.createdAt === TTL, JSON.stringify(got))
}

console.log('\n— 2. 一次性：取出后立即失效（防重放） —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st2', { nonce: 'n', verifier: 'v' })
  s.take('st2')
  eq('二次取出为 null', s.take('st2') === null, String(s.take('st2')))
  eq('has 也变 false', s.has('st2') === false)
}

console.log('\n— 3. 过期边界：TTL 内有效，超出即失效（读取时判定，不等后台轮询） —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st3', { nonce: 'n', verifier: 'v' })
  c.advance(TTL - 1)
  eq('TTL 前 1ms 仍有效', s.take('st3') !== null, 'expected valid')
}
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st4', { nonce: 'n', verifier: 'v' })
  c.advance(TTL)
  eq('恰好 TTL 时失效', s.take('st4') === null, 'expected expired')
}
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st5', { nonce: 'n', verifier: 'v' })
  c.advance(TTL * 10)
  eq('远超 TTL 后失效（且不依赖 purge）', s.take('st5') === null, 'expected expired')
}
{
  // 最关键的回归：过期项在【从未调用 purge】的情况下也必须被 take 拒绝。
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('st6', { nonce: 'n', verifier: 'v' })
  c.advance(TTL + 1)
  eq('未跑 purge 也拒绝过期项', s.take('st6') === null, 'expected expired')
}

console.log('\n— 4. 未知 / 非法输入 —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  eq('未知 state', s.take('nope') === null, 'expected null')
  eq('空串', s.take('') === null, 'expected null')
  eq('null', s.take(null) === null, 'expected null')
  eq('undefined', s.take(undefined) === null, 'expected null')
  eq('数字', s.take(123) === null, 'expected null')
  eq('has 未知', s.has('nope') === false)
}

console.log('\n— 5. 容量上限：超限淘汰最早创建者（防公开端点灌爆内存） —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, maxPending: 3, now: c.now })
  s.put('a', { nonce: 'a' })
  s.put('b', { nonce: 'b' })
  s.put('c', { nonce: 'c' })
  eq('未超限时 3 条', s.size(), 3)
  s.put('d', { nonce: 'd' })
  eq('超限后仍为 3 条', s.size(), 3, String(s.size()))
  eq('最早的 a 被淘汰', s.has('a') === false)
  eq('较新的 d 保留', s.has('d') === true)
  eq('b 仍在', s.has('b') === true)
}
{
  // 灌入远超上限的量，内存占用必须被限制住。
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, maxPending: 100, now: c.now })
  for (let i = 0; i < 5000; i++) s.put('x' + i, { nonce: 'n' + i })
  eq('大量写入后不超过上限', s.size() <= 100, String(s.size()))
  eq('最新一条可用', s.take('x4999') !== null, 'expected latest valid')
}

console.log('\n— 6. 写入时顺手回收过期项 —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, maxPending: 10, now: c.now })
  s.put('old1', { nonce: '1' })
  s.put('old2', { nonce: '2' })
  c.advance(TTL + 1)
  s.put('fresh', { nonce: '3' })
  eq('过期项被回收', s.size() === 1, String(s.size()))
  eq('新项在', s.has('fresh') === true)
}

console.log('\n— 7. purge 仅作兜底回收，不影响未过期项 —')
{
  const c = clock()
  const s = makeOidcStateStore({ ttlMs: TTL, now: c.now })
  s.put('keep', { nonce: 'k' })
  s.put('drop', { nonce: 'd' })
  c.advance(TTL + 1)
  s.put('keep2', { nonce: 'k2' }) // 写入时已回收前两条
  eq('purge 后仅剩未过期项', s.size() === 1, String(s.size()))
  s.purge()
  eq('purge 不误删未过期项', s.has('keep2') === true)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
