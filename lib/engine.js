/**
 * 检查与更新引擎：把「profile 里从 GitHub 装的插件」整理成一份可比较的清单，
 * 并通过 DSH 自己的 pluginManager 完成更新。
 *
 * 更新方式与插件管理页对官方按需包的处理一致：先 removeBundle，再按 profile 里记录的
 * 原 spec installBundle。DSH 在 HMR 开启时会拒绝安装已存在的同名依赖，所以不能直接重装。
 * 所有写操作串行执行，避免两次点击同时抢 profile 的包锁。
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { parseGithubSpec, resolveRemoteCommit, runGit as defaultRunGit } from './github.js'
import { installedCommit } from './lockfile.js'

/** 检查远端失败时保留在行上的原因，太长会撑破面板。 */
const MAX_ERROR_LENGTH = 300

function messageOf(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text
}

/**
 * 有限并发地跑一组任务：git ls-remote 每个要几百毫秒，串行会把「检查全部」拖到十几秒。
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<void>} task
 */
async function mapLimit(items, limit, task) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await task(items[index], index)
    }
  })
  await Promise.all(workers)
}

/** 把一次管理操作的结果码翻成一句人话。 */
function describeFailure(error) {
  if (error === undefined || error === null) return undefined
  if (typeof error === 'object' && typeof error.code === 'string') {
    if (typeof error.diagnostic === 'string' && error.diagnostic !== '') return error.diagnostic
    return error.code
  }
  return messageOf(error)
}

/**
 * 创建检查/更新引擎。
 * @param {object} options
 * @param {string} options.profileDir profile 目录（含 package.json 与 pnpm-lock.yaml）。
 * @param {{ listBundles: Function, removeBundle: Function, installBundle: Function }} options.manager DSH 的 pluginManager 服务。
 * @param {typeof defaultRunGit} [options.runGit] 可注入的 git 执行器。
 * @param {() => number} [options.now] 可注入的时钟。
 * @param {{ warn?: Function, info?: Function }} [options.logger]
 * @param {number} [options.concurrency] 并发检查数，默认 4。
 * @param {string} [options.selfName] 本插件包名，更新时跳过。
 */
