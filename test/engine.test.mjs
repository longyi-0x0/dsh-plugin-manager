import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createEngine } from '../lib/engine.js'

const INSTALLED = 'a'.repeat(40)
const REMOTE = 'b'.repeat(40)

function lockFor(name, sha) {
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      ${name}:
        specifier: github:owner/repo
        version: https://codeload.github.com/owner/repo/tar.gz/${sha}

packages:
`
}

async function makeProfile(lockText) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-manager-engine-'))
  await writeFile(join(dir, 'pnpm-lock.yaml'), lockText, 'utf8')
  return dir
}

function bundle(overrides = {}) {
  return {
    name: 'acme-plugin',
    version: '0.1.0',
    source: 'github:owner/repo',
    enabled: true,
    removable: true,
    installed: true,
    ...overrides,
  }
}

function fakeManager(bundles, results = {}) {
  const calls = []
  return {
    calls,
    async listBundles() {
      return bundles
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      if (results.removeThrows !== undefined) throw results.removeThrows
      return results.remove ?? { application: 'applied' }
    },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      if (results.installThrows !== undefined) throw results.installThrows
      return results.install ?? { application: 'applied', version: '0.2.0' }
    },
  }
}

const gitTo = (sha) => async () => ({ code: 0, stdout: `${sha}\tHEAD\n`, stderr: '' })

test('list：只列 GitHub 来源，本地 commit 取自锁文件', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  const manager = fakeManager([
    bundle(),
    bundle({ name: 'npm-plugin', source: '^1.2.3' }),
    bundle({ name: 'local-plugin', source: 'link:C:/work/local' }),
  ])
  const engine = createEngine({ profileDir: dir, manager })
  const snapshot = await engine.list()
  assert.equal(snapshot.profile.startsWith('dsh-plugin-manager-engine-'), true)
  assert.equal(snapshot.checkedAt, null)
  assert.equal(snapshot.plugins.length, 1)
  assert.equal(snapshot.plugins[0].name, 'acme-plugin')
  assert.equal(snapshot.plugins[0].installedCommit, INSTALLED)
  assert.equal(snapshot.plugins[0].state, 'unchecked')
  assert.equal(snapshot.plugins[0].repo, 'https://github.com/owner/repo')
})

test('check：远端有差异 → update；一致 → current；失败 → error', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  const manager = fakeManager([bundle()])
  let remote = REMOTE
  const engine = createEngine({
    profileDir: dir,
    manager,
    runGit: async () => ({ code: 0, stdout: `${remote}\tHEAD\n`, stderr: '' }),
  })

  let snapshot = await engine.check()
  assert.equal(snapshot.plugins[0].state, 'update')
  assert.equal(snapshot.plugins[0].remoteCommit, REMOTE)
  assert.equal(typeof snapshot.checkedAt, 'number')

  remote = INSTALLED
  snapshot = await engine.check()
  assert.equal(snapshot.plugins[0].state, 'current')

  const failing = createEngine({
    profileDir: dir,
    manager,
    runGit: async () => ({ code: 128, stdout: '', stderr: 'fatal: unreachable\n' }),
  })
  snapshot = await failing.check()
  assert.equal(snapshot.plugins[0].state, 'error')
  assert.match(snapshot.plugins[0].error, /读远端失败/)
})

test('check：钉死 commit 的 spec 不访问远端，状态是 pinned', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  let asked = 0
  const manager = fakeManager([bundle({ source: `github:owner/repo#${INSTALLED}` })])
  const engine = createEngine({
    profileDir: dir,
    manager,
    runGit: async () => {
      asked += 1
      return { code: 0, stdout: `${INSTALLED}\tHEAD\n`, stderr: '' }
    },
  })
  const snapshot = await engine.check()
  assert.equal(asked, 0)
  assert.equal(snapshot.plugins[0].state, 'pinned')
})

test('update：先 removeBundle，再按原 spec 和原启用状态 installBundle', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  const manager = fakeManager([bundle({ enabled: false })])
  const engine = createEngine({ profileDir: dir, manager, runGit: gitTo(REMOTE) })

  const result = await engine.update('acme-plugin')
  assert.equal(result.ok, true)
  assert.deepEqual(manager.calls, [
    ['remove', 'acme-plugin'],
    ['install', 'github:owner/repo', { enabled: false }],
  ])
  assert.equal(result.previous.commit, INSTALLED)
  assert.equal(result.version, '0.2.0')
  assert.equal(result.restartRequired, false)
})

test('update：更新自己、不可移除、找不到时不碰 manager', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  const manager = fakeManager([bundle(), bundle({ name: 'dsh-plugin-manager', source: 'github:owner/updater' })])
  const engine = createEngine({ profileDir: dir, manager, runGit: gitTo(REMOTE) })

  const self = await engine.update('dsh-plugin-manager')
  assert.equal(self.ok, false)
  assert.equal(self.code, 'self')

  const notRemovable = createEngine({ profileDir: dir, manager: fakeManager([bundle({ removable: false })]), runGit: gitTo(REMOTE) })
  const blocked = await notRemovable.update('acme-plugin')
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'not-removable')

  const missing = await engine.update('nope')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'not-found')
  assert.deepEqual(manager.calls, [])
})

test('update：卸载成功而安装失败时把状态说清楚', async () => {
  const dir = await makeProfile(lockFor('acme-plugin', INSTALLED))
  const manager = fakeManager([bundle()], { installThrows: new Error('pnpm 拒绝安装') })
  const engine = createEngine({ profileDir: dir, manager, runGit: gitTo(REMOTE) })
  const result = await engine.update('acme-plugin')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'install-failed')
  assert.match(result.message, /已经被卸载/)
})

test('update：两次并发点击被串行化，不交叉', async () => {
  const dir = await makeProfile(`lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      acme-plugin:
        specifier: github:owner/repo
        version: https://codeload.github.com/owner/repo/tar.gz/${INSTALLED}
      other-plugin:
        specifier: github:owner/other
        version: https://codeload.github.com/owner/other/tar.gz/${INSTALLED}

packages:
`)
  const order = []
  const manager = {
    async listBundles() {
      return [bundle(), bundle({ name: 'other-plugin', source: 'github:owner/other' })]
    },
    async removeBundle(name) {
      order.push(`remove:${name}:start`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
      order.push(`remove:${name}:end`)
      return { application: 'applied' }
    },
    async installBundle(spec) {
      order.push(`install:${spec}:start`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
      order.push(`install:${spec}:end`)
      return { application: 'applied', version: '0.2.0' }
    },
  }
  const engine = createEngine({ profileDir: dir, manager, runGit: gitTo(REMOTE) })
  await Promise.all([engine.update('acme-plugin'), engine.update('other-plugin')])
  assert.deepEqual(order, [
    'remove:acme-plugin:start',
    'remove:acme-plugin:end',
    'install:github:owner/repo:start',
    'install:github:owner/repo:end',
    'remove:other-plugin:start',
    'remove:other-plugin:end',
    'install:github:owner/other:start',
    'install:github:owner/other:end',
  ])
})
