/**
 * dsh-plugin-manager 的浏览器半侧。
 *
 * 挂在 DSH 自带插件页的插槽上：
 *   - `plugins.tab`              —— 「GitHub 插件」标签页：从 GitHub 安装、扫描更新、逐项重装；
 *   - `plugins.detail.badge`     —— 组合包详情页标题旁的更新状态；
 *   - `plugins.detail.actions`   —— 详情页页头的检查 / 更新按钮；
 *   - `plugins.detail.section`   —— 详情页下方的来源与 commit 明细。
 *
 * 安装交给插件页提供的 `install()`，复用 DSH 自己的安装对话框、进度与失败处理；
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
    const INSTALL_WATCH_MS = 3 * 60 * 1000

    // ── 文案 ────────────────────────────────────────────────────────────────

    const DICTS = {
      zh: {
        tab: 'GitHub 插件',
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
        installTitle: '从 GitHub 安装',
        installHint: '支持 owner/repo、GitHub 链接、github:owner/repo，可带 #分支或标签。',
        installLabel: 'GitHub 仓库',
        installPlaceholder: 'owner/repo 或 https://github.com/owner/repo',
        installAction: '安装',
        installUnavailable: '当前 DSH 页面没有提供安装入口；切回「已安装」标签页，用页面自带的「添加插件」。',
        installErrorEmpty: '先填入 GitHub 仓库地址。',
        installErrorGithub: '只支持 github.com 上的仓库。',
        installErrorRepo: '仓库格式不对，应为 owner/repo。',
        installErrorRef: '分支或标签不能为空，也不能包含空格。',
        installStarted: '已发起安装；完成后列表会自动刷新。',
        installDetected: '安装完成，列表已更新。',
        installTimeout: '没有检测到列表变化；如果安装已完成，点「刷新列表」。',
        installBusy: '有更新正在进行，完成后再安装。',
        updateFailed: '更新 {name} 失败：{message}',
        updateRefill: '填入地址栏',
        updateSpecFilled: '已填入原 spec，点「安装」重新安装。',
        listTitle: '已安装的 GitHub 插件',
        listHeadCommit: '本地 → 远端',
        empty: '还没有从 GitHub 安装的插件。',
        emptyHint: '在上面的地址栏填入仓库，安装交给 DSH 的安装对话框完成。',
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
        selfManaged: '不更新自己',
        noteUpdated: '已重装完成',
        noteRestart: '已重装，重启 DSH 后生效',
        badgeUpdate: '有更新',
        badgeError: '扫描失败',
        sectionTitle: 'GitHub 更新',
        source: '来源',
        installed: '本地 commit',
        remote: '远端 commit',
        lastChecked: '最近检查',
        never: '未检查',
        openBundle: '打开组合包详情',
        componentError: '插件管理器面板渲染失败',
        requestFailed: '请求没有完成：{message}',
        local: '本地',
        remoteShort: '远端',
        commitPinned: '钉住 {commit}',
        lastCheckedAt: '检查于 {time}',
        notChecked: '未检查',
        disabled: '已停用',
        thisPlugin: '本插件',
        hint: '扫描只读远端，不改本地文件；更新会按 profile 里记录的原 spec 卸载重装，安装失败时插件会留在未安装状态，可从上方地址栏重新安装。',
      },
      en: {
        tab: 'GitHub plugins',
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
        installTitle: 'Install from GitHub',
        installHint: 'Accepts owner/repo, GitHub URLs, and github:owner/repo with an optional #ref.',
        installLabel: 'GitHub repository',
        installPlaceholder: 'owner/repo or https://github.com/owner/repo',
        installAction: 'Install',
        installUnavailable: 'This DSH page does not expose its install entry point. Switch to Installed and use the page’s Add plugin control.',
        installErrorEmpty: 'Enter a GitHub repository first.',
        installErrorGithub: 'Only github.com repositories are supported.',
        installErrorRepo: 'That is not a repository path; use owner/repo.',
        installErrorRef: 'A branch or tag cannot be empty or contain spaces.',
        installStarted: 'Install started; the list refreshes when it finishes.',
        installDetected: 'Installed; the list is up to date.',
        installTimeout: 'No list change detected. If the install finished, use Refresh list.',
        installBusy: 'An update is in progress; wait for it to finish before installing.',
        updateFailed: 'Update failed for {name}: {message}',
        updateRefill: 'Use in install field',
        updateSpecFilled: 'The recorded spec is in the field; press Install to reinstall.',
        listTitle: 'Installed from GitHub',
        listHeadCommit: 'local → remote',
        empty: 'No plugins installed from GitHub yet.',
        emptyHint: 'Paste a repository above; DSH’s install dialog handles the rest.',
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
        selfManaged: 'Not self-updated',
        noteUpdated: 'Reinstalled',
        noteRestart: 'Reinstalled; restart DSH to apply',
        badgeUpdate: 'Update available',
        badgeError: 'Scan failed',
        sectionTitle: 'GitHub updates',
        source: 'Source',
        installed: 'Local commit',
        remote: 'Remote commit',
        lastChecked: 'Last checked',
        never: 'Not checked',
        openBundle: 'Open bundle details',
        componentError: 'The plugin manager panel failed to render',
        requestFailed: 'Request failed: {message}',
        local: 'local',
        remoteShort: 'remote',
        commitPinned: 'Pinned {commit}',
        lastCheckedAt: 'Checked {time}',
        notChecked: 'Not checked',
        disabled: 'Disabled',
        thisPlugin: 'This plugin',
        hint: 'Scanning only reads remotes and writes nothing. Updating uninstalls and reinstalls the recorded spec; a failed install leaves the plugin uninstalled, and the install field above can reinstall it.',
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

    // ── GitHub 地址解析 ─────────────────────────────────────────────────────

    const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/

    function githubSpec(owner, repo, ref) {
      if (typeof owner !== 'string' || typeof repo !== 'string') return { error: 'installErrorGithub' }
      const cleanOwner = owner.trim()
      const cleanRepo = repo.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
      if (cleanOwner === '' || cleanRepo === '') return { error: 'installErrorRepo' }
      if (GITHUB_NAME.test(cleanOwner) === false || GITHUB_NAME.test(cleanRepo) === false) {
        return { error: 'installErrorRepo' }
      }
      let cleanRef
      if (ref !== undefined) {
        cleanRef = String(ref).trim()
        if (cleanRef === '' || /\s/.test(cleanRef)) return { error: 'installErrorRef' }
      }
      const suffix = cleanRef === undefined ? '' : `#${cleanRef}`
      return { spec: `github:${cleanOwner}/${cleanRepo}${suffix}`, label: `${cleanOwner}/${cleanRepo}${suffix}` }
    }

    /**
     * 把用户输入折成 profile 里记录的 `github:owner/repo[#ref]`。
     * 只认 github.com；返回 `{ spec, label }` 或 `{ error: <文案键> }`。
     */
    function normalizeGithubInput(raw) {
      const text = String(raw ?? '').trim()
      if (text === '') return { error: 'installErrorEmpty' }

      let match = /^github:([^/\s#]+)\/([^/\s#]+?)(?:#(.*))?$/i.exec(text)
      if (match !== null) return githubSpec(match[1], match[2], match[3])
      if (/^github:/i.test(text)) return { error: 'installErrorRepo' }

      if (/^git@/i.test(text)) {
        match = /^git@github\.com:([^/\s#]+)\/([^/\s#]+?)(?:#(.*))?$/i.exec(text)
        if (match === null) return { error: 'installErrorGithub' }
        return githubSpec(match[1], match[2], match[3])
      }

      if (/^(?:git\+)?https?:\/\//i.test(text)) {
        let url
        try {
          url = new URL(text.replace(/^git\+/i, ''))
        } catch {
          return { error: 'installErrorGithub' }
        }
        if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return { error: 'installErrorGithub' }
        const parts = url.pathname.split('/').filter((part) => part !== '')
        if (parts.length < 2) return { error: 'installErrorRepo' }
        let ref
        if (parts[2] === 'tree') {
          if (parts.length < 4) return { error: 'installErrorRepo' }
          ref = parts.slice(3).join('/')
        } else if (parts.length > 2) {
          return { error: 'installErrorGithub' }
        }
        return githubSpec(parts[0], parts[1], ref)
      }

      match = /^(?:www\.)?github\.com\/([^/\s#]+)\/([^/\s#]+?)(?:\/tree\/(.+?))?\/?$/i.exec(text)
      if (match !== null) return githubSpec(match[1], match[2], match[3])
      if (/github\.com\//i.test(text)) return { error: 'installErrorGithub' }

      match = /^([^/\s#]+)\/([^/\s#]+?)(?:#(.*))?$/.exec(text)
      if (match !== null) return githubSpec(match[1], match[2], match[3])
      return { error: 'installErrorGithub' }
    }

    function signatureOf(plugins) {
      return plugins
        .map((plugin) =>
          [plugin.name, plugin.version ?? '', plugin.installedCommit ?? '', plugin.spec ?? '', plugin.enabled === false ? '0' : '1'].join(
            '\u0000',
          ),
        )
        .sort()
        .join('\u0001')
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
      return plugin !== undefined && plugin.self !== true && plugin.state === 'update'
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
          const text = data?.restartRequired === true ? t('noteRestart') : t('noteUpdated')
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
        wrap: {
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          padding: '18px 4px 10px',
          font: `13px/1.55 ${UI_FONT}`,
          color: 'var(--dsw-alias-label-primary)',
        },
        head: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        },
        title: { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' },
        summary: { margin: '5px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
        summaryErrors: { color: 'var(--dsw-alias-state-error-primary)' },
        scanLine: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '4px 0 0',
          fontSize: 11,
          color: 'var(--dsw-alias-label-tertiary)',
        },
        scanDot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0 },
        actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        installSection: {
          padding: 14,
          borderRadius: 12,
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-l1)',
        },
        installHead: {
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
        },
        installTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
        installHint: {
          margin: 0,
          flex: '1 1 280px',
          minWidth: 0,
          fontSize: 11,
          lineHeight: 1.55,
          color: 'var(--dsw-alias-label-tertiary)',
        },
        installForm: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        input: {
          flex: '1 1 260px',
          minWidth: 0,
          height: 34,
          padding: '0 10px',
          boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-base)',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: MONO_FONT,
          fontSize: 12,
          lineHeight: '32px',
          outline: 'none',
        },
        inputFocus: {
          borderColor: 'var(--dsw-alias-brand-primary)',
          boxShadow: '0 0 0 1px var(--dsw-alias-brand-primary)',
        },
        inputInvalid: {
          borderColor: 'var(--dsw-alias-state-error-primary)',
          boxShadow: '0 0 0 1px var(--dsw-alias-state-error-primary)',
        },
        inputDisabled: { opacity: 0.6, cursor: 'not-allowed' },
        installMessage: {
          margin: '8px 0 0',
          fontSize: 11,
          lineHeight: 1.55,
          color: 'var(--dsw-alias-label-tertiary)',
          overflowWrap: 'anywhere',
        },
        installError: { color: 'var(--dsw-alias-state-error-primary)' },
        installNote: { color: 'var(--dsw-alias-state-success-primary)' },
        listSection: { display: 'flex', flexDirection: 'column' },
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
        name: { fontWeight: 600 },
        nameButton: {
          border: 'none',
          background: 'none',
          padding: 0,
          margin: 0,
          color: 'var(--dsw-alias-label-primary)',
          font: 'inherit',
          fontWeight: 600,
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
        },
        nameButtonHover: { textDecoration: 'underline', textUnderlineOffset: 2 },
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
        selfNote: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
        empty: { padding: '30px 4px 26px' },
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
        hint: { margin: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-caption)' },
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

    function NameButton({ styles, t, plugin, openPackage }) {
      const [hover, setHover] = useState(false)
      const [focus, setFocus] = useState(false)
      if (openPackage === null) return h('span', { style: styles.name }, plugin.name)
      return h(
        'button',
        {
          type: 'button',
          style: {
            ...styles.nameButton,
            ...(hover ? styles.nameButtonHover : null),
            ...(focus ? styles.buttonFocus : null),
          },
          title: t('openBundle'),
          'aria-label': `${t('openBundle')}: ${plugin.name}`,
          onClick: () => openPackage(plugin.name),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onFocus: () => setFocus(true),
          onBlur: () => setFocus(false),
        },
        plugin.name,
      )
    }

    // ── 列表 ────────────────────────────────────────────────────────────────

    function makePluginRow(t, styles) {
      return function PluginRow({ plugin, state, store, openPackage }) {
        const [hover, setHover] = useState(false)
        const busy = state.busy[plugin.name] === true
        const busyAnywhere = updatingAnywhere(state)
        const note = state.notes[plugin.name]
        const update = canUpdate(plugin)
        const tags = []
        if (plugin.self === true) tags.push(h('span', { key: 'self', style: styles.tag }, t('thisPlugin')))
        else if (plugin.enabled === false) tags.push(h('span', { key: 'disabled', style: styles.tag }, t('disabled')))

        const commitNodes =
          plugin.pinned === true || plugin.state === 'pinned'
            ? h('span', { style: styles.commitPinned }, t('commitPinned', { commit: shortSha(plugin.installedCommit) }))
            : [
                h('span', { key: 'local-label', style: styles.commitLabel }, t('local')),
                h('code', { key: 'local-sha', style: styles.commitSha }, shortSha(plugin.installedCommit)),
                h('span', { key: 'arrow', style: styles.commitArrow, 'aria-hidden': 'true' }, '→'),
                h('span', { key: 'remote-label', style: styles.commitLabel }, t('remoteShort')),
                h('code', { key: 'remote-sha', style: styles.commitSha }, shortSha(plugin.remoteCommit)),
              ]

        let action = null
        if (plugin.self === true) {
          action = h('span', { style: styles.selfNote }, t('selfManaged'))
        } else if (plugin.state !== 'pinned') {
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
              h(NameButton, { styles, t, plugin, openPackage }),
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

    function makeTab(t, store, styles) {
      const PluginRow = makePluginRow(t, styles)
      return function GithubTab(props) {
        const state = useStore(store)
        useEnsureLoaded(store)
        const [input, setInput] = useState('')
        const [inputFocused, setInputFocused] = useState(false)
        const [installError, setInstallError] = useState(null)
        const [installNote, setInstallNote] = useState(null)
        const [watching, setWatching] = useState(false)
        const [watchToken, setWatchToken] = useState(0)
        const baselineRef = useRef(null)
        const inputRef = useRef(null)
        const openPackage = typeof props?.openPackage === 'function' ? props.openPackage : null
        const install = typeof props?.install === 'function' ? props.install : null

        useEffect(() => {
          store.ensureScanned()
        }, [store, state.loaded, state.loading, state.plugins.length, state.checkedAt, state.checking])

        useEffect(() => {
          if (!watching) return undefined
          const baseline = baselineRef.current
          if (baseline === null) {
            setWatching(false)
            return undefined
          }
          let cancelled = false
          let stopped = false
          const startedAt = Date.now()
          const timer = setInterval(async () => {
            if (cancelled || stopped) return
            await store.load()
            if (cancelled || stopped) return
            const current = store.snapshot().plugins
            if (signatureOf(current) !== baseline.signature) {
              stopped = true
              setWatching(false)
              setInstallNote(t('installDetected'))
              const added = current.find((plugin) => baseline.names.has(plugin.name) === false)
              if (added !== undefined) void store.check([added.name])
              return
            }
            if (Date.now() - startedAt > INSTALL_WATCH_MS) {
              stopped = true
              setWatching(false)
              setInstallNote(t('installTimeout'))
            }
          }, 2000)
          return () => {
            cancelled = true
            clearInterval(timer)
          }
        }, [watching, watchToken, store, t])

        function submitInstall(event) {
          if (event !== undefined) event.preventDefault()
          if (install === null) {
            setInstallError(t('installUnavailable'))
            return
          }
          if (state.loaded === false) {
            setInstallError(t('loading'))
            return
          }
          if (updatingAnywhere(state)) {
            setInstallError(t('installBusy'))
            return
          }
          const normalized = normalizeGithubInput(input)
          if (normalized.error !== undefined) {
            setInstallError(t(normalized.error))
            return
          }
          setInstallError(null)
          setInstallNote(t('installStarted'))
          store.clearUpdateError()
          baselineRef.current = {
            names: new Set(state.plugins.map((plugin) => plugin.name)),
            signature: signatureOf(state.plugins),
          }
          setWatching(true)
          setWatchToken((value) => value + 1)
          try {
            install({ spec: normalized.spec, title: normalized.label })
          } catch (error) {
            setWatching(false)
            setInstallNote(null)
            setInstallError(messageOf(error))
          }
        }

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
        const inputStyle = {
          ...styles.input,
          ...(inputFocused ? styles.inputFocus : null),
          ...(installError !== null ? styles.inputInvalid : null),
          ...(install === null ? styles.inputDisabled : null),
        }

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
          { style: styles.wrap, 'data-plugin-manager': 'tab' },
          h(
            'header',
            { style: styles.head },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('h2', { style: styles.title }, t('tab')),
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
              { style: styles.actions },
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
            ),
          ),
          h(
            'section',
            { style: styles.installSection, 'data-plugin-manager': 'install-panel' },
            h(
              'div',
              { style: styles.installHead },
              h('h3', { style: styles.installTitle }, t('installTitle')),
              h('p', { style: styles.installHint }, t('installHint')),
            ),
            h(
              'form',
              { style: styles.installForm, onSubmit: submitInstall, 'data-plugin-manager': 'install-form' },
              h('input', {
                ref: inputRef,
                type: 'text',
                value: input,
                placeholder: t('installPlaceholder'),
                'aria-label': t('installLabel'),
                'aria-invalid': installError !== null,
                'aria-describedby': 'dsh-plugin-manager-install-message',
                autoComplete: 'off',
                spellCheck: false,
                disabled: install === null,
                style: inputStyle,
                onChange: (event) => {
                  setInput(event.target.value)
                  if (installError !== null) setInstallError(null)
                  if (watching === false && installNote !== null) setInstallNote(null)
                },
                onFocus: () => setInputFocused(true),
                onBlur: () => setInputFocused(false),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.nativeEvent?.isComposing === true || event.isComposing === true)) {
                    event.preventDefault()
                  }
                },
              }),
              h(
                ControlButton,
                {
                  styles,
                  variant: 'primary',
                  type: 'submit',
                  disabled: install === null || busyAnywhere || state.loaded === false,
                  'data-plugin-manager': 'install-submit',
                },
                t('installAction'),
              ),
            ),
            installError !== null
              ? h('p', { id: 'dsh-plugin-manager-install-message', style: { ...styles.installMessage, ...styles.installError }, role: 'alert' }, installError)
              : installNote !== null
                ? h('p', { id: 'dsh-plugin-manager-install-message', style: { ...styles.installMessage, ...styles.installNote }, role: 'status' }, installNote)
                : install === null
                  ? h('p', { id: 'dsh-plugin-manager-install-message', style: { ...styles.installMessage, ...styles.installError } }, t('installUnavailable'))
                  : null,
          ),
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
                  'span',
                  { style: styles.errorText },
                  t('updateFailed', { name: state.updateError.name, message: state.updateError.text }),
                ),
                state.updateError.spec === null
                  ? null
                  : h(
                      ControlButton,
                      {
                        styles,
                        variant: 'secondary',
                        onClick: () => {
                          setInput(state.updateError.spec)
                          setInstallError(null)
                          setInstallNote(t('updateSpecFilled'))
                          inputRef.current?.focus?.()
                        },
                      },
                      t('updateRefill'),
                    ),
              ),
          h(
            'section',
            { style: styles.listSection },
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
                  ordered.map((plugin) => h(PluginRow, { key: plugin.name, plugin, state, store, openPackage })),
                )
              : null,
          ),
          h('p', { style: styles.hint }, t('hint')),
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
        if (plugin === undefined || plugin.self === true) return null
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
          h(
            'div',
            { style: styles.detailActions },
            plugin.self === true
              ? h('span', { style: styles.selfNote }, t('selfManaged'))
              : [
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
      normalizeGithubInput,
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
