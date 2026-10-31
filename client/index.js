/**
 * dsh-plugin-manager 的浏览器半侧。
 *
 * 挂在 DSH 自带插件页的插槽上：
 *   - `plugins.tab`              —— 「更新」标签页：本 profile 里 GitHub 来源插件的清单与按钮；
 *   - `plugins.detail.badge`     —— 组合包详情页标题旁的「有更新」标签；
 *   - `plugins.detail.actions`   —— 详情页页头的「检查 / 更新」按钮；
 *   - `plugins.detail.section`   —— 详情页下方的来源与 commit 明细。
 *
 * 数据只走宿主挂的同源路由 `/dsh-plugin-manager/api`；文案走 ctx.locale；
 * 颜色只使用 --dsw-alias-* 主题变量，不引样式文件（纯 JS 包，无构建步骤）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const API = '/dsh-plugin-manager/api'
    const NS = 'dshPluginManager'

    // ── 文案 ────────────────────────────────────────────────────────────────

    const DICTS = {
      zh: {
        tab: '更新',
        subtitle: '本 profile 从 GitHub 安装的插件 {count} 个，{updates} 个有更新',
        checkAll: '检查全部',
        checking: '检查中…',
        refresh: '刷新',
        loading: '读取中…',
        empty: '本 profile 里没有从 GitHub 安装的插件。',
        hint: '检查只读远端，不改任何文件；更新会按 profile 里记录的原 spec 卸载重装，失败会留在未安装状态，可再点一次重试。',
        commitLine: '本地 {installed} → 远端 {remote}',
        stateUnchecked: '未检查',
        stateCurrent: '已是最新',
        stateUpdate: '有更新',
        statePinned: '钉住 commit',
        stateUnknown: '无法比对',
        stateError: '检查失败',
        update: '更新',
        updating: '更新中…',
        checkOne: '检查',
        selfManaged: '不更新自己',
        noteUpdated: '已重装完成',
        noteRestart: '已重装，重启 DSH 后生效',
        badgeUpdate: '有更新',
        badgeError: '检查失败',
        sectionTitle: 'GitHub 更新',
        source: '来源',
        installed: '本地 commit',
        remote: '远端 commit',
        lastChecked: '最近检查',
        never: '未检查',
        openBundle: '打开组合包详情',
        componentError: '插件管理器面板渲染失败',
      },
      en: {
        tab: 'Updates',
        subtitle: '{count} plugin(s) installed from GitHub in this profile, {updates} with updates',
        checkAll: 'Check all',
        checking: 'Checking…',
        refresh: 'Refresh',
        loading: 'Loading…',
        empty: 'No plugins installed from GitHub in this profile.',
        hint: 'Checking only reads the remote and writes nothing. Updating uninstalls and reinstalls the recorded spec; a failed install leaves the plugin uninstalled, and clicking update again retries.',
        commitLine: '{installed} → {remote}',
        stateUnchecked: 'Not checked',
        stateCurrent: 'Up to date',
        stateUpdate: 'Update available',
        statePinned: 'Pinned commit',
        stateUnknown: 'Not comparable',
        stateError: 'Check failed',
        update: 'Update',
        updating: 'Updating…',
        checkOne: 'Check',
        selfManaged: 'Not self-updated',
        noteUpdated: 'Reinstalled',
        noteRestart: 'Reinstalled; restart DSH to apply',
        badgeUpdate: 'Update available',
        badgeError: 'Check failed',
        sectionTitle: 'GitHub updates',
        source: 'Source',
        installed: 'Installed commit',
        remote: 'Remote commit',
        lastChecked: 'Last checked',
        never: 'Not checked',
        openBundle: 'Open bundle details',
        componentError: 'The updater panel failed to render',
      },
    }

    function interpolate(template, vars) {
      if (typeof template !== 'string') return ''
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match))
    }

    function shortSha(sha) {
      return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : '—'
    }

    async function requestJson(path, init) {
      const response = await fetch(API + path, {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const message = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`
        const error = new Error(message)
        error.payload = data
        throw error
      }
      return data
    }

    // ── 状态仓库 ────────────────────────────────────────────────────────────

    function createStore(t) {
      const listeners = new Set()
      let state = {
        loaded: false,
        loading: false,
        checking: false,
        plugins: [],
        profile: null,
        checkedAt: null,
        error: null,
        busy: {},
        notes: {},
      }
      let loadPromise = null

      const snapshot = () => state
      const subscribe = (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
      const patch = (next) => {
        state = { ...state, ...next }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[plugin-manager] listener failed', error)
          }
        }
      }

      function adopt(data) {
        patch({
          loaded: true,
          loading: false,
          profile: typeof data?.profile === 'string' ? data.profile : state.profile,
          checkedAt: typeof data?.checkedAt === 'number' ? data.checkedAt : null,
          plugins: Array.isArray(data?.plugins) ? data.plugins : [],
          error: null,
        })
      }

      async function load(force = false) {
        if (loadPromise !== null && force !== true) return loadPromise
        loadPromise = (async () => {
          patch({ loading: true, error: null })
          try {
            adopt(await requestJson('/list'))
          } catch (error) {
            patch({ loading: false, error: error?.message ?? String(error) })
          } finally {
            loadPromise = null
          }
        })()
        return loadPromise
      }

      async function check(names) {
        patch({ checking: true, error: null })
        try {
          const body = names === undefined ? {} : { names }
          adopt(await requestJson('/check', { method: 'POST', body: JSON.stringify(body) }))
        } catch (error) {
          patch({ checking: false, error: error?.message ?? String(error) })
        }
      }

      async function update(name) {
        if (state.busy[name] === true) return
        patch({ busy: { ...state.busy, [name]: true }, notes: { ...state.notes, [name]: null } })
        try {
          const data = await requestJson('/update', { method: 'POST', body: JSON.stringify({ name }) })
          patch({ notes: { ...state.notes, [name]: data?.restartRequired === true ? t('noteRestart') : t('noteUpdated') } })
          await load(true)
        } catch (error) {
          patch({ notes: { ...state.notes, [name]: error?.message ?? String(error) } })
        } finally {
          patch({ busy: { ...state.busy, [name]: false } })
        }
      }

      function ensureLoaded() {
        if (state.loaded === false && loadPromise === null) void load()
      }

      return { subscribe, snapshot, load, check, update, ensureLoaded }
    }

    function useStore(store) {
      const [state, setState] = useState(store.snapshot())
      useEffect(() => store.subscribe(() => setState(store.snapshot())), [store])
      return state
    }

    function useEnsureLoaded(store) {
      useEffect(() => {
        store.ensureLoaded()
      }, [store])
    }

    // ── 样式（只用主题变量，跟 DSH 自带页面同一套）────────────────────────────

    function makeStyles() {
      const button = {
        border: '1px solid var(--dsw-alias-border-l)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 8,
        padding: '4px 10px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
      }
      return {
        wrap: {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '16px 4px 8px',
          font: '13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
          color: 'var(--dsw-alias-label-primary)',
        },
        head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
        title: { margin: 0, fontSize: 14, fontWeight: 600 },
        sub: { margin: '4px 0 0', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
        actionsRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
        button,
        buttonPrimary: { ...button, borderColor: 'transparent', background: 'var(--dsw-alias-brand-primary)', color: '#ffffff' },
        buttonSmall: { ...button, padding: '2px 8px' },
        buttonPrimarySmall: { ...button, padding: '2px 8px', borderColor: 'transparent', background: 'var(--dsw-alias-brand-primary)', color: '#ffffff' },
        list: { display: 'flex', flexDirection: 'column', gap: 8 },
        row: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          border: '1px solid var(--dsw-alias-border-l)',
          borderRadius: 10,
        },
        rowMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' },
        rowTitle: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        nameButton: {
          border: 'none',
          background: 'none',
          padding: 0,
          margin: 0,
          color: 'var(--dsw-alias-link)',
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
        },
        name: { fontWeight: 600 },
        version: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
        commitLine: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
        specLine: {
          fontSize: 11,
          color: 'var(--dsw-alias-label-tertiary)',
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        },
        errorLine: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
        noteLine: { fontSize: 11, color: 'var(--dsw-alias-state-success-primary)', overflowWrap: 'anywhere' },
        rowActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
        status: { fontSize: 11, padding: '1px 7px', borderRadius: 999, border: '1px solid currentColor' },
        empty: { padding: '24px 12px', textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
        hint: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-caption)', lineHeight: 1.6 },
        section: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginTop: 8,
          padding: 12,
          border: '1px solid var(--dsw-alias-border-l)',
          borderRadius: 10,
        },
        sectionTitle: { margin: 0, fontSize: 12, fontWeight: 600 },
        dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: 0, fontSize: 11 },
        dt: { color: 'var(--dsw-alias-label-tertiary)' },
        dd: {
          margin: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          overflowWrap: 'anywhere',
        },
      }
    }

    const STATUS_KEYS = {
      unchecked: 'stateUnchecked',
      current: 'stateCurrent',
      update: 'stateUpdate',
      pinned: 'statePinned',
      unknown: 'stateUnknown',
      error: 'stateError',
    }

    const STATUS_COLORS = {
      unchecked: 'var(--dsw-alias-label-tertiary)',
      current: 'var(--dsw-alias-state-success-primary)',
      update: 'var(--dsw-alias-state-warn-primary)',
      pinned: 'var(--dsw-alias-label-tertiary)',
      unknown: 'var(--dsw-alias-label-tertiary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    function statusLabel(t, plugin) {
      return t(STATUS_KEYS[plugin.state] ?? 'stateUnchecked')
    }

    /** 该插件是否值得给一个「更新」按钮：只有明确比对出差异时。 */
    function canUpdate(plugin) {
      return plugin !== undefined && plugin.self !== true && plugin.state === 'update'
    }

    function findPlugin(state, name) {
      if (typeof name !== 'string') return undefined
      return state.plugins.find((plugin) => plugin.name === name)
    }

    // ── 组件 ────────────────────────────────────────────────────────────────

    function makePluginRow(t, styles) {
      return function PluginRow({ plugin, state, store, openPackage }) {
        const busy = state.busy[plugin.name] === true
        const note = state.notes[plugin.name]
        const nameNode =
          openPackage === null
            ? h('span', { style: styles.name }, plugin.name)
            : h('button', { style: styles.nameButton, title: t('openBundle'), onClick: () => openPackage(plugin.name) }, plugin.name)
        return h(
          'div',
          { style: styles.row, 'data-plugin-manager-row': plugin.name },
          h(
            'div',
            { style: styles.rowMain },
            h(
              'div',
              { style: styles.rowTitle },
              nameNode,
              plugin.version === null ? null : h('span', { style: styles.version }, `v${plugin.version}`),
              h('span', { style: { ...styles.status, color: STATUS_COLORS[plugin.state] ?? STATUS_COLORS.unchecked } }, statusLabel(t, plugin)),
            ),
            h('span', { style: styles.commitLine }, t('commitLine', { installed: shortSha(plugin.installedCommit), remote: shortSha(plugin.remoteCommit) })),
            h('span', { style: styles.specLine, title: plugin.spec }, plugin.spec),
            plugin.error === null ? null : h('span', { style: styles.errorLine }, plugin.error),
            note === undefined || note === null ? null : h('span', { style: styles.noteLine }, note),
          ),
          h(
            'div',
            { style: styles.rowActions },
            plugin.self === true
              ? h('span', { style: styles.version }, t('selfManaged'))
              : [
                  h(
                    'button',
                    {
                      key: 'check',
                      style: styles.buttonSmall,
                      disabled: busy || state.checking,
                      onClick: () => store.check([plugin.name]),
                    },
                    t('checkOne'),
                  ),
                  canUpdate(plugin)
                    ? h(
                        'button',
                        {
                          key: 'update',
                          style: styles.buttonPrimarySmall,
                          disabled: busy,
                          onClick: () => store.update(plugin.name),
                        },
                        busy ? t('updating') : t('update'),
                      )
                    : null,
                ],
          ),
        )
      }
    }

    function makeTab(t, store, styles) {
      const PluginRow = makePluginRow(t, styles)
      return function UpdatesTab(props) {
        const state = useStore(store)
        useEnsureLoaded(store)
        const openPackage = typeof props?.openPackage === 'function' ? props.openPackage : null
        const plugins = state.plugins
        const updates = plugins.filter((plugin) => canUpdate(plugin)).length
        return h(
          'div',
          { style: styles.wrap, 'data-plugin-manager': 'tab' },
          h(
            'header',
            { style: styles.head },
            h(
              'div',
              null,
              h('h2', { style: styles.title }, t('tab')),
              h('p', { style: styles.sub }, t('subtitle', { count: plugins.length, updates })),
            ),
            h(
              'div',
              { style: styles.actionsRow },
              h(
                'button',
                { style: styles.buttonPrimary, disabled: state.checking || plugins.length === 0, onClick: () => store.check() },
                state.checking ? t('checking') : t('checkAll'),
              ),
              h('button', { style: styles.button, disabled: state.loading, onClick: () => store.load(true) }, t('refresh')),
            ),
          ),
          state.error === null ? null : h('div', { style: styles.errorLine, role: 'alert' }, state.error),
          plugins.length === 0
            ? h('div', { style: styles.empty }, state.loading ? t('loading') : t('empty'))
            : h(
                'div',
                { style: styles.list },
                plugins.map((plugin) => h(PluginRow, { key: plugin.name, plugin, state, store, openPackage })),
              ),
          h('p', { style: styles.hint }, t('hint')),
        )
      }
    }

    function makeBadge(t, store, styles) {
      return function UpdateBadge({ subject }) {
        const state = useStore(store)
        useEnsureLoaded(store)
        if (subject?.kind !== 'bundle') return null
        const plugin = findPlugin(state, subject?.pkg?.name)
        if (plugin === undefined) return null
        if (canUpdate(plugin)) {
          return h(
            'span',
            { style: { ...styles.status, color: 'var(--dsw-alias-state-warn-primary)' }, 'data-plugin-manager': 'badge' },
            t('badgeUpdate'),
          )
        }
        if (plugin.state === 'error') {
          return h(
            'span',
            { style: { ...styles.status, color: 'var(--dsw-alias-state-error-primary)' }, 'data-plugin-manager': 'badge' },
            t('badgeError'),
          )
        }
        return null
      }
    }

    function makeActions(t, store, styles) {
      return function UpdateActions({ subject }) {
        const state = useStore(store)
        useEnsureLoaded(store)
        if (subject?.kind !== 'bundle') return null
        const plugin = findPlugin(state, subject?.pkg?.name)
        if (plugin === undefined || plugin.self === true) return null
        const busy = state.busy[plugin.name] === true
        const update = canUpdate(plugin)
        return h(
          'button',
          {
            style: update ? styles.buttonPrimarySmall : styles.buttonSmall,
            disabled: busy,
            'data-plugin-manager': 'action',
            onClick: () => (update ? store.update(plugin.name) : store.check([plugin.name])),
          },
          busy ? t('updating') : update ? t('update') : t('checkOne'),
        )
      }
    }

    function makeSection(t, store, styles) {
      return function UpdateSection({ subject }) {
        const state = useStore(store)
        useEnsureLoaded(store)
        if (subject?.kind !== 'bundle') return null
        const plugin = findPlugin(state, subject?.pkg?.name)
        if (plugin === undefined) return null
        const busy = state.busy[plugin.name] === true
        const note = state.notes[plugin.name]
        const checked = plugin.checkedAt === null ? t('never') : new Date(plugin.checkedAt).toLocaleString()
        const update = canUpdate(plugin)
        return h(
          'section',
          { style: styles.section, 'data-plugin-manager': 'section' },
          h('h4', { style: styles.sectionTitle }, t('sectionTitle')),
          h(
            'dl',
            { style: styles.dl },
            h('dt', { style: styles.dt }, t('source')),
            h('dd', { style: styles.dd }, plugin.spec),
            h('dt', { style: styles.dt }, t('installed')),
            h('dd', { style: styles.dd }, plugin.installedCommit ?? '—'),
            h('dt', { style: styles.dt }, t('remote')),
            h('dd', { style: styles.dd }, plugin.remoteCommit ?? '—'),
            h('dt', { style: styles.dt }, t('lastChecked')),
            h('dd', { style: styles.dd }, checked),
          ),
          plugin.error === null ? null : h('div', { style: styles.errorLine }, plugin.error),
          note === undefined || note === null ? null : h('div', { style: styles.noteLine }, note),
          h(
            'div',
            { style: styles.actionsRow },
            plugin.self === true
              ? h('span', { style: styles.version }, t('selfManaged'))
              : [
                  h(
                    'button',
                    { key: 'check', style: styles.buttonSmall, disabled: busy || state.checking, onClick: () => store.check([plugin.name]) },
                    t('checkOne'),
                  ),
                  update
                    ? h(
                        'button',
                        { key: 'update', style: styles.buttonPrimarySmall, disabled: busy, onClick: () => store.update(plugin.name) },
                        busy ? t('updating') : t('update'),
                      )
                    : null,
                ],
          ),
        )
      }
    }

    function makeSafe(t, styles) {
      return function safe(Inner) {
        return class SlotBoundary extends React.Component {
          constructor(props) {
            super(props)
            this.state = { error: null }
          }
          static getDerivedStateFromError(error) {
            return { error }
          }
          render() {
            if (this.state.error !== null) {
              return h('div', { style: styles.errorLine }, `${t('componentError')}: ${String(this.state.error?.message ?? this.state.error)}`)
            }
            return h(Inner, this.props)
          }
        }
      }
    }

    // ── 注册 ────────────────────────────────────────────────────────────────

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale
        const disposeZh = locale.register(NS, 'zh', DICTS.zh)
        const disposeEn = locale.register(NS, 'en', DICTS.en)
        ctx.effect(() => () => {
          disposeZh()
          disposeEn()
        })

        let active = 'zh'
        try {
          active = locale.getLocale().active === 'en' ? 'en' : 'zh'
        } catch {
          active = 'zh'
        }
        const t = (key, vars) => interpolate(DICTS[active]?.[key] ?? DICTS.zh[key] ?? key, vars)

        const store = createStore(t)
        const styles = makeStyles()
        const safe = makeSafe(t, styles)

        ctx.slots.inject('plugins.tab', () =>
          ctx.slots.register({ name: 'plugins.tab', id: 'dsh-plugin-manager', label: () => t('tab'), order: 60 }, safe(makeTab(t, store, styles))),
        )
        ctx.slots.inject('plugins.detail.badge', () =>
          ctx.slots.register({ name: 'plugins.detail.badge', id: 'dsh-plugin-manager-badge', order: 60 }, safe(makeBadge(t, store, styles))),
        )
        ctx.slots.inject('plugins.detail.actions', () =>
          ctx.slots.register({ name: 'plugins.detail.actions', id: 'dsh-plugin-manager-actions', order: 60 }, safe(makeActions(t, store, styles))),
        )
        ctx.slots.inject('plugins.detail.section', () =>
          ctx.slots.register({ name: 'plugins.detail.section', id: 'dsh-plugin-manager-section', order: 60 }, safe(makeSection(t, store, styles))),
        )
      },
    }
  },
})
