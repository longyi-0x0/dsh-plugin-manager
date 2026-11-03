import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createAutoUpdater } from '../lib/auto.js'

const HOUR = 60 * 60 * 1000
const REMOTE = 'b'.repeat(40)

/**
 * 可推进的假时钟：记录 setTimeout/setInterval，推进时按到期顺序执行回调，
 * 并给异步回调留出微任务时间。测试不真的等一小时。
 */
function createClock() {
  let at = 0
  let nextId = 0
  const timeouts = new Map()
  const intervals = new Map()

  const timers = {
    setTimeout(fn, delay = 0) {
      nextId += 1
      timeouts.set(nextId, { fn, at: at + Math.max(0, Number(delay) || 0) })
      return nextId
    },
    clearTimeout(id) {
      timeouts.delete(id)
    },
    setInterval(fn, delay = 1) {
      nextId += 1
      const period = Math.max(1, Number(delay) || 1)
      intervals.set(nextId, { fn, period, at: at + period })
      return nextId
    },
    clearInterval(id) {
      intervals.delete(id)
    },
  }

  async function flush() {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  }

  async function advance(ms) {
    const target = at + ms
    for (;;) {
      let due = null
      for (const [id, timer] of timeouts) {
        if (timer.at <= target && (due === null || timer.at < due.at)) due = { kind: 'timeout', id, at: timer.at }
      }
      for (const [id, timer] of intervals) {
        if (timer.at <= target && (due === null || timer.at < due.at)) due = { kind: 'interval', id, at: timer.at }
      }
      if (due === null) break
      at = due.at
      if (due.kind === 'timeout') {
        const timer = timeouts.get(due.id)
        if (timer === undefined) continue
        timeouts.delete(due.id)
        timer.fn()
      } else {
        const timer = intervals.get(due.id)
        if (timer === undefined) continue
        timer.at = at + timer.period
        timer.fn()
      }
      await flush()
    }
    at = target
  }

  return { timers, now: () => at, advance, flush }
}

function fakeSettings(initial = {}) {
  let current = { startupCheck: false, scheduledCheck: false, autoUpdate: false, ...initial }
  return {
    get: () => ({ ...current }),
    patch: async (patch) => {
      current = { ...current, ...patch }
      return { ...current }
    },
  }
}

function pluginRow(name, overrides = {}) {
  return { name, version: '0.1.0', state: 'update', remoteCommit: REMOTE, self: false, ...overrides }
}

function fakeEngine(rows = [], results = {}) {
  const engine = {
    rows,
    calls: { check: 0, update: [] },
    async check() {
      engine.calls.check += 1
      return { profile: 'desktop', checkedAt: 1, plugins: engine.rows.map((row) => ({ ...row })) }
    },
    async list() {
      return { profile: 'desktop', checkedAt: 1, plugins: engine.rows.map((row) => ({ ...row })) }
    },
    async update(name) {
      engine.calls.update.push(name)
      return results[name] ?? { ok: true, name, version: '0.2.0' }
    },
  }
  return engine
}

function makeAuto({ rows = [], settings = {}, results = {}, clock = createClock(), logger } = {}) {
  const engine = fakeEngine(rows, results)
  const store = fakeSettings(settings)
  const auto = createAutoUpdater({
    engine,
    settings: store,
    now: clock.now,
    timers: clock.timers,
    startupDelayMs: 3,
    logger,
  })
  return { auto, engine, settings: store, clock }
}

test('startupCheck：启动后延迟检测一次，不重复', async () => {
  const { auto, engine, clock } = makeAuto({ settings: { startupCheck: true } })
  auto.start()
  assert.equal(engine.calls.check, 0)

  await clock.advance(2)
  assert.equal(engine.calls.check, 0)

  await clock.advance(1)
  assert.equal(engine.calls.check, 1)
  const state = auto.state()
  assert.equal(state.auto.lastCheckReason, 'startup')
  assert.equal(state.auto.lastCheckAt, 3)
  assert.equal(state.auto.nextCheckAt, null)
  assert.equal(state.notice, null)

  await clock.advance(HOUR * 2)
  assert.equal(engine.calls.check, 1)
})

test('startupCheck 关闭时不自动检测', async () => {
  const { auto, engine, clock } = makeAuto()
  auto.start()
  await clock.advance(HOUR * 2)
  assert.equal(engine.calls.check, 0)
  assert.equal(auto.state().auto.nextCheckAt, null)
})

