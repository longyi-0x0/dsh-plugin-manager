/**
 * 浏览器半侧的数据面：挂在宿主已有 webServer 上的一组 JSON 接口。
 *
 * 为什么用 HTTP 而不是 Remote：本插件是纯 JS 包，没有跑装饰器/代码生成那套
 * `@Remote` 命名空间，注册一条前缀路由最简单，也不触碰 core（与 dsh-studio 同一取法）。
 *
 * 安全边界：只接受本机回环 Host 的同源请求；变更类接口只接受 POST 与 JSON 体。
 * 远程访问模式（非回环 Host）下这些接口一律拒绝，插件页会显示不可用。
 */

import { URL } from 'node:url'

import { settingsPatchOf } from './settings.js'

export const PREFIX = '/dsh-plugin-manager/api'

/** 请求体上限：只收一个名字或一张名字表。 */
const BODY_LIMIT = 64 * 1024

function header(headers, key) {
  const value = headers?.[key]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts[0] !== '127') return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 请求是否来自本机浏览器且同源：Host 必须是回环地址，跨站请求与异源 Origin 一律拒绝。
 * @param {{ headers?: Record<string, unknown> }} request Node 的 IncomingMessage。
 * @returns {boolean}
 */
export function isTrustedRequest(request) {
  const authority = header(request?.headers, 'host')
  if (authority === undefined) return false
  const hostUrl = parseAuthority(authority)
  if (hostUrl === undefined || !isLoopbackHostname(hostUrl.hostname)) return false
  if (header(request?.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request?.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 读完一个 JSON 请求体；空体算 `{}`，超限或坏 JSON 抛错。
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
export function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        rejectPromise(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) return resolvePromise({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolvePromise(typeof parsed === 'object' && parsed !== null ? parsed : {})
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'))
      }
    })
    request.on('error', rejectPromise)
  })
}

/** 名字列表只收字符串；其余一律当没有。 */
function namesOf(value) {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((entry) => typeof entry === 'string' && entry !== '')
  return names.length === 0 ? undefined : names
}

/** 自动更新服务缺失时的统一答复：宿主还没装配完或 profile 不可用。 */
function sendUnavailable(response) {
  return sendJson(response, 503, {
    error: { code: 'unavailable', message: '自动更新服务没有就绪' },
  })
}

/**
 * 生成 HTTP handler，便于测试直接调用。
 * @param {ReturnType<import('./engine.js').createEngine>} engine
 * @param {{ logger?: { warn?: Function }, auto?: ReturnType<import('./auto.js').createAutoUpdater> }} [options]
 */
export function createHandler(engine, options = {}) {
  const { logger, auto } = options
  return async function handler(request, response) {
    try {
      if (!isTrustedRequest(request)) return sendJson(response, 403, { error: { code: 'forbidden', message: '只接受本机同源请求' } })
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname
      const method = request.method ?? 'GET'

      if (path === `${PREFIX}/list`) {
        if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        const body = await engine.list()
        if (method === 'HEAD') {
          response.writeHead(200, { 'cache-control': 'no-store' })
          return response.end()
        }
        return sendJson(response, 200, body)
      }

      if (path === `${PREFIX}/state`) {
        if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        if (auto === undefined || auto === null) return sendUnavailable(response)
        if (method === 'HEAD') {
          response.writeHead(200, { 'cache-control': 'no-store' })
          return response.end()
        }
        return sendJson(response, 200, auto.state())
      }

      if (path === `${PREFIX}/settings`) {
        if (method !== 'POST') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        if (auto === undefined || auto === null) return sendUnavailable(response)
        const body = await readJsonBody(request)
        const patch = settingsPatchOf(body)
        if (patch === null) {
          return sendJson(response, 400, { error: { code: 'invalid-settings', message: '自动更新开关只能取布尔值' } })
        }
        return sendJson(response, 200, await auto.updateSettings(patch))
      }

      if (path === `${PREFIX}/notice/dismiss`) {
        if (method !== 'POST') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        if (auto === undefined || auto === null) return sendUnavailable(response)
        const body = await readJsonBody(request)
        if (body.id !== undefined && (typeof body.id !== 'string' || body.id === '')) {
          return sendJson(response, 400, { error: { code: 'invalid-id', message: 'id 必须是非空字符串' } })
        }
        auto.dismissNotice(body.id)
        return sendJson(response, 200, { notice: null })
      }

      if (path === `${PREFIX}/notice/apply`) {
        if (method !== 'POST') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        if (auto === undefined || auto === null) return sendUnavailable(response)
        return sendJson(response, 200, await auto.applyPending())
      }

      if (path === `${PREFIX}/check`) {
        if (method !== 'POST') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        const body = await readJsonBody(request)
        const snapshot = await engine.check(namesOf(body.names))
        return sendJson(response, 200, snapshot)
      }

      if (path === `${PREFIX}/update`) {
        if (method !== 'POST') return sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        const body = await readJsonBody(request)
        if (typeof body.name !== 'string' || body.name === '') {
          return sendJson(response, 400, { error: { code: 'invalid-name', message: 'name 必须是非空字符串' } })
        }
        const result = await engine.update(body.name)
        return sendJson(response, result.ok === true ? 200 : 409, result)
      }

      return sendJson(response, 404, { error: { code: 'not-found', path } })
    } catch (error) {
      logger?.warn?.(`dsh-plugin-manager: 数据接口失败：${String(error?.message ?? error)}`)
      return sendJson(response, 500, { error: { code: 'internal', message: String(error?.message ?? error) } })
    }
  }
}

/**
 * 把接口挂到宿主 webServer 上。
 * @param {{ webServer: { register: Function }, logger?: { warn?: Function } }} ctx
 * @param {ReturnType<import('./engine.js').createEngine>} engine
 * @param {{ auto?: ReturnType<import('./auto.js').createAutoUpdater> }} [options]
 * @returns {() => void} 注销函数。
 */
export function registerRoutes(ctx, engine, options = {}) {
  const handler = createHandler(engine, { logger: ctx.logger, auto: options.auto })
  return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler })
}
