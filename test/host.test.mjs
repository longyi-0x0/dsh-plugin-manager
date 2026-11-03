import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, name as pluginName } from '../index.js'

const LOOPBACK_HOST = '127.0.0.1:5420'

function makeRequest({ method = 'GET', url = '/dsh-plugin-manager/api/state', body } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = { host: LOOPBACK_HOST, 'sec-fetch-site': 'same-origin' }
  request.destroy = () => {}
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)))
    request.emit('end')
  })
  return request
}

function makeResponse() {
  const response = {
    statusCode: null,
    body: '',
    writeHead(status) {
      response.statusCode = status
    },
    end(text) {
      if (text !== undefined) response.body += String(text)
    },
  }
  return response
}

function makeContext(profileDir) {
  const routes = []
  const disposers = []
  const warnings = []
  return {
    routes,
    warnings,
    ctx: {
      profileContext: { dir: profileDir },
      pluginManager: {
        async listBundles() {
          return []
        },
        async removeBundle() {
          throw new Error('测试里不更新插件')
        },
        async installBundle() {
          throw new Error('测试里不安装插件')
        },
      },
      webServer: {
        register(options) {
          routes.push(options)
          return () => {}
        },
      },
      logger: { info: () => {}, warn: (text) => warnings.push(text) },
      effect(run) {
        disposers.push(run())
      },
    },
    dispose() {
      for (const disposer of disposers) if (typeof disposer === 'function') disposer()
    },
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error('等待超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('宿主入口：挂上接口、读设置、排定时检测，改开关会落盘', async () => {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-manager-host-'))
  await writeFile(
    join(profileDir, 'dsh-plugin-manager.json'),
    `${JSON.stringify({ startupCheck: false, scheduledCheck: true, autoUpdate: false })}\n`,
    'utf8',
  )

  const harness = makeContext(profileDir)
  apply(harness.ctx)

  assert.equal(pluginName, 'dsh-plugin-manager')
  assert.equal(harness.routes.length, 1)
  assert.deepEqual(harness.routes[0].path, '/dsh-plugin-manager/api')
  assert.equal(harness.routes[0].kind, 'prefix')
  const handler = harness.routes[0].handler

  // 设置读完之前 nextCheckAt 还是 null；读到 scheduledCheck 开启后定时器才排上。
  await waitFor(() => {
    const response = makeResponse()
    return handler(makeRequest(), response).then(
      () => response.statusCode === 200 && JSON.parse(response.body).auto.nextCheckAt !== null,
    )
  })

  const stateResponse = makeResponse()
  await handler(makeRequest(), stateResponse)
  const state = JSON.parse(stateResponse.body)
  assert.deepEqual(state.settings, { startupCheck: false, scheduledCheck: true, autoUpdate: false })
  assert.equal(typeof state.auto.nextCheckAt, 'number')
  assert.equal(state.notice, null)

  const saved = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/settings', body: { scheduledCheck: false } }), saved)
  assert.equal(saved.statusCode, 200)
  assert.equal(JSON.parse(saved.body).settings.scheduledCheck, false)
  assert.equal(JSON.parse(saved.body).auto.nextCheckAt, null)
  const disk = JSON.parse(await readFile(join(profileDir, 'dsh-plugin-manager.json'), 'utf8'))
  assert.deepEqual(disk, { startupCheck: false, scheduledCheck: false, autoUpdate: false })

  harness.dispose()
  assert.deepEqual(harness.warnings, [])
})

test('宿主入口：没有 profile 目录时不注册接口', () => {
  const harness = makeContext(undefined)
  apply(harness.ctx)
  assert.equal(harness.routes.length, 0)
  assert.equal(harness.warnings.some((text) => text.includes('没有 profile 目录')), true)
})