test('scheduledCheck：每小时检测一次，关闭后停止', async () => {
  const { auto, engine, clock } = makeAuto({ settings: { scheduledCheck: true } })
  auto.start()
  assert.equal(auto.state().auto.nextCheckAt, HOUR)

  await clock.advance(HOUR)
  assert.equal(engine.calls.check, 1)
  assert.equal(auto.state().auto.lastCheckReason, 'hourly')
  assert.equal(auto.state().auto.nextCheckAt, HOUR * 2)

  await clock.advance(HOUR)
  assert.equal(engine.calls.check, 2)

  await auto.updateSettings({ scheduledCheck: false })
  assert.equal(auto.state().auto.nextCheckAt, null)
  await clock.advance(HOUR)
  assert.equal(engine.calls.check, 2)
})

test('stop 清掉计时器，推进时间也不再检测', async () => {
  const { auto, engine, clock } = makeAuto({ settings: { startupCheck: true, scheduledCheck: true } })
  auto.start()
  auto.stop()
  await clock.advance(HOUR * 2)
  assert.equal(engine.calls.check, 0)
  assert.equal(auto.state().auto.nextCheckAt, null)
})

test('自动更新关闭：发现更新挂通知，同一远端 commit 只提示一次', async () => {
  const { auto, engine } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  assert.equal(engine.calls.check, 1)
  assert.deepEqual(engine.calls.update, [])

  let state = auto.state()
  assert.equal(state.notice.kind, 'updates')
  assert.deepEqual(state.notice.items, [{ name: 'acme-plugin', version: '0.1.0', remoteCommit: REMOTE }])
  assert.equal(state.auto.lastResult.updates, 1)
  assert.equal(state.auto.lastResult.updated, 0)
  const firstNoticeId = state.notice.id

  await auto.run('hourly')
  state = auto.state()
  assert.equal(state.notice.id, firstNoticeId, '同一版远端不应再生成一条通知')
  assert.equal(engine.calls.check, 2)

  engine.rows = [pluginRow('acme-plugin', { remoteCommit: 'c'.repeat(40) })]
  await auto.run('hourly')
  state = auto.state()
  assert.notEqual(state.notice.id, firstNoticeId)
  assert.equal(state.notice.items[0].remoteCommit, 'c'.repeat(40))
})

test('自动更新开启：检测到更新直接更新并给结果通知', async () => {
  const { auto, engine, clock } = makeAuto({
    rows: [pluginRow('acme-plugin'), pluginRow('other-plugin')],
    settings: { autoUpdate: true },
  })
  await auto.run('hourly')
  assert.deepEqual(engine.calls.update, ['acme-plugin', 'other-plugin'])

  let state = auto.state()
  assert.equal(state.notice.kind, 'updated')
  assert.equal(state.notice.updated, 2)
  assert.equal(state.notice.failed, 0)
  assert.equal(state.auto.lastResult.updated, 2)
  assert.equal(state.auto.lastResult.updates, 2)

  // 同一版远端已经处理过，下一轮不再重复更新。
  await auto.run('hourly')
  assert.deepEqual(engine.calls.update, ['acme-plugin', 'other-plugin'])
  assert.equal(engine.calls.check, 2)
  assert.equal(auto.state().auto.lastResult.updated, 0)
  await clock.flush()
})

test('自动更新失败：通知里带失败数与人话原因', async () => {
  const warnings = []
  const { auto } = makeAuto({
    rows: [pluginRow('acme-plugin')],
    settings: { autoUpdate: true },
    results: { 'acme-plugin': { ok: false, message: 'pnpm 拒绝安装' } },
    logger: { warn: (text) => warnings.push(text) },
  })
  await auto.run('startup')
  const state = auto.state()
  assert.equal(state.notice.kind, 'failed')
  assert.equal(state.notice.failed, 1)
  assert.equal(state.notice.message, 'pnpm 拒绝安装')
  assert.equal(state.auto.lastResult.failed, 1)
  assert.equal(warnings.some((text) => text.includes('自动更新 acme-plugin 失败')), true)
})

test('自更新排在最后，自更新开始后不再继续后面的项', async () => {
  const { auto, engine } = makeAuto({
    rows: [
      pluginRow('dsh-plugin-manager', { self: true }),
      pluginRow('acme-plugin'),
    ],
    settings: { autoUpdate: true },
    results: { 'dsh-plugin-manager': { ok: true, selfUpdate: true } },
  })
  await auto.run('startup')
  assert.deepEqual(engine.calls.update, ['acme-plugin', 'dsh-plugin-manager'])
  const notice = auto.state().notice
  assert.equal(notice.kind, 'updated')
  assert.match(notice.message, /自更新/, '自更新成功后要提示 DSH 重载后生效')
})

test('检测失败：记进 lastResult，不产生通知', async () => {
  const warnings = []
  const clock = createClock()
  const engine = fakeEngine([])
  engine.check = async () => {
    throw new Error('网络不可用')
  }
  const auto = createAutoUpdater({
    engine,
    settings: fakeSettings(),
    now: clock.now,
    timers: clock.timers,
    logger: { warn: (text) => warnings.push(text) },
  })
  await auto.run('hourly')
  const state = auto.state()
  assert.equal(state.notice, null)
  assert.equal(state.auto.lastResult.error, '网络不可用')
  assert.equal(state.auto.running, false)
  assert.equal(warnings.some((text) => text.includes('自动检测失败')), true)
})

