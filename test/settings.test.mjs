import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createSettingsStore, DEFAULT_SETTINGS, normalizeSettings, settingsPatchOf } from '../lib/settings.js'

async function makeProfile() {
  return mkdtemp(join(tmpdir(), 'dsh-plugin-manager-settings-'))
}

function collectingLogger() {
  const warnings = []
  return { warnings, warn: (text) => warnings.push(text) }
}

test('没有设置文件时读默认值（全关）', async () => {
  const dir = await makeProfile()
  const store = createSettingsStore({ profileDir: dir })
  assert.deepEqual(store.get(), DEFAULT_SETTINGS)
  const settings = await store.load()
  assert.deepEqual(settings, DEFAULT_SETTINGS)
  assert.equal(store.path, join(dir, 'dsh-plugin-manager.json'))
})

test('patch 只认布尔字段并落盘，重新读取能拿回来', async () => {
  const dir = await makeProfile()
  const logger = collectingLogger()
  const store = createSettingsStore({ profileDir: dir, logger })

  await store.patch({ startupCheck: true, junk: 'x', autoUpdate: 'yes' })
  assert.deepEqual(store.get(), { startupCheck: true, scheduledCheck: false, autoUpdate: false })
  const text = await readFile(join(dir, 'dsh-plugin-manager.json'), 'utf8')
  assert.deepEqual(JSON.parse(text), { startupCheck: true, scheduledCheck: false, autoUpdate: false })
  assert.deepEqual(logger.warnings, [])

  const reloaded = createSettingsStore({ profileDir: dir })
  assert.deepEqual(await reloaded.load(), { startupCheck: true, scheduledCheck: false, autoUpdate: false })
  assert.deepEqual(await reloaded.patch({ scheduledCheck: true }), {
    startupCheck: true,
    scheduledCheck: true,
    autoUpdate: false,
  })
})

test('文件不是合法 JSON 时记日志并回到默认值', async () => {
  const dir = await makeProfile()
  await writeFile(join(dir, 'dsh-plugin-manager.json'), '{坏掉的', 'utf8')
  const logger = collectingLogger()
  const store = createSettingsStore({ profileDir: dir, logger })
  assert.deepEqual(await store.load(), DEFAULT_SETTINGS)
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /不是合法 JSON/)
})

test('写盘失败只记日志，内存值仍然生效', async () => {
  const file = await mkdtemp(join(tmpdir(), 'dsh-plugin-manager-settings-file-'))
  const logger = collectingLogger()
  // 用一个普通文件当 profile 目录：目录创建会失败，设置不应把宿主拖垮。
  const brokenProfile = join(file, 'not-a-directory')
  await writeFile(brokenProfile, 'x', 'utf8')
  const store = createSettingsStore({ profileDir: brokenProfile, logger })
  assert.deepEqual(await store.patch({ autoUpdate: true }), {
    startupCheck: false,
    scheduledCheck: false,
    autoUpdate: true,
  })
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /写入自动更新设置失败/)
})

test('normalizeSettings：缺字段或类型不对时用默认值', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ startupCheck: true }), {
    startupCheck: true,
    scheduledCheck: false,
    autoUpdate: false,
  })
  assert.deepEqual(normalizeSettings({ autoUpdate: 1 }), DEFAULT_SETTINGS)
})

test('settingsPatchOf：只挑认识的布尔字段，类型不对返回 null', () => {
  assert.deepEqual(settingsPatchOf({ startupCheck: true, other: true }), { startupCheck: true })
  assert.deepEqual(settingsPatchOf({}), {})
  assert.deepEqual(settingsPatchOf(null), {})
  assert.equal(settingsPatchOf({ autoUpdate: 'on' }), null)
  assert.equal(settingsPatchOf({ scheduledCheck: 0 }), null)
})

test('并发 patch：磁盘最终值与内存一致，且不残留临时文件', async () => {
  const dir = await makeProfile()
  const store = createSettingsStore({ profileDir: dir })
  await store.load()
  const patches = Array.from({ length: 40 }, (_, index) =>
    index % 2 === 0 ? { startupCheck: index % 4 === 0 } : { autoUpdate: index % 3 === 0 },
  )
  await Promise.all(patches.map((patch) => store.patch(patch)))
  const disk = JSON.parse(await readFile(join(dir, 'dsh-plugin-manager.json'), 'utf8'))
  assert.deepEqual(disk, store.get())
  const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
})

test('读盘晚于写入时不会被旧文件内容覆盖，未改动的字段仍取文件值', async () => {
  const dir = await makeProfile()
  await writeFile(
    join(dir, 'dsh-plugin-manager.json'),
    JSON.stringify({ startupCheck: true, scheduledCheck: false, autoUpdate: false }),
    'utf8',
  )
  const store = createSettingsStore({ profileDir: dir })
  const loading = store.load()
  await store.patch({ autoUpdate: true })
  await loading
  assert.equal(store.get().autoUpdate, true)
  assert.equal(store.get().startupCheck, true)
})
