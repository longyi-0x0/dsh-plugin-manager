import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installedCommit, shaOfValue } from '../lib/lockfile.js'

const SHA = 'aca9f658bf8799e6038bb96e69862b28a91fa564'

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      dsh-pet:
        specifier: ^0.3.8
        version: 0.3.8(undici@7.30.1)
      dsh-plugin-updater:
        specifier: github:owner/repo
        version: https://codeload.github.com/owner/repo/tar.gz/${SHA}
      '@local/workspace-sidebar':
        specifier: link:C:/work/sidebar
        version: link:../../work/sidebar
    devDependencies:
      dev-git:
        specifier: git+https://github.com/owner/dev.git
        version: git+https://github.com/owner/dev.git#${'b'.repeat(40)}

packages:

  dsh-plugin-updater@https://codeload.github.com/owner/repo/tar.gz/${SHA}:
    resolution: {tarball: 'https://codeload.github.com/owner/repo/tar.gz/${SHA}'}
`

test('shaOfValue：从 codeload / git 地址里取 commit', () => {
  assert.equal(shaOfValue(`https://codeload.github.com/o/r/tar.gz/${SHA}`), SHA)
  assert.equal(shaOfValue(`git+https://github.com/o/r.git#${SHA}`), SHA)
  assert.equal(shaOfValue('0.3.8(undici@7.30.1)'), null)
  assert.equal(shaOfValue('link:../../work/sidebar'), null)
})

test('installedCommit：读根 importer 的 GitHub 依赖与外链名', () => {
  assert.equal(installedCommit(LOCK, 'dsh-plugin-updater'), SHA)
  assert.equal(installedCommit(LOCK, '@local/workspace-sidebar'), null)
  assert.equal(installedCommit(LOCK, 'dsh-pet'), null)
  assert.equal(installedCommit(LOCK, 'dev-git'), 'b'.repeat(40))
  assert.equal(installedCommit(LOCK, 'missing'), null)
})

test('installedCommit：空文本与空名字不炸', () => {
  assert.equal(installedCommit('', 'x'), null)
  assert.equal(installedCommit(LOCK, ''), null)
  assert.equal(installedCommit(undefined, 'x'), null)
})

test('installedCommit：importer 键是相对路径时照样能读（profiles 设了 packages: [.] ）', () => {
  const lock = `lockfileVersion: '9.0'

importers:

  ../../profiles/desktop:
    dependencies:
      acme-plugin:
        specifier: github:owner/repo
        version: https://codeload.github.com/owner/repo/tar.gz/${SHA}

packages:
`
  assert.equal(installedCommit(lock, 'acme-plugin'), SHA)
})
