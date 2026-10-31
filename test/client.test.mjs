import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * 浏览器半侧的装载冒烟：用最小的 window 替身接住 __ModuleLoader__.load，
 * 再用假的 ctx 跑一遍 apply，确认设置页一节与详情贡献都注册上了。
 * 组件本身不渲染（渲染需要 DSH 的 react / 主题环境），只验证接线。
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

test('客户端注册设置页一节与详情贡献，不注册页签/菜单/弹层', async () => {
  const module = await clientModule()
  assert.deepEqual(module.inject, ['slots', 'locale'])

  const { ctx, registrations } = fakeContext()
  module.apply(ctx)

  assert.deepEqual(
    registrations.map((entry) => entry.name),
    ['settings.section', 'plugins.detail.badge', 'plugins.detail.actions', 'plugins.detail.section'],
  )
  assert.deepEqual(
    registrations.map((entry) => entry.options.id),
    [
      'dsh-plugin-manager-settings',
      'dsh-plugin-manager-badge',
      'dsh-plugin-manager-actions',
      'dsh-plugin-manager-section',
    ],
  )
  assert.equal(registrations[0].options.label(), '插件管理器')
  for (const forbidden of ['plugins.tab', 'plugins.add.actions', 'shell.overlay']) {
    assert.equal(registrations.some((entry) => entry.name === forbidden), false, `不应再注册 ${forbidden}`)
  }
  for (const entry of registrations) assert.equal(typeof entry.component, 'function')
})
