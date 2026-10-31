import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * 浏览器半侧的装载冒烟：用最小的 window 替身接住 __ModuleLoader__.load，
 * 再用假的 ctx 跑一遍 apply，确认四个插槽与登记项都注册上了。
 * 组件本身不渲染（渲染需要 DSH 的 react / 主题环境），只验证接线与地址解析。
 */

let captured

async function loadClientModule() {
  if (captured !== undefined) return captured
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  await import(new URL('../client/index.js', import.meta.url).href)
  assert.ok(captured, '客户端模块没有调用 __ModuleLoader__.load')
  return captured
}

function reactStub() {
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  }
  return {
    createElement: () => null,
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    Component,
  }
}

async function clientModule() {
  const spec = await loadClientModule()
  assert.equal(spec.id, 'dsh-plugin-manager')
  return spec.factory((id) => {
    if (id === 'react') return reactStub()
    throw new Error(`多余的依赖：${id}`)
  })
}

function fakeContext() {
  const registrations = []
  const ctx = {
    slots: {
      inject(name, register) {
        const entry = { name, options: null, component: null }
        registrations.push(entry)
        register()
      },
      register(options, component) {
        const entry = registrations.at(-1)
        entry.options = options
        entry.component = component
        return () => {}
      },
    },
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh' }),
      bind: () => (key) => key,
    },
    effect: (run) => {
      run()
    },
  }
  return { ctx, registrations }
}

test('客户端向插件页的四个插槽各注册一项', async () => {
  const module = await clientModule()
  assert.deepEqual(module.inject, ['slots', 'locale'])

  const { ctx, registrations } = fakeContext()
  module.apply(ctx)

  assert.deepEqual(
    registrations.map((entry) => entry.name),
    ['plugins.tab', 'plugins.detail.badge', 'plugins.detail.actions', 'plugins.detail.section'],
  )
  assert.deepEqual(
    registrations.map((entry) => entry.options.id),
    ['dsh-plugin-manager', 'dsh-plugin-manager-badge', 'dsh-plugin-manager-actions', 'dsh-plugin-manager-section'],
  )
  assert.equal(registrations[0].options.label(), 'GitHub 插件')
  for (const entry of registrations) assert.equal(typeof entry.component, 'function')
})

test('normalizeGithubInput：把常见 GitHub 写法折成 github: spec', async () => {
  const { normalizeGithubInput } = await clientModule()
  const cases = [
    ['owner/repo', 'github:owner/repo'],
    ['owner/repo#main', 'github:owner/repo#main'],
    ['github:owner/repo#v1.2.3', 'github:owner/repo#v1.2.3'],
    ['https://github.com/owner/repo', 'github:owner/repo'],
    ['https://github.com/owner/repo.git', 'github:owner/repo'],
    ['https://github.com/owner/repo/tree/feature/x', 'github:owner/repo#feature/x'],
    ['git+https://github.com/owner/repo.git', 'github:owner/repo'],
    ['https://www.github.com/owner/repo', 'github:owner/repo'],
    ['github.com/owner/repo', 'github:owner/repo'],
    ['github.com/owner/repo/tree/main', 'github:owner/repo#main'],
    ['git@github.com:owner/repo.git', 'github:owner/repo'],
    ['git@github.com:owner/repo.git#v1', 'github:owner/repo#v1'],
  ]
  for (const [input, expected] of cases) {
    const result = normalizeGithubInput(input)
    assert.equal(result.spec, expected, input)
    assert.equal(typeof result.label, 'string')
  }
})

test('normalizeGithubInput：拒绝非 GitHub、坏仓库与坏 ref', async () => {
  const { normalizeGithubInput } = await clientModule()
  assert.equal(normalizeGithubInput('').error, 'installErrorEmpty')
  assert.equal(normalizeGithubInput('   ').error, 'installErrorEmpty')
  assert.equal(normalizeGithubInput('https://gitlab.com/owner/repo').error, 'installErrorGithub')
  assert.equal(normalizeGithubInput('git@gitlab.com:owner/repo.git').error, 'installErrorGithub')
  assert.equal(normalizeGithubInput('github:foo').error, 'installErrorRepo')
  assert.equal(normalizeGithubInput('owner').error, 'installErrorGithub')
  assert.equal(normalizeGithubInput('owner/repo#bad ref').error, 'installErrorRef')
  assert.equal(normalizeGithubInput('https://github.com/owner/repo/blob/main/file').error, 'installErrorGithub')
  assert.equal(normalizeGithubInput('not a repo').error, 'installErrorGithub')
})
