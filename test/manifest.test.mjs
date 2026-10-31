import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)

test('bundle patch 不能复用基础包的 plugin-manager 行 id', async () => {
  const [patch, pkg] = await Promise.all([readFile(patchUrl, 'utf8'), readFile(packageUrl, 'utf8').then(JSON.parse)])
  const ids = [...patch.matchAll(/^\s*- id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  const names = [...patch.matchAll(/^\s*name:\s*'?([^'\n]+)'?\s*$/gm)].map((match) => match[1].trim())

  assert.deepEqual(ids, ['dsh-plugin-manager'])
  assert.equal(ids.includes('plugin-manager'), false, 'plugin-manager 是基础包的 profile 管理服务行 id，复用会把它顶掉')
  assert.deepEqual(names, [pkg.name])
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
})
