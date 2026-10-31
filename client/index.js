/**
 * dsh-plugin-manager 的浏览器半侧。
 *
 * 只做增量，不占 `plugins.tab`，原生插件页保持原样：
 *   - `plugins.add.actions`  —— 「添加插件」菜单里的「GitHub 插件更新」入口；
 *   - `shell.overlay`        —— 更新弹层：扫描全部、列出 GitHub 来源插件、逐项重装；
 *   - `plugins.detail.badge` / `actions` / `section` —— 组合包详情页里的状态与操作。
 *
 * 安装仍用插件页原生的「添加插件」；本插件只管理已安装 GitHub 插件的更新。
 * 扫描与更新走宿主同源路由 `/dsh-plugin-manager/api`。
 * 纯 JS，无构建；样式内联，只使用 --dsw-alias-* 主题变量。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const API = '/dsh-plugin-manager/api'
    const NS = 'dshPluginManager'
    const UI_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
    const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

    // ── 文案 ────────────────────────────────────────────────────────────────

    const DICTS = {
      zh: {
        menuTitle: 'GitHub 插件更新',
        menuHint: '扫描已安装 GitHub 插件的远端新提交',
        menuHintUpdates: '{count} 个可更新',
        menuHintChecking: '正在扫描…',
        overlayTitle: 'GitHub 插件更新',
        overlayHint: '安装 GitHub 插件请用页面上的「添加插件」；这里只管理已安装插件的更新。扫描只读远端，更新会按原 spec 卸载重装。',
        close: '关闭',
        loading: '正在读取插件清单…',
        summaryFailed: '读取插件清单失败',
        summaryClean: '共 {total} 个 GitHub 来源，暂无更新',
        summaryUpdates: '共 {total} 个 GitHub 来源，{updates} 个可更新',
        summaryErrorsSuffix: '，{errors} 个扫描失败',
        scanAll: '扫描更新',
        scanning: '正在扫描远端…',
        scanningShort: '扫描中…',
        scanAt: '上次扫描 {time}',
        notScanned: '尚未扫描',
        refresh: '刷新列表',
        listTitle: '已安装的 GitHub 插件',
        listHeadCommit: '本地 → 远端',
        empty: '还没有从 GitHub 安装的插件。',
        emptyHint: '先用页面上的「添加插件」装一个 GitHub 仓库；这里只显示已安装的 GitHub 来源插件。',
        stateUnchecked: '未检查',
        stateCurrent: '已是最新',
        stateUpdate: '有更新',
        statePinned: '钉住 commit',
        stateUnknown: '无法比对',
        stateError: '扫描失败',
        update: '更新',
        updating: '更新中…',
        updatingHint: '正在按原 spec 卸载重装…',
        checkOne: '检查',
        retry: '重试',
        noteUpdated: '已重装完成',
        noteRestart: '已重装，重启 DSH 后生效',
        noteSelfUpdate: '自更新已开始；DSH 重载插件后生效。若没有变化，重启 DSH。',
        selfUpdateHint: '自更新会用远端 commit 重装本插件，DSH 可能重载。',
        badgeUpdate: '有更新',
        badgeError: '扫描失败',
        sectionTitle: 'GitHub 更新',
        source: '来源',
        installed: '本地 commit',
        remote: '远端 commit',
        lastChecked: '最近检查',
        never: '未检查',
        componentError: '插件管理器面板渲染失败',
        requestFailed: '请求没有完成：{message}',
        local: '本地',
        remoteShort: '远端',
        commitPinned: '钉住 {commit}',
        lastCheckedAt: '检查于 {time}',
        notChecked: '未检查',
        disabled: '已停用',
        thisPlugin: '本插件',
        updateFailed: '更新 {name} 失败：{message}',
        reinstallHint: '可以用页面上的「添加插件」按这个 spec 重新安装。',
      },
      en: {
        menuTitle: 'GitHub plugin updates',
        menuHint: 'Scan installed GitHub plugins for new commits',
        menuHintUpdates: '{count} with updates',
        menuHintChecking: 'Scanning…',
        overlayTitle: 'GitHub plugin updates',
        overlayHint: 'Install GitHub plugins with the page’s Add plugin control. This panel manages updates for installed ones; scanning only reads remotes, and updating reinstalls the recorded spec.',
        close: 'Close',
        loading: 'Reading plugin list…',
        summaryFailed: 'Could not read the plugin list',
        summaryClean: '{total} GitHub source(s), no updates',
        summaryUpdates: '{total} GitHub source(s), {updates} with updates',
        summaryErrorsSuffix: ', {errors} failed',
        scanAll: 'Scan for updates',
        scanning: 'Scanning remotes…',
        scanningShort: 'Scanning…',
        scanAt: 'Scanned {time}',
        notScanned: 'Not scanned yet',
        refresh: 'Refresh list',
        listTitle: 'Installed from GitHub',
        listHeadCommit: 'local → remote',
        empty: 'No plugins installed from GitHub yet.',
        emptyHint: 'Install a GitHub repository with the page’s Add plugin control; this list only covers installed GitHub sources.',
        stateUnchecked: 'Not checked',
        stateCurrent: 'Up to date',
        stateUpdate: 'Update available',
        statePinned: 'Pinned commit',
        stateUnknown: 'Not comparable',
        stateError: 'Scan failed',
        update: 'Update',
        updating: 'Updating…',
        updatingHint: 'Uninstalling and reinstalling the recorded spec…',
        checkOne: 'Check',
        retry: 'Retry',
        noteUpdated: 'Reinstalled',
        noteRestart: 'Reinstalled; restart DSH to apply',
        noteSelfUpdate: 'Self-update started; DSH reloads the plugin when done. Restart DSH if nothing changes.',
        selfUpdateHint: 'Self-update reinstalls this plugin at the remote commit; DSH may reload.',
        badgeUpdate: 'Update available',
        badgeError: 'Scan failed',
        sectionTitle: 'GitHub updates',
        source: 'Source',
        installed: 'Local commit',
        remote: 'Remote commit',
        lastChecked: 'Last checked',
        never: 'Not checked',
        componentError: 'The plugin manager panel failed to render',
        requestFailed: 'Request failed: {message}',
        local: 'local',
        remoteShort: 'remote',
        commitPinned: 'Pinned {commit}',
        lastCheckedAt: 'Checked {time}',
        notChecked: 'Not checked',
        disabled: 'Disabled',
        thisPlugin: 'This plugin',
        updateFailed: 'Update failed for {name}: {message}',
        reinstallHint: 'Use the page’s Add plugin control with this spec to reinstall.',
      },
    }

    function interpolate(template, vars) {
      if (typeof template !== 'string') return ''
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match))
    }

    function messageOf(error) {
      if (typeof error === 'string') return error
      if (error instanceof Error) return error.message
      return String(error?.message ?? error)
    }

    function shortSha(sha) {
      return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : '—'
    }

    function formatWhen(ms) {
      if (typeof ms !== 'number' || Number.isFinite(ms) === false) return ''
      const date = new Date(ms)
      const now = new Date()
      const sameDay =
        date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
      const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      if (sameDay) return time
      return `${date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${time}`
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

    // ── 状态 ────────────────────────────────────────────────────────────────

    const STATE_KEYS = {
      unchecked: 'stateUnchecked',
      current: 'stateCurrent',
      update: 'stateUpdate',
      pinned: 'statePinned',
      unknown: 'stateUnknown',
      error: 'stateError',
    }

    const STATE_COLORS = {
      unchecked: 'var(--dsw-alias-label-tertiary)',
      current: 'var(--dsw-alias-state-success-primary)',
      update: 'var(--dsw-alias-state-warn-primary)',
      pinned: 'var(--dsw-alias-label-tertiary)',
      unknown: 'var(--dsw-alias-label-tertiary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const STATE_RANK = { update: 0, error: 1, unknown: 2, unchecked: 3, pinned: 4, current: 5 }

    function statusLabel(t, plugin) {
      return t(STATE_KEYS[plugin.state] ?? 'stateUnchecked')
    }

    function statusColor(state) {
      return STATE_COLORS[state] ?? STATE_COLORS.unchecked
    }

    /** 该插件是否值得给一个「更新」按钮：只有明确比对出差异时。 */
    function canUpdate(plugin) {
      return plugin !== undefined && plugin.state === 'update'
    }

    function findPlugin(state, name) {
      if (typeof name !== 'string') return undefined
      return state.plugins.find((plugin) => plugin.name === name)
    }

    function updatingAnywhere(state) {
      return Object.keys(state.busy).some((key) => state.busy[key] === true)
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
        updateError: null,
      }
      let loadPromise = null
      let autoScanDone = false

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

      /** 读取清单。已有请求在途中时复用它，避免刷新与安装轮询互相覆盖。 */
      async function load() {
        if (loadPromise !== null) return loadPromise
        loadPromise = (async () => {
          patch({ loading: true, error: null })
          try {
            adopt(await requestJson('/list'))
          } catch (error) {
            patch({ loading: false, error: messageOf(error) })
          } finally {
            loadPromise = null
          }
        })()
        return loadPromise
      }

      async function check(names) {
        if (state.checking) return
        patch({ checking: true, error: null })
        let failure = null
        try {
          const body = names === undefined ? {} : { names }
          adopt(await requestJson('/check', { method: 'POST', body: JSON.stringify(body) }))
        } catch (error) {
          failure = messageOf(error)
        }
        patch({ checking: false, ...(failure === null ? {} : { error: failure }) })
      }

      async function update(name) {
        if (state.busy[name] === true) return
        const plugin = state.plugins.find((candidate) => candidate.name === name) ?? null
        patch({ busy: { ...state.busy, [name]: true }, notes: { ...state.notes, [name]: null }, updateError: null })
        let failure = null
        try {
          const data = await requestJson('/update', { method: 'POST', body: JSON.stringify({ name }) })
          const text =
            data?.selfUpdate === true
              ? t('noteSelfUpdate')
              : data?.restartRequired === true
                ? t('noteRestart')
                : t('noteUpdated')
          patch({ notes: { ...state.notes, [name]: { text, tone: 'success' } } })
        } catch (error) {
          failure = { text: messageOf(error), spec: plugin?.spec ?? null }
          patch({ notes: { ...state.notes, [name]: { text: failure.text, tone: 'error' } } })
        } finally {
          await load()
          const stillInstalled = state.plugins.some((candidate) => candidate.name === name)
          patch({
            ...(failure !== null && stillInstalled === false ? { updateError: { name, ...failure } } : {}),
            ...(failure === null ? { updateError: null } : {}),
            busy: { ...state.busy, [name]: false },
          })
        }
      }

      function ensureLoaded() {
        if (state.loaded === false && loadPromise === null) void load()
      }

      /** 标签页第一次打开且宿主还没扫过时自动扫一次；失败后不自动重试。 */
      function ensureScanned() {
        if (autoScanDone) return
        if (state.loaded === false || state.loading || state.checking) return
        if (state.plugins.length === 0) return
        autoScanDone = true
        if (state.checkedAt === null) void check()
      }

      function clearUpdateError() {
        if (state.updateError !== null) patch({ updateError: null })
      }

      return { subscribe, snapshot, load, check, update, ensureLoaded, ensureScanned, clearUpdateError }
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

    // ── 样式 ────────────────────────────────────────────────────────────────

    function makeStyles() {
      const buttonBase = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 30,
        padding: '0 10px',
        boxSizing: 'border-box',
        border: '1px solid transparent',
        borderRadius: 7,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        appearance: 'none',
      }
      return {
        overlayBackdrop: {
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--dsw-alias-bg-mask-1)',
        },
        overlayPanel: {
          display: 'flex',
          flexDirection: 'column',
          width: 'min(760px, 100%)',
          maxHeight: 'min(84vh, 760px)',
          minHeight: 0,
          overflow: 'hidden',
          borderRadius: 14,
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-2)',
          outline: 'none',
        },
        overlayHead: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '16px 18px 12px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
        overlayHeadMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 320px' },
        overlayTitle: { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' },
        summary: { margin: '3px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
        summaryErrors: { color: 'var(--dsw-alias-state-error-primary)' },
        scanLine: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '2px 0 0',
          fontSize: 11,
          color: 'var(--dsw-alias-label-tertiary)',
        },
        scanDot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0 },
        overlayActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        overlayBody: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 0,
          padding: '12px 18px 4px',
          overflow: 'auto',
        },
        overlayHint: {
          margin: 0,
          padding: '10px 18px 14px',
          fontSize: 11,
          lineHeight: 1.6,
          color: 'var(--dsw-alias-label-caption)',
        },
        listHead: {
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          paddingBottom: 8,
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
        listTitle: { margin: 0, fontSize: 12, fontWeight: 600 },
        listHeadCommit: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
        list: { display: 'flex', flexDirection: 'column' },
        row: {
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          padding: '12px 8px',
          margin: '0 -8px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 8,
          flexWrap: 'wrap',
        },
        rowHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
        rail: { width: 3, flexShrink: 0, borderRadius: 2, marginTop: 2, marginBottom: 2 },
        rowMain: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px', minWidth: 0 },
        rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        name: { fontWeight: 600, fontSize: 13 },
        versionTag: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', fontFamily: MONO_FONT },
        status: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' },
        statusDot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: 'currentColor' },
        tag: {
          padding: '1px 6px',
          borderRadius: 999,
          border: '1px solid var(--dsw-alias-border-l1)',
          fontSize: 10,
          lineHeight: 1.5,
          color: 'var(--dsw-alias-label-tertiary)',
          whiteSpace: 'nowrap',
        },
        commitRail: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          fontFamily: MONO_FONT,
          fontSize: 11,
          color: 'var(--dsw-alias-label-secondary)',
        },
        commitLabel: { fontFamily: UI_FONT, fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' },
        commitSha: {
          padding: '1px 5px',
          borderRadius: 4,
          background: 'var(--dsw-alias-bg-l2)',
          color: 'var(--dsw-alias-label-secondary)',
          fontFamily: MONO_FONT,
          fontSize: 11,
        },
        commitArrow: { color: 'var(--dsw-alias-label-tertiary)' },
        commitPinned: { fontFamily: MONO_FONT, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
        specLine: {
          fontSize: 11,
          color: 'var(--dsw-alias-label-tertiary)',
          fontFamily: MONO_FONT,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        },
        rowMeta: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
        updatingHint: { color: 'var(--dsw-alias-state-warn-primary)' },
        errorLine: { fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
        noteLine: { fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-state-success-primary)', overflowWrap: 'anywhere' },
        rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' },
        selfUpdateHint: { fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-label-tertiary)' },
        empty: { padding: '26px 4px 22px' },
        emptyTitle: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
        emptyHint: { margin: '5px 0 0', fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-label-tertiary)' },
        skeletonList: { display: 'flex', flexDirection: 'column' },
        skeletonRow: {
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          padding: '14px 8px',
          margin: '0 -8px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
        skeletonRail: { width: 3, flexShrink: 0, borderRadius: 2, background: 'var(--dsw-alias-bg-skeleton)' },
        skeletonMain: { display: 'flex', flexDirection: 'column', gap: 7, flex: '1 1 auto' },
        skeletonBar: { height: 10, borderRadius: 999, background: 'var(--dsw-alias-bg-skeleton)' },
        errorBanner: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 12px',
          borderRadius: 8,
          borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
          background: 'var(--dsw-alias-bg-l1)',
        },
        errorText: { flex: '1 1 260px', fontSize: 12, lineHeight: 1.55, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
        errorStack: { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 260px', minWidth: 0 },
        errorSpec: {
          alignSelf: 'flex-start',
          padding: '2px 6px',
          borderRadius: 4,
          background: 'var(--dsw-alias-bg-l2)',
          color: 'var(--dsw-alias-label-secondary)',
          fontFamily: MONO_FONT,
          fontSize: 11,
          overflowWrap: 'anywhere',
        },
        errorHint: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 },
        buttonBase,
        buttonPrimary: {
          background: 'var(--dsw-alias-brand-primary)',
          color: 'var(--dsw-alias-label-primary-foreground)',
          borderColor: 'transparent',
        },
        buttonSecondary: { borderColor: 'var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)' },
        buttonGhost: { color: 'var(--dsw-alias-link)' },
        buttonHoverPrimary: { background: 'var(--dsw-alias-button-primary-hover)' },
        buttonHoverSecondary: { background: 'var(--dsw-alias-interactive-bg-hover)' },
        buttonFocus: { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: 2 },
        buttonDisabled: { opacity: 0.45, cursor: 'default' },
        detailSection: {
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 12,
          paddingTop: 14,
          borderTop: '1px solid var(--dsw-alias-border-l1)',
        },
        detailHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
        detailTitle: { margin: 0, fontSize: 12, fontWeight: 600 },
        detailGrid: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '5px 16px', margin: 0, fontSize: 11 },
        dt: { color: 'var(--dsw-alias-label-tertiary)' },
        dd: {
          margin: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontFamily: MONO_FONT,
          overflowWrap: 'anywhere',
        },
        ddText: { margin: 0, color: 'var(--dsw-alias-label-secondary)' },
        detailActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        badge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' },
        menuItem: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          width: '100%',
          padding: '8px 10px',
          boxSizing: 'border-box',
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
          fontSize: 12,
          textAlign: 'left',
          cursor: 'pointer',
        },
        menuItemHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
        menuItemFocus: { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: 1 },
        menuItemIcon: { flexShrink: 0, marginTop: 1, color: 'var(--dsw-alias-label-secondary)' },
        menuItemBody: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' },
        menuItemTitleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
        menuItemTitle: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
        menuItemHint: { fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary)' },
        menuItemHintUpdates: { color: 'var(--dsw-alias-state-warn-primary)' },
        menuItemBadge: {
          padding: '0 6px',
          borderRadius: 999,
          background: 'var(--dsw-alias-bg-l2)',
          color: 'var(--dsw-alias-state-warn-primary)',
          fontSize: 10,
          lineHeight: '16px',
        },
      }
    }

    // ── 通用组件 ────────────────────────────────────────────────────────────

    function ControlButton({ styles, variant = 'secondary', disabled = false, onClick, children, ...rest }) {
      const [hover, setHover] = useState(false)
      const [focus, setFocus] = useState(false)
      const palette =
        variant === 'primary' ? styles.buttonPrimary : variant === 'ghost' ? styles.buttonGhost : styles.buttonSecondary
      const hoverStyle = variant === 'primary' ? styles.buttonHoverPrimary : styles.buttonHoverSecondary
      return h(
        'button',
        {
          type: 'button',
          disabled,
          onClick,
          ...rest,
          style: {
            ...styles.buttonBase,
            ...palette,
            ...(hover && disabled === false ? hoverStyle : null),
            ...(focus ? styles.buttonFocus : null),
            ...(disabled ? styles.buttonDisabled : null),
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onFocus: () => setFocus(true),
          onBlur: () => setFocus(false),
        },
        children,
      )
    }

    function Status({ styles, state, children }) {
      return h(
        'span',
        { style: { ...styles.status, color: statusColor(state) } },
        h('span', { style: styles.statusDot, 'aria-hidden': 'true' }),
        children,
      )
    }

    // ── 列表 ────────────────────────────────────────────────────────────────

    function makePluginRow(t, styles) {
      return function PluginRow({ plugin, state, store }) {
        const [hover, setHover] = useState(false)
        const busy = state.busy[plugin.name] === true
        const busyAnywhere = updatingAnywhere(state)
        const note = state.notes[plugin.name]
        const update = canUpdate(plugin)
        const tags = []
        if (plugin.self === true) tags.push(h('span', { key: 'self', style: styles.tag }, t('thisPlugin')))
        else if (plugin.enabled === false) tags.push(h('span', { key: 'disabled', style: styles.tag }, t('disabled')))

        const commitNodes =
          plugin.state === 'pinned' || (plugin.pinned === true && plugin.self !== true)
            ? h('span', { style: styles.commitPinned }, t('commitPinned', { commit: shortSha(plugin.installedCommit) }))
            : [
                h('span', { key: 'local-label', style: styles.commitLabel }, t('local')),
                h('code', { key: 'local-sha', style: styles.commitSha }, shortSha(plugin.installedCommit)),
                h('span', { key: 'arrow', style: styles.commitArrow, 'aria-hidden': 'true' }, '→'),
                h('span', { key: 'remote-label', style: styles.commitLabel }, t('remoteShort')),
                h('code', { key: 'remote-sha', style: styles.commitSha }, shortSha(plugin.remoteCommit)),
              ]

        let action = null
        if (plugin.state !== 'pinned') {
          if (update) {
            action = h(
              ControlButton,
              {
                styles,
                variant: 'primary',
                disabled: busy || busyAnywhere || state.checking,
                onClick: () => store.update(plugin.name),
                'aria-label': `${t('update')} ${plugin.name}`,
                'data-plugin-manager': 'update',
              },
              busy ? t('updating') : t('update'),
            )
          } else {
            action = h(
              ControlButton,
              {
                styles,
                variant: 'secondary',
                disabled: busy || busyAnywhere || state.checking,
                onClick: () => store.check([plugin.name]),
                'aria-label': `${t('checkOne')} ${plugin.name}`,
                'data-plugin-manager': 'check',
              },
              plugin.state === 'error' ? t('retry') : t('checkOne'),
            )
          }
        }

        return h(
          'div',
          {
            style: { ...styles.row, ...(hover ? styles.rowHover : null) },
            'data-plugin-manager-row': plugin.name,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
          },
          h('span', { style: { ...styles.rail, background: statusColor(plugin.state) }, 'aria-hidden': 'true' }),
          h(
            'div',
            { style: styles.rowMain },
            h(
              'div',
              { style: styles.rowTop },
              h('span', { style: styles.name }, plugin.name),
              plugin.version == null ? null : h('span', { style: styles.versionTag }, `v${plugin.version}`),
              h(Status, { styles, state: plugin.state }, statusLabel(t, plugin)),
              tags,
            ),
            h('div', { style: styles.commitRail }, commitNodes),
            h('span', { style: styles.specLine, title: plugin.spec }, plugin.spec),
            h(
              'div',
              { style: styles.rowMeta },
              h('span', null, plugin.checkedAt === null ? t('notChecked') : t('lastCheckedAt', { time: formatWhen(plugin.checkedAt) })),
              busy ? h('span', { style: styles.updatingHint }, t('updatingHint')) : null,
            ),
            plugin.error === null || plugin.error === undefined
              ? null
              : h('div', { style: styles.errorLine, role: 'alert' }, plugin.error),
            note === undefined || note === null
              ? null
              : h(
                  'div',
                  { style: note.tone === 'error' ? styles.errorLine : styles.noteLine, role: note.tone === 'error' ? 'alert' : 'status' },
                  note.text,
                ),
          ),
          h('div', { style: styles.rowActions }, action),
        )
      }
    }

    function createOverlayController() {
      let open = false
      const listeners = new Set()
      const publish = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[plugin-manager] overlay listener failed', error)
          }
        }
      }
      return {
        snapshot: () => open,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        open: () => {
          if (open) return
          open = true
          publish()
        },
        close: () => {
          if (!open) return
          open = false
          publish()
        },
      }
    }

    function makeMenuItem(t, store, styles, controller) {
      return function GitHubUpdatesMenuItem({ onDismiss }) {
        const state = useStore(store)
        const [hover, setHover] = useState(false)
        const [focus, setFocus] = useState(false)
        const updates = state.plugins.filter((plugin) => canUpdate(plugin)).length
        const hint =
          state.checking === true
            ? t('menuHintChecking')
            : updates > 0
              ? t('menuHintUpdates', { count: updates })
              : t('menuHint')
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            'data-plugin-manager': 'menu',
            style: {
              ...styles.menuItem,
              ...(hover ? styles.menuItemHover : null),
              ...(focus ? styles.menuItemFocus : null),
            },
            onClick: () => {
              if (typeof onDismiss === 'function') onDismiss()
              controller.open()
            },
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setFocus(true),
            onBlur: () => setFocus(false),
          },
          h(
            'svg',
            {
              width: 14,
              height: 14,
              viewBox: '0 0 16 16',
              fill: 'none',
              'aria-hidden': 'true',
              style: styles.menuItemIcon,
            },
            h('path', {
              d: 'M13 8a5 5 0 1 1-1.46-3.54M13 3v4h-4',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
          h(
            'span',
            { style: styles.menuItemBody },
            h(
              'span',
              { style: styles.menuItemTitleRow },
              h('span', { style: styles.menuItemTitle }, t('menuTitle')),
              updates > 0 ? h('span', { style: styles.menuItemBadge }, String(updates)) : null,
            ),
            h('span', { style: { ...styles.menuItemHint, ...(updates > 0 ? styles.menuItemHintUpdates : null) } }, hint),
          ),
        )
      }
    }

    function makeOverlay(t, store, styles, controller) {
      const PluginRow = makePluginRow(t, styles)
      return function GitHubUpdatesOverlay() {
        const state = useStore(store)
        const [open, setOpen] = useState(controller.snapshot())
        const panelRef = useRef(null)

        useEffect(() => controller.subscribe(() => setOpen(controller.snapshot())), [controller])

        useEffect(() => {
          if (!open) return
          store.ensureLoaded()
          store.ensureScanned()
        }, [open, store, state.loaded, state.loading, state.plugins.length, state.checkedAt, state.checking])

        useEffect(() => {
          if (!open) return undefined
          const onKeyDown = (event) => {
            if (event.key === 'Escape') controller.close()
          }
          window.addEventListener('keydown', onKeyDown)
          panelRef.current?.focus?.()
          return () => window.removeEventListener('keydown', onKeyDown)
        }, [open, controller])

        if (!open) return null

        const plugins = state.plugins
        const ordered = [...plugins].sort(
          (left, right) => (STATE_RANK[left.state] ?? 9) - (STATE_RANK[right.state] ?? 9) || left.name.localeCompare(right.name),
        )
        const updates = plugins.filter((plugin) => canUpdate(plugin)).length
        const errors = plugins.filter((plugin) => plugin.state === 'error').length
        const busyAnywhere = updatingAnywhere(state)
        const summary =
          state.loaded === false
            ? state.error === null
              ? t('loading')
              : t('summaryFailed')
            : updates > 0
              ? t('summaryUpdates', { total: plugins.length, updates })
              : t('summaryClean', { total: plugins.length })
        const scanText = state.checking
          ? t('scanning')
          : state.checkedAt === null
            ? t('notScanned')
            : t('scanAt', { time: formatWhen(state.checkedAt) })

        const skeleton =
          state.error === null && state.loaded === false
            ? h(
                'div',
                { style: styles.skeletonList, 'aria-busy': 'true', role: 'status', 'aria-label': t('loading') },
                [0, 1, 2].map((index) =>
                  h(
                    'div',
                    { key: index, style: styles.skeletonRow },
                    h('span', { style: styles.skeletonRail, 'aria-hidden': 'true' }),
                    h(
                      'div',
                      { style: styles.skeletonMain },
                      h('span', { style: { ...styles.skeletonBar, width: '34%' } }),
                      h('span', { style: { ...styles.skeletonBar, width: '62%' } }),
                      h('span', { style: { ...styles.skeletonBar, width: '46%' } }),
                    ),
                  ),
                ),
              )
            : null

        const empty =
          state.loaded === true && plugins.length === 0
            ? h(
                'div',
                { style: styles.empty },
                h('p', { style: styles.emptyTitle }, t('empty')),
                h('p', { style: styles.emptyHint }, t('emptyHint')),
              )
            : null

        return h(
          'div',
          {
            style: styles.overlayBackdrop,
            'data-plugin-manager': 'overlay',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) controller.close()
            },
          },
          h(
            'div',
            {
              ref: panelRef,
              tabIndex: -1,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'dsh-plugin-manager-overlay-title',
              style: styles.overlayPanel,
            },
            h(
              'header',
              { style: styles.overlayHead },
              h(
                'div',
                { style: styles.overlayHeadMain },
                h('h2', { id: 'dsh-plugin-manager-overlay-title', style: styles.overlayTitle }, t('overlayTitle')),
                h(
                  'p',
                  { style: styles.summary },
                  summary,
                  errors > 0 ? h('span', { style: styles.summaryErrors }, t('summaryErrorsSuffix', { errors })) : null,
                ),
                h(
                  'p',
                  { style: styles.scanLine, role: 'status' },
                  h('span', {
                    style: {
                      ...styles.scanDot,
                      background: state.checking
                        ? 'var(--dsw-alias-brand-primary)'
                        : statusColor(errors > 0 ? 'error' : state.checkedAt === null ? 'unchecked' : 'current'),
                    },
                    'aria-hidden': 'true',
                  }),
                  scanText,
                ),
              ),
              h(
                'div',
                { style: styles.overlayActions },
                h(
                  ControlButton,
                  {
                    styles,
                    variant: 'secondary',
                    disabled: state.loaded === false || state.checking || busyAnywhere || plugins.length === 0,
                    onClick: () => store.check(),
                    'data-plugin-manager': 'scan',
                  },
                  state.checking ? t('scanningShort') : t('scanAll'),
                ),
                h(
                  ControlButton,
                  {
                    styles,
                    variant: 'secondary',
                    disabled: state.loading || state.checking,
                    onClick: () => store.load(),
                    'data-plugin-manager': 'refresh',
                  },
                  t('refresh'),
                ),
                h(
                  ControlButton,
                  {
                    styles,
                    variant: 'ghost',
                    onClick: () => controller.close(),
                    'data-plugin-manager': 'close',
                  },
                  t('close'),
                ),
              ),
            ),
            h(
              'div',
              { style: styles.overlayBody },
              state.error === null
                ? null
                : h(
                    'div',
                    { style: styles.errorBanner, role: 'alert' },
                    h('span', { style: styles.errorText }, t('requestFailed', { message: state.error })),
                    h(
                      ControlButton,
                      {
                        styles,
                        variant: 'secondary',
                        disabled: state.loading || state.checking,
                        onClick: () => (state.loaded ? store.check() : store.load()),
                      },
                      t('retry'),
                    ),
                  ),
              state.updateError === null
                ? null
                : h(
                    'div',
                    { style: styles.errorBanner, role: 'alert', 'data-plugin-manager': 'update-error' },
                    h(
                      'div',
                      { style: styles.errorStack },
                      h(
                        'span',
                        { style: styles.errorText },
                        t('updateFailed', { name: state.updateError.name, message: state.updateError.text }),
                      ),
                      state.updateError.spec === null ? null : h('code', { style: styles.errorSpec }, state.updateError.spec),
                      h('span', { style: styles.errorHint }, t('reinstallHint')),
                    ),
                  ),
              h(
                'div',
                { style: styles.listHead },
                h('h3', { style: styles.listTitle }, t('listTitle')),
                h('span', { style: styles.listHeadCommit }, t('listHeadCommit')),
              ),
              skeleton,
              empty,
              state.loaded === true && plugins.length > 0
                ? h(
                    'div',
                    { style: styles.list, 'aria-busy': state.checking ? 'true' : 'false' },
                    ordered.map((plugin) => h(PluginRow, { key: plugin.name, plugin, state, store })),
                  )
                : null,
            ),
            h('p', { style: styles.overlayHint }, t('overlayHint')),
          ),
        )
      }
    }

    // ── 组合包详情页 ────────────────────────────────────────────────────────

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
            { style: { ...styles.badge, color: 'var(--dsw-alias-state-warn-primary)' }, 'data-plugin-manager': 'badge' },
            h('span', { style: styles.statusDot, 'aria-hidden': 'true' }),
            t('badgeUpdate'),
          )
        }
        if (plugin.state === 'error') {
          return h(
            'span',
            { style: { ...styles.badge, color: 'var(--dsw-alias-state-error-primary)' }, 'data-plugin-manager': 'badge' },
            h('span', { style: styles.statusDot, 'aria-hidden': 'true' }),
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
        if (plugin === undefined) return null
        const busy = state.busy[plugin.name] === true
        const update = canUpdate(plugin)
        return h(
          ControlButton,
          {
            styles,
            variant: update ? 'primary' : 'secondary',
            disabled: busy || updatingAnywhere(state) || state.checking,
            'data-plugin-manager': 'action',
            'aria-label': `${update ? t('update') : t('checkOne')} ${plugin.name}`,
            onClick: () => (update ? store.update(plugin.name) : store.check([plugin.name])),
          },
          busy ? t('updating') : update ? t('update') : plugin.state === 'error' ? t('retry') : t('checkOne'),
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
        const update = canUpdate(plugin)
        const checked = plugin.checkedAt === null ? t('never') : formatWhen(plugin.checkedAt)
        return h(
          'section',
          { style: styles.detailSection, 'data-plugin-manager': 'section' },
          h(
            'div',
            { style: styles.detailHead },
            h('h4', { style: styles.detailTitle }, t('sectionTitle')),
            h(Status, { styles, state: plugin.state }, statusLabel(t, plugin)),
          ),
          h(
            'dl',
            { style: styles.detailGrid },
            h('dt', { style: styles.dt }, t('source')),
            h('dd', { style: styles.dd }, plugin.spec),
            h('dt', { style: styles.dt }, t('installed')),
            h('dd', { style: styles.dd }, plugin.installedCommit ?? '—'),
            h('dt', { style: styles.dt }, t('remote')),
            h('dd', { style: styles.dd }, plugin.remoteCommit ?? '—'),
            h('dt', { style: styles.dt }, t('lastChecked')),
            h('dd', { style: styles.ddText }, checked),
          ),
          plugin.error === null || plugin.error === undefined
            ? null
            : h('div', { style: styles.errorLine, role: 'alert' }, plugin.error),
          note === undefined || note === null
            ? null
            : h(
                'div',
                { style: note.tone === 'error' ? styles.errorLine : styles.noteLine, role: note.tone === 'error' ? 'alert' : 'status' },
                note.text,
              ),
          plugin.self === true ? h('div', { style: styles.selfUpdateHint }, t('selfUpdateHint')) : null,
          h(
            'div',
            { style: styles.detailActions },
            [
                  update
                    ? h(
                        ControlButton,
                        {
                          key: 'update',
                          styles,
                          variant: 'primary',
                          disabled: busy || updatingAnywhere(state) || state.checking,
                          onClick: () => store.update(plugin.name),
                          'aria-label': `${t('update')} ${plugin.name}`,
                        },
                        busy ? t('updating') : t('update'),
                      )
                    : null,
                  h(
                    ControlButton,
                    {
                      key: 'check',
                      styles,
                      variant: 'secondary',
                      disabled: busy || updatingAnywhere(state) || state.checking,
                      onClick: () => store.check([plugin.name]),
                      'aria-label': `${t('checkOne')} ${plugin.name}`,
                    },
                    plugin.state === 'error' ? t('retry') : t('checkOne'),
                  ),
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
              return h('div', { style: styles.errorLine }, `${t('componentError')}: ${messageOf(this.state.error)}`)
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
        const overlay = createOverlayController()

        ctx.slots.inject('plugins.add.actions', () =>
          ctx.slots.register(
            { name: 'plugins.add.actions', id: 'dsh-plugin-manager-menu', order: 60 },
            safe(makeMenuItem(t, store, styles, overlay)),
          ),
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
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-plugin-manager-overlay', order: 900 }, safe(makeOverlay(t, store, styles, overlay))),
        )
      },
    }
  },
})
