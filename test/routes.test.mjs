import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { createHandler, isTrustedRequest } from '../lib/routes.js'

const LOOPBACK_HOST = '127.0.0.1:5420'

function makeRequest({ method = 'GET', url = '/dsh-plugin-manager/api/list', headers = {}, body } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = { host: LOOPBACK_HOST, 'sec-fetch-site': 'same-origin', ...headers }
  request.destroy = () => {}
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    request.emit('end')
  })
  return request
}

function makeResponse() {
  const response = {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      response.statusCode = status
      response.headers = headers
    },
    end(text) {
      if (text !== undefined) response.body += String(text)
    },
  }
  return response
}

function fakeEngine(overrides = {}) {
  const calls = []
  return {
    calls,
    async list() {
      calls.push(['list'])
      return { profile: 'desktop', checkedAt: null, plugins: [] }
    },
    async check(names) {
      calls.push(['check', names])
      return { profile: 'desktop', checkedAt: 1, plugins: [] }
    },
    async update(name) {
      calls.push(['update', name])
      return overrides.updateResult ?? { ok: true, name, application: 'applied', version: '0.2.0' }
    },
  }
}

test('isTrustedRequest：只接受回环 Host 的同源请求', () => {
  assert.equal(isTrustedRequest({ headers: { host: LOOPBACK_HOST } }), true)
  assert.equal(isTrustedRequest({ headers: { host: 'localhost:5420' } }), true)
  assert.equal(isTrustedRequest({ headers: { host: '192.168.1.5:5420' } }), false)
  assert.equal(isTrustedRequest({ headers: { host: LOOPBACK_HOST, 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedRequest({ headers: { host: LOOPBACK_HOST, origin: 'http://evil.example' } }), false)
  assert.equal(isTrustedRequest({ headers: { host: LOOPBACK_HOST, origin: `http://${LOOPBACK_HOST}` } }), true)
  assert.equal(isTrustedRequest({ headers: {} }), false)
})

test('GET /list：回环请求返回清单', async () => {
  const engine = fakeEngine()
  const handler = createHandler(engine)
  const response = makeResponse()
  await handler(makeRequest(), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), { profile: 'desktop', checkedAt: null, plugins: [] })
  assert.deepEqual(engine.calls, [['list']])
})

test('非回环 Host 一律 403', async () => {
  const handler = createHandler(fakeEngine())
  const response = makeResponse()
  await handler(makeRequest({ headers: { host: '10.0.0.8:5420' } }), response)
  assert.equal(response.statusCode, 403)
})

test('POST /check：可以把 names 限定到单个插件', async () => {
  const engine = fakeEngine()
  const handler = createHandler(engine)
  const response = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/check', body: { names: ['acme-plugin'] } }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(engine.calls, [['check', ['acme-plugin']]])
})

test('POST /check：不传 names 时检查全部', async () => {
  const engine = fakeEngine()
  const handler = createHandler(engine)
  const response = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/check', body: {} }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(engine.calls, [['check', undefined]])
})

test('POST /update：成功 200，失败 409，缺名字 400', async () => {
  const handler = createHandler(fakeEngine())
  const good = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/update', body: { name: 'acme-plugin' } }), good)
  assert.equal(good.statusCode, 200)
  assert.equal(JSON.parse(good.body).ok, true)

  const failing = createHandler(fakeEngine({ updateResult: { ok: false, code: 'install-failed', message: '坏了' } }))
  const bad = makeResponse()
  await failing(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/update', body: { name: 'acme-plugin' } }), bad)
  assert.equal(bad.statusCode, 409)
  assert.equal(JSON.parse(bad.body).code, 'install-failed')

  const missing = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/update', body: {} }), missing)
  assert.equal(missing.statusCode, 400)
})

test('方法与路径不对：405 / 404', async () => {
  const handler = createHandler(fakeEngine())
  const wrongMethod = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/list' }), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)

  const unknown = makeResponse()
  await handler(makeRequest({ url: '/dsh-plugin-manager/api/nope' }), unknown)
  assert.equal(unknown.statusCode, 404)
})

test('引擎抛错时 500 且带 message', async () => {
  const handler = createHandler({
    async list() {
      throw new Error('读不到 profile')
    },
    async check() {},
    async update() {},
  })
  const response = makeResponse()
  await handler(makeRequest(), response)
  assert.equal(response.statusCode, 500)
  assert.match(JSON.parse(response.body).error.message, /读不到 profile/)
})

function fakeAuto(state) {
  const calls = { settings: [], dismiss: [], apply: 0 }
  return {
    calls,
    state() {
      calls.state = (calls.state ?? 0) + 1
      return state
    },
    async updateSettings(patch) {
      calls.settings.push(patch)
      return { ...state, settings: { ...state.settings, ...patch } }
    },
    dismissNotice(id) {
      calls.dismiss.push(id)
      return null
    },
    async applyPending() {
      calls.apply += 1
      return { ok: true, updated: 1, failed: 0, notice: null }
    },
  }
}

const AUTO_STATE = {
  settings: { startupCheck: false, scheduledCheck: false, autoUpdate: false },
  auto: { running: false, lastCheckAt: null, lastCheckReason: null, nextCheckAt: null, lastResult: null },
  notice: null,
}

test('GET /state：返回开关、自动检测状态与通知', async () => {
  const auto = fakeAuto(AUTO_STATE)
  const handler = createHandler(fakeEngine(), { auto })
  const response = makeResponse()
  await handler(makeRequest({ url: '/dsh-plugin-manager/api/state' }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), AUTO_STATE)

  const head = makeResponse()
  await handler(makeRequest({ method: 'HEAD', url: '/dsh-plugin-manager/api/state' }), head)
  assert.equal(head.statusCode, 200)
  assert.equal(head.body, '')
})

test('POST /settings：只把布尔开关交给自动更新服务', async () => {
  const auto = fakeAuto(AUTO_STATE)
  const handler = createHandler(fakeEngine(), { auto })

  const ok = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/settings', body: { autoUpdate: true } }), ok)
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(auto.calls.settings, [{ autoUpdate: true }])
  assert.equal(JSON.parse(ok.body).settings.autoUpdate, true)

  const empty = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/settings', body: {} }), empty)
  assert.deepEqual(auto.calls.settings.at(-1), {})

  const invalid = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/settings', body: { autoUpdate: 'on' } }), invalid)
  assert.equal(invalid.statusCode, 400)
  assert.equal(auto.calls.settings.length, 2)
})

test('POST /notice/dismiss 与 /notice/apply：转给自动更新服务', async () => {
  const auto = fakeAuto(AUTO_STATE)
  const handler = createHandler(fakeEngine(), { auto })

  const dismissed = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/notice/dismiss', body: { id: '7' } }), dismissed)
  assert.equal(dismissed.statusCode, 200)
  assert.deepEqual(JSON.parse(dismissed.body), { notice: null })
  assert.deepEqual(auto.calls.dismiss, ['7'])

  const withoutId = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/notice/dismiss', body: {} }), withoutId)
  assert.equal(withoutId.statusCode, 200)
  assert.deepEqual(auto.calls.dismiss, ['7', undefined])

  const invalid = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/notice/dismiss', body: { id: 7 } }), invalid)
  assert.equal(invalid.statusCode, 400)
  assert.equal(JSON.parse(invalid.body).error.code, 'invalid-id')
  assert.deepEqual(auto.calls.dismiss, ['7', undefined])

  const applied = makeResponse()
  await handler(makeRequest({ method: 'POST', url: '/dsh-plugin-manager/api/notice/apply' }), applied)
  assert.equal(applied.statusCode, 200)
  assert.deepEqual(JSON.parse(applied.body), { ok: true, updated: 1, failed: 0, notice: null })
  assert.equal(auto.calls.apply, 1)
})

test('自动更新服务缺失时 503，方法不对时 405', async () => {
  const handler = createHandler(fakeEngine())
  for (const [method, url] of [
    ['GET', '/dsh-plugin-manager/api/state'],
    ['POST', '/dsh-plugin-manager/api/settings'],
    ['POST', '/dsh-plugin-manager/api/notice/dismiss'],
    ['POST', '/dsh-plugin-manager/api/notice/apply'],
  ]) {
    const response = makeResponse()
    await handler(makeRequest({ method, url }), response)
    assert.equal(response.statusCode, 503, `${method} ${url}`)
  }

  const withAuto = createHandler(fakeEngine(), { auto: fakeAuto(AUTO_STATE) })
  for (const [method, url] of [
    ['POST', '/dsh-plugin-manager/api/state'],
    ['GET', '/dsh-plugin-manager/api/settings'],
    ['GET', '/dsh-plugin-manager/api/notice/dismiss'],
    ['GET', '/dsh-plugin-manager/api/notice/apply'],
  ]) {
    const response = makeResponse()
    await withAuto(makeRequest({ method, url }), response)
    assert.equal(response.statusCode, 405, `${method} ${url}`)
  }
})
