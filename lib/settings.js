/**
 * 自动检测与自动更新的开关存储。
 *
 * 开关属于当前 profile：写进 profile 目录下的 `dsh-plugin-manager.json`，
 * 与原生插件管理器的 `compatibility.json` 并列。三个字段都是布尔值：
 *
 * - `startupCheck`：DSH 启动后自动检测一次；
 * - `scheduledCheck`：每小时自动检测一次；
 * - `autoUpdate`：检测到更新后直接更新；关闭时只把更新挂成通知，由设置页弹窗提示。
 *
 * 文件不存在时用默认值（全关）；文件读坏、写失败都只记日志，不打断宿主的其它能力。
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 设置文件名；与 package.json、pnpm-lock.yaml 同在 profile 目录。 */
export const SETTINGS_FILE = 'dsh-plugin-manager.json'

export const DEFAULT_SETTINGS = Object.freeze({
  startupCheck: false,
  scheduledCheck: false,
  autoUpdate: false,
})

/** 只认这三个字段，顺序固定，方便比较与序列化。 */
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS)

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把任意值折成一份完整设置：只保留三个布尔字段，缺的与类型不对的用默认值。
 * @param {unknown} value
 * @returns {{ startupCheck: boolean, scheduledCheck: boolean, autoUpdate: boolean }}
 */
export function normalizeSettings(value) {
  const settings = {}
  for (const key of SETTING_KEYS) {
    const candidate = value !== null && typeof value === 'object' ? value[key] : undefined
    settings[key] = typeof candidate === 'boolean' ? candidate : DEFAULT_SETTINGS[key]
  }
  return settings
}

/**
 * 从请求体里挑出本模块认识的布尔字段；出现认识但类型不对的字段时返回 null。
 * @param {unknown} value
 * @returns {Record<string, boolean>|null}
 */
export function settingsPatchOf(value) {
  const patch = {}
  if (value === null || typeof value !== 'object') return patch
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(value, key)) continue
    if (typeof value[key] !== 'boolean') return null
    patch[key] = value[key]
  }
  return patch
}

/**
 * 创建设置存储。`get()` 同步读当前内存值；首次使用前由调用方 `await load()`。
 * @param {object} options
 * @param {string} options.profileDir profile 目录（含 package.json）。
 * @param {{ warn?: Function, info?: Function }} [options.logger]
 * @param {string} [options.file] 设置文件名，测试可换。
 */
export function createSettingsStore(options) {
  const { profileDir, logger, file = SETTINGS_FILE } = options
  const path = typeof profileDir === 'string' && profileDir !== '' ? join(profileDir, file) : null
  let settings = { ...DEFAULT_SETTINGS }
  /** 写次数：读盘期间若已经写过设置，落盘结果比读到的旧值新，不能再被覆盖。 */
  let writes = 0
  /** 读盘期间被改过的字段：这些字段以内存为准，不接受旧文件值。 */
  const writtenWhileLoading = new Set()
  /** 落盘串行队列：并发的两次开关写入按调用顺序落盘，磁盘最终值与内存一致。 */
  let writeQueue = Promise.resolve()
  let persistSequence = 0

  /** 从磁盘读一次；文件不存在时保持默认值。 */
  async function load() {
    if (path === null) return settings
    const startedAt = writes
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn?.(`dsh-plugin-manager: 读取自动更新设置失败，改用默认值：${messageOf(error)}`)
      return settings
    }
    try {
      const loaded = normalizeSettings(JSON.parse(text))
      const merged = { ...settings }
      for (const key of SETTING_KEYS) {
        // 读盘期间写过的字段以内存为准；其余字段接受文件值（即使期间写过别的字段）。
        if (!writtenWhileLoading.has(key)) merged[key] = loaded[key]
      }
      settings = merged
    } catch (error) {
      if (writes === startedAt) logger?.warn?.(`dsh-plugin-manager: 自动更新设置不是合法 JSON，改用默认值：${messageOf(error)}`)
    }
    return settings
  }

  /** 原子写：每次写用自己的临时文件，再按队列顺序改名，避免并发写互相踩。 */
  async function writeAtomic(value, temporary) {
    try {
      if (typeof profileDir === 'string' && profileDir !== '') await mkdir(profileDir, { recursive: true })
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    } catch (error) {
      logger?.warn?.(`dsh-plugin-manager: 写入自动更新设置失败，本次仍按内存值生效：${messageOf(error)}`)
      try {
        await unlink(temporary)
      } catch {
        // 临时文件没写出来或已经被改名，不需要再处理。
      }
    }
  }

  function persist(value) {
    if (path === null) return Promise.resolve()
    persistSequence += 1
    const temporary = `${path}.${persistSequence}.tmp`
    const task = writeQueue.then(() => writeAtomic(value, temporary))
    writeQueue = task.catch(() => undefined)
    return task
  }

  /**
   * 合并一份补丁并落盘；逐个字段只认布尔值，其余忽略。
   * @param {Record<string, boolean>} patch
   */
  async function patch(input) {
    const next = { ...settings }
    if (input !== null && typeof input === 'object') {
      for (const key of SETTING_KEYS) {
        if (typeof input[key] === 'boolean') {
          next[key] = input[key]
          writtenWhileLoading.add(key)
        }
      }
    }
    settings = next
    writes += 1
    await persist(next)
    return settings
  }

  return {
    /** 设置文件路径；没有 profile 目录时为 null。 */
    path,
    /** 当前内存值。 */
    get: () => settings,
    load,
    patch,
  }
}
