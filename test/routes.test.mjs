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