export function createEngine(options) {
  const {
    profileDir,
    manager,
    runGit = defaultRunGit,
    now = () => Date.now(),
    logger,
    concurrency = 4,
    selfName = 'dsh-plugin-manager',
  } = options

  /** 每个插件的远端检查结果：`{ remoteCommit, error, checkedAt }`。只存在内存里，重启后重新检查。 */
  const checks = new Map()
  let lastCheckAt = null
  /** 串行队列：检查与更新互斥，避免两次点击同时改 profile。 */
  let tail = Promise.resolve()

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function serialize(task) {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function readLockText() {
    try {
      return await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
    } catch {
      return ''
    }
  }

  /** 状态判定：没检查过、检查失败、钉死 commit、远端与本地一致、有更新。 */
  function stateOf(parsed, installed, check) {
    if (check === undefined) return installed === null ? 'unknown' : 'unchecked'
    if (check.error !== null) return 'error'
    if (parsed.pinned) return 'pinned'
    if (installed === null) return 'unknown'
    return installed === check.remoteCommit ? 'current' : 'update'
  }

  /** 读当前 profile 里全部 GitHub 来源的插件；不访问网络。 */
  async function computeRows() {
    let bundles
    try {
      bundles = await manager.listBundles()
    } catch (error) {
      logger?.warn?.(`dsh-plugin-manager: 读取插件清单失败：${messageOf(error)}`)
      throw error
    }
    const lockText = await readLockText()
    const rows = []
    for (const bundle of Array.isArray(bundles) ? bundles : []) {
      const name = bundle?.name
      if (typeof name !== 'string') continue
      const parsed = parseGithubSpec(bundle.source)
      if (parsed === null) continue
      const installed = installedCommit(lockText, name)
      const check = checks.get(name)
      rows.push({
        name,
        version: typeof bundle.version === 'string' ? bundle.version : null,
        spec: bundle.source,
        repo: `https://github.com/${parsed.owner}/${parsed.repo}`,
        ref: parsed.ref ?? null,
        pinned: parsed.pinned,
        enabled: bundle.enabled === true,
        removable: bundle.removable !== false,
        self: name === selfName,
        installedCommit: installed,
        remoteCommit: check?.remoteCommit ?? null,
        checkedAt: check?.checkedAt ?? null,
        state: stateOf(parsed, installed, check),
        error: check?.error ?? null,
      })
    }
    rows.sort((left, right) => left.name.localeCompare(right.name))
    return rows
  }

  async function snapshot() {
    return {
      profile: basename(profileDir),
      checkedAt: lastCheckAt,
      plugins: await computeRows(),
    }
  }

  /** 检查一组插件（或全部）的远端 commit，结果写进内存缓存。 */
  async function check(names) {
    return serialize(async () => {
      const rows = await computeRows()
      const wanted = names === undefined ? rows : rows.filter((row) => names.includes(row.name))
      if (wanted.length > 0) {
        await mapLimit(wanted, concurrency, async (row) => {
          const parsed = parseGithubSpec(row.spec)
          try {
            const remote = await resolveRemoteCommit(parsed, runGit)
            checks.set(row.name, { remoteCommit: remote.commit, error: null, checkedAt: now() })
          } catch (error) {
            checks.set(row.name, { remoteCommit: null, error: messageOf(error), checkedAt: now() })
          }
        })
      }
      lastCheckAt = now()
      return snapshot()
    })
  }

  /**
   * 更新一个插件：removeBundle → installBundle（按原 spec）。
   * 卸载成功而安装失败时，插件会留在未安装状态，返回值里写明，用户可从 GitHub 重新安装。
   */
  async function update(name) {
    return serialize(async () => {
      const rows = await computeRows()
      const row = rows.find((candidate) => candidate.name === name)
      if (row === undefined) return { ok: false, code: 'not-found', message: `本 profile 里没有 ${name}` }
      if (row.self) return { ok: false, code: 'self', message: '插件管理器不会更新自己：请用 dsh plugin 命令或插件安装对话框重装它' }
      if (!row.removable) {
        return { ok: false, code: 'not-removable', message: '这个组合包不归 profile 的依赖管理，不能从这里更新' }
      }
      const previous = { version: row.version, commit: row.installedCommit }

      let removed
      try {
        removed = await manager.removeBundle(name)
      } catch (error) {
        return { ok: false, code: 'remove-failed', message: messageOf(error), previous }
      }
      if (removed?.application === 'failed') {
        return { ok: false, code: 'remove-failed', message: describeFailure(removed.error) ?? '卸载失败', previous }
      }

      let installed
      try {
        installed = await manager.installBundle(row.spec, { enabled: row.enabled })
      } catch (error) {
        return {
          ok: false,
          code: 'install-failed',
          message: `${messageOf(error)}（${name} 已经被卸载，需要重新安装）`,
          previous,
        }
      }
      if (installed?.application === 'failed') {
        return {
          ok: false,
          code: 'install-failed',
          message: `${describeFailure(installed.error) ?? '安装失败'}（${name} 已经被卸载，需要重新安装）`,
          previous,
        }
      }

      checks.delete(name)
      // 更新后顺手把本地 commit 与远端对齐，省一次手动检查。
      try {
        const parsed = parseGithubSpec(row.spec)
        const remote = await resolveRemoteCommit(parsed, runGit)
        checks.set(name, { remoteCommit: remote.commit, error: null, checkedAt: now() })
        lastCheckAt = now()
      } catch (error) {
        checks.set(name, { remoteCommit: null, error: messageOf(error), checkedAt: now() })
      }

      const fresh = (await computeRows()).find((candidate) => candidate.name === name) ?? null
      return {
        ok: true,
        name,
        version: installed?.version ?? fresh?.version ?? null,
        previous,
        application: installed?.application ?? null,
        restartRequired: installed?.application === 'restart-required',
        restartReason: installed?.restartReason ?? null,
        plugin: fresh,
      }
    })
  }

  return {
    /** 只读清单（带上次检查结果）。 */
    list: () => serialize(snapshot),
    /** 检查远端。`names` 省略时检查全部。 */
    check,
    /** 更新一个插件。 */
    update,
  }
}