test('applyPending：只更新仍然有更新的项，完成后通知换成结果', async () => {
  const { auto, engine } = makeAuto({ rows: [pluginRow('acme-plugin'), pluginRow('other-plugin')] })
  await auto.run('startup')
  assert.equal(auto.state().notice.kind, 'updates')

  engine.rows = [pluginRow('acme-plugin', { state: 'current' }), pluginRow('other-plugin')]
  const result = await auto.applyPending()
  assert.equal(result.ok, true)
  assert.equal(result.updated, 1)
  assert.deepEqual(engine.calls.update, ['other-plugin'])

  const state = auto.state()
  assert.equal(state.notice.kind, 'updated')
  assert.equal(state.notice.updated, 1)
  assert.equal(state.auto.running, false)
})

test('applyPending：没有待处理通知时返回 no-notice', async () => {
  const { auto } = makeAuto()
  assert.deepEqual(await auto.applyPending(), { ok: false, code: 'no-notice', updated: 0, failed: 0, notice: null })
})

test('applyPending：自动检测进行中时返回 busy，不重复更新', async () => {
  const { auto, engine } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  assert.equal(auto.state().notice.kind, 'updates')

  let releaseCheck = null
  engine.check = () =>
    new Promise((resolve) => {
      releaseCheck = () => resolve({ profile: 'desktop', checkedAt: 1, plugins: [pluginRow('acme-plugin')] })
    })
  const pending = auto.run('hourly')
  const result = await auto.applyPending()
  assert.deepEqual(result, { ok: false, code: 'busy', updated: 0, failed: 0, notice: auto.state().notice })
  assert.deepEqual(engine.calls.update, [])
  releaseCheck()
  await pending
})

test('applyPending：列清单失败时通知里带原因', async () => {
  const { auto, engine } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  engine.list = async () => {
    throw new Error('读不到 profile')
  }
  const result = await auto.applyPending()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'error')
  assert.equal(result.notice.kind, 'failed')
  assert.equal(result.notice.message, '读不到 profile')
})

test('新的更新通知不会丢掉上一轮未处理的条目', async () => {
  const { auto, engine } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  const firstId = auto.state().notice.id

  engine.rows = [pluginRow('acme-plugin'), pluginRow('other-plugin')]
  await auto.run('hourly')
  const notice = auto.state().notice
  assert.notEqual(notice.id, firstId)
  assert.deepEqual(
    notice.items.map((item) => item.name).sort(),
    ['acme-plugin', 'other-plugin'],
    '上一轮还没处理的 acme-plugin 应该继续留在弹窗里',
  )
})

test('关闭启动检测会取消已经排上、还没触发的启动检测', async () => {
  const { auto, engine, clock } = makeAuto({ settings: { startupCheck: true } })
  auto.start()
  await auto.updateSettings({ startupCheck: false })
  await clock.advance(10)
  assert.equal(engine.calls.check, 0)
})

test('dismissNotice：只收掉 id 相同的通知', async () => {
  const { auto } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  const id = auto.state().notice.id

  assert.equal(auto.dismissNotice('别的 id').id, id)
  assert.equal(auto.dismissNotice(id), null)
  assert.equal(auto.state().notice, null)
})

test('updateSettings：打开定时检测立即排上，打开自动更新把挂起的通知做掉', async () => {
  const { auto, engine, clock } = makeAuto({ rows: [pluginRow('acme-plugin')] })
  await auto.run('startup')
  assert.equal(auto.state().notice.kind, 'updates')

  const updated = await auto.updateSettings({ autoUpdate: true, scheduledCheck: true })
  assert.equal(updated.settings.autoUpdate, true)
  assert.equal(updated.auto.nextCheckAt, clock.now() + HOUR)

  await clock.flush()
  assert.deepEqual(engine.calls.update, ['acme-plugin'])
  assert.equal(auto.state().notice.kind, 'updated')
})

test('手动 run 与定时检测不重复并发：run 进行中再触发直接跳过', async () => {
  const clock = createClock()
  const engine = fakeEngine([])
  let resolveCheck = null
  engine.check = () => {
    engine.calls.check += 1
    return new Promise((resolve) => {
      resolveCheck = () => resolve({ profile: 'desktop', checkedAt: 1, plugins: [] })
    })
  }
  const auto = createAutoUpdater({ engine, settings: fakeSettings(), now: clock.now, timers: clock.timers })
  const first = auto.run('startup')
  assert.equal(await auto.run('startup'), null)
  resolveCheck()
  await first
  assert.equal(engine.calls.check, 1)
})
