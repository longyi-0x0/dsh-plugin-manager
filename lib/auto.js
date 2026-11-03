/**
 * 自动检测与自动更新。
 *
 * 三个开关的组合语义：
 * - `startupCheck`：DSH 启动后检测一次（延迟一小会儿，让宿主先装配完）；
 * - `scheduledCheck`：每小时检测一次；
 * - `autoUpdate`：检测到新更新后直接更新；关闭时只把更新挂成通知（notice），
 *   由设置页弹窗提示用户，等用户点「立即更新」再走同一条更新路径。
 *
 * 检测与更新都走 engine，因此远端读取、自更新和串行化规则与手动操作一致；
 * 浏览器半侧只通过 `/state` 轮询读取状态，不直接触发这里的定时器。
 *
 * 同一插件的同一版远端只处理一次（`handled`）：既不重复弹窗，也不每小时重试同一个
 * 失败版本。远端出现新 commit 后才会再次处理。
 */

const HOUR_MS = 60 * 60 * 1000
const STARTUP_DELAY_MS = 3000
const MAX_MESSAGE_LENGTH = 300
const SELF_UPDATE_HINT = '自更新已开始；DSH 重载插件后生效'

function messageOf(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text
}

/**
 * 创建自动检测/自动更新调度器。
 * @param {object} options
 * @param {ReturnType<import('./engine.js').createEngine>} options.engine 检查与更新引擎。
 * @param {ReturnType<import('./settings.js').createSettingsStore>} options.settings 开关存储。
 * @param {{ warn?: Function, info?: Function }} [options.logger]
 * @param {() => number} [options.now] 可注入的时钟。
 * @param {number} [options.intervalMs] 定时检测间隔，默认一小时。
 * @param {number} [options.startupDelayMs] 启动检测延迟，默认 3 秒。
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [options.timers] 可注入的计时器，测试用。
 */
export function createAutoUpdater(options) {
  const {
    engine,
    settings,
    logger,
    now = () => Date.now(),
    intervalMs = HOUR_MS,
    startupDelayMs = STARTUP_DELAY_MS,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  } = options

  /** 一次自动检测/自动更新是否在跑；检测与更新本身由 engine 串行，这里只防重复触发。 */
  let running = false
  /** 需要用户看一眼的通知：发现更新（等用户点）/ 自动更新结果。 */
  let notice = null
  let noticeSequence = 0
  let lastCheckAt = null
  /** @type {'startup'|'hourly'|null} */
  let lastCheckReason = null
  /** @type {null|{ at: number, reason: 'startup'|'hourly', updates: number, updated: number, failed: number, error: string|null }} */
  let lastResult = null
  let nextCheckAt = null
  let startupTimer = null
  let hourlyTimer = null
  /** 已经弹过窗或尝试过更新的「插件名 → 远端 commit」。 */
  const handled = new Map()

  function makeNotice(kind, fields = {}) {
    noticeSequence += 1
    return {
      id: String(noticeSequence),
      kind,
      at: now(),
      items: [],
      updated: null,
      failed: null,
      message: null,
      ...fields,
    }
  }

  function remember(rows) {
    for (const row of rows) handled.set(row.name, row.remoteCommit)
  }

  function freshOf(rows) {
    return rows.filter((row) => handled.get(row.name) !== row.remoteCommit)
  }

  function clearTimers() {
    if (startupTimer !== null) {
      timers.clearTimeout(startupTimer)
      startupTimer = null
    }
    if (hourlyTimer !== null) {
      timers.clearInterval(hourlyTimer)
      hourlyTimer = null
    }
    nextCheckAt = null
  }

  /** 按当前 scheduledCheck 重排定时器；关闭时清掉。 */
  function scheduleHourly() {
    if (hourlyTimer !== null) {
      timers.clearInterval(hourlyTimer)
      hourlyTimer = null
    }
    nextCheckAt = null
    if (settings.get().scheduledCheck !== true) return
    nextCheckAt = now() + intervalMs
    hourlyTimer = timers.setInterval(() => {
      nextCheckAt = now() + intervalMs
      void run('hourly')
    }, intervalMs)
  }

  /**
   * 逐个更新一组行：自更新放最后，它一旦开始就可能重载本插件。
   * @param {Array<{ name: string, remoteCommit: string|null, self?: boolean }>} rows
   */
  async function applyRows(rows) {
    const ordered = [...rows].sort((left, right) => Number(left.self === true) - Number(right.self === true))
    let updated = 0
    let failed = 0
    let firstError = null
    let selfUpdate = false
    for (const row of ordered) {
      remember([row])
      let result
      try {
        result = await engine.update(row.name)
      } catch (error) {
        result = { ok: false, message: messageOf(error) }
      }
      if (result?.ok === true) {
        updated += 1
        logger?.info?.(`dsh-plugin-manager: 自动更新 ${row.name} 完成`)
      } else {
        failed += 1
        firstError ??= typeof result?.message === 'string' && result.message !== '' ? result.message : '更新失败'
        logger?.warn?.(`dsh-plugin-manager: 自动更新 ${row.name} 失败：${firstError}`)
      }
      if (result?.selfUpdate === true) {
        selfUpdate = true
        break
      }
    }
    return { updated, failed, firstError, selfUpdate }
  }

  function recordResult(reason, updates, outcome) {
    lastCheckAt = now()
    lastCheckReason = reason
    lastResult = {
      at: lastCheckAt,
      reason,
      updates,
      updated: outcome.updated,
      failed: outcome.failed,
      error: outcome.error ?? null,
    }
  }

  /**
   * 跑一轮自动检测；开启了自动更新就把新发现的更新直接做掉。
   * 同一时刻只跑一轮，重复触发直接跳过。
   * @param {'startup'|'hourly'} reason
   */
  async function run(reason) {
    if (running) return null
    running = true
    let updates = 0
    try {
      const snapshot = await engine.check()
      const rows = Array.isArray(snapshot?.plugins) ? snapshot.plugins : []
      const updatable = rows.filter((row) => row.state === 'update')
      updates = updatable.length

      if (updatable.length > 0) {
        const fresh = freshOf(updatable)
        if (settings.get().autoUpdate === true) {
          if (fresh.length > 0) {
            const outcome = await applyRows(fresh)
            recordResult(reason, updates, outcome)
            if (outcome.failed > 0) {
              notice = makeNotice('failed', {
                updated: outcome.updated,
                failed: outcome.failed,
                message: outcome.firstError,
              })
            } else if (outcome.updated > 0) {
              notice = makeNotice('updated', {
                updated: outcome.updated,
                failed: 0,
                message: outcome.selfUpdate === true ? SELF_UPDATE_HINT : null,
              })
            }
            return lastResult
          }
        } else if (fresh.length > 0) {
          remember(fresh)
          const items = new Map()
          // 上一轮还没处理的更新继续留在弹窗里，避免新通知把旧条目挤掉。
          if (notice !== null && notice.kind === 'updates') {
            for (const item of notice.items) items.set(item.name, item)
          }
          for (const row of fresh) {
            items.set(row.name, {
              name: row.name,
              version: row.version ?? null,
              remoteCommit: row.remoteCommit ?? null,
            })
          }
          notice = makeNotice('updates', { items: [...items.values()] })
        }
      }
      recordResult(reason, updates, { updated: 0, failed: 0 })
      return lastResult
    } catch (error) {
      // 检测失败不弹窗：每小时都弹一次失败的提示比不提示更烦，原因留在 lastResult 里由设置页展示。
      const message = messageOf(error)
      logger?.warn?.(`dsh-plugin-manager: 自动检测失败：${message}`)
      recordResult(reason, 0, { updated: 0, failed: 0, error: message })
      return lastResult
    } finally {
      running = false
    }
  }

  /** 启动：按开关排启动检测与每小时的定时检测。可重复调用，会先清掉旧计时器。 */
  function start() {
    clearTimers()
    if (settings.get().startupCheck === true) {
      startupTimer = timers.setTimeout(() => {
        startupTimer = null
        void run('startup')
      }, startupDelayMs)
    }
    scheduleHourly()
  }

  function stop() {
    clearTimers()
  }

  /**
   * 修改开关：落盘后按新值重排定时器；从关到开启自动更新时，
   * 把已经挂起的「发现更新」通知立刻做掉（不阻塞响应，结果由轮询带上）。
   * @param {Record<string, boolean>} patch
   */
  async function updateSettings(patch) {
    const before = settings.get()
    const next = await settings.patch(patch)
    if (next.scheduledCheck !== before.scheduledCheck) scheduleHourly()
    // 关掉启动检测时，已排上但还没触发的那次也一并取消。
    if (next.startupCheck !== true && startupTimer !== null) {
      timers.clearTimeout(startupTimer)
      startupTimer = null
    }
    if (next.autoUpdate === true && before.autoUpdate !== true && notice !== null && notice.kind === 'updates') {
      void applyPending()
    }
    return state()
  }

  /** 用户点了弹窗里的「立即更新」。 */
  async function applyPending() {
    if (running) return { ok: false, code: 'busy', updated: 0, failed: 0, notice }
    if (notice === null || notice.kind !== 'updates') {
      return { ok: false, code: 'no-notice', updated: 0, failed: 0, notice: null }
    }
    running = true
    try {
      const snapshot = await engine.list()
      const wanted = new Set(notice.items.map((item) => item.name))
      const rows = (Array.isArray(snapshot?.plugins) ? snapshot.plugins : []).filter(
        (row) => row.state === 'update' && wanted.has(row.name),
      )
      if (rows.length === 0) {
        // 已经被别的路径更新掉了，通知直接收掉，不再出一条「更新了 0 个」。
        notice = null
        return { ok: true, updated: 0, failed: 0, notice: null }
      }
      const outcome = await applyRows(rows)
      notice = makeNotice(outcome.failed > 0 ? 'failed' : 'updated', {
        updated: outcome.updated,
        failed: outcome.failed,
        message:
          outcome.failed > 0
            ? outcome.firstError
            : outcome.selfUpdate === true
              ? SELF_UPDATE_HINT
              : null,
      })
      return { ok: outcome.failed === 0, updated: outcome.updated, failed: outcome.failed, notice }
    } catch (error) {
      const message = messageOf(error)
      notice = makeNotice('failed', { message })
      return { ok: false, code: 'error', updated: 0, failed: 0, notice }
    } finally {
      running = false
    }
  }

  /**
   * 收掉通知：带上 id 时只收同一条，避免旧弹窗的「稍后」把新通知误清。
   * @param {unknown} [id]
   */
  function dismissNotice(id) {
    if (notice === null) return null
    if (id !== undefined && id !== null && String(id) !== notice.id) return notice
    notice = null
    return null
  }

  /** 浏览器半侧读的状态快照。 */
  function state() {
    return {
      settings: { ...settings.get() },
      auto: {
        running,
        lastCheckAt,
        lastCheckReason,
        nextCheckAt,
        lastResult: lastResult === null ? null : { ...lastResult },
      },
      notice:
        notice === null
          ? null
          : { ...notice, items: notice.items.map((item) => ({ ...item })) },
    }
  }

  return {
    /** 定时任务入口，`reason` 是 `startup` 或 `hourly`。 */
    run,
    start,
    stop,
    updateSettings,
    applyPending,
    dismissNotice,
    state,
  }
}
