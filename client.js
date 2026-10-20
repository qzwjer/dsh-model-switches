/**
 * Model Visibility — browser half.
 *
 * Contributes exactly one thing to the web shell: a compact switch inside every
 * provider card of Settings → Models that decides whether that provider's models
 * are offered in the composer's model picker.
 *
 * The filtering itself is the HOST half's job (it gates the catalog the picker
 * reads). This file only renders the control and persists the user's choice into
 * the host-owned settings namespace, so the two halves stay independently
 * replaceable and no client-side row filtering is needed.
 *
 * Hand-written DSH client bundle: no build step, no npm install, no TypeScript.
 * The envelope below is the module format the shell's `__ModuleLoader__` consumes
 * (the same shape every shipped `@deepseek-ai/dsh-client-*` bundle uses): the
 * script only REGISTERS a factory; the body runs on first materialization.
 *
 * `require` can resolve platform seed words only. The shell's `staticModules`
 * seed map carries react, react/jsx-runtime, react-dom, react-dom/client,
 * @deepseek-ai/cordis, zod, @tanstack/react-virtual,
 * @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots and
 * @deepseek-ai/dsh-client-ui-primitives — which is why the platform `Switch`
 * below is reachable without a build step, and why nothing else is imported:
 * every service this plugin needs arrives through `ctx`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-switches',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useCallback, useEffect, useLayoutEffect, useRef } = React

    // `react-dom` is a platform seed word (the shell's `staticModules` map), so a
    // portal needs no build step. Resolved defensively: without it the control
    // still renders inline, just on its own row.
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (typeof reactDom?.createPortal === 'function') createPortal = reactDom.createPortal
    } catch (error) {
      console.warn('model-visibility: react-dom portal unavailable, keeping the inline row', error)
    }

    // The platform switch primitive is a seed word, so it is normally reachable.
    // Resolved defensively anyway: a hand-written bundle must degrade to a plain
    // accessible checkbox rather than fail to mount the whole plugin if a future
    // shell trims its seed map.
    let Switch = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (typeof primitives?.Switch === 'function') Switch = primitives.Switch
    } catch (error) {
      console.warn('model-visibility: platform Switch unavailable, falling back to a native checkbox', error)
    }

    /** Dictionary namespace owned by this plugin (locale registry, not settings). */
    const NS = 'model-visibility'
    /** Host-owned settings namespace this plugin writes into. */
    const SETTINGS_NS = 'model-visibility'
    /** Field holding the provider ROUTE ids that are switched OFF. */
    const FIELD = 'hiddenProviders'
    /** Field holding `<route>\0<modelId>` keys switched off one by one. */
    const FIELD_MODELS = 'hiddenModels'
    /** Separator inside one `hiddenModels` entry (model ids carry no NUL). */
    const KEY_SEP = '\u0000'
    /** The Models page's keyed extension seat, dispatched with entryKey = settingsNs. */
    const SLOT = 'settings.models.provider-card'
    /**
     * Provider settings namespaces known before `settings.describe()` answers.
     * The keyed seat is dispatched per `settingsNs`, so one registration per
     * adapter family is required; further namespaces are added dynamically from
     * the describe view as soon as it arrives.
     */
    const KNOWN_NAMESPACES = ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']

    /**
     * Required services (cordis fiber inject). `remote.settings` is a Remote
     * namespace, not a plain property of `remote`, so it is declared explicitly —
     * exactly what the shipped Models page declares for its own writes.
     */
    const inject = ['slots', 'locale', 'remote', 'remote.settings']

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'toggle.label': '在对话框可选模型中显示',
        'toggle.aria': '在对话框可选模型中显示 {provider}',
        'toggle.hint': '关闭后，该提供商的模型不再出现在对话框的模型选择器中，也不能被新选中；若某个会话当前正使用该提供商的模型，请先切换模型。',
        'toggle.unavailable': '宿主设置命名空间尚未就绪，暂时无法切换。',
        'toggle.readonly': '当前配置只读，无法修改。',
        'toggle.failed': '保存失败：{message}',
        'toggle.failedPlain': '保存失败，请重试。',
        'model.aria': '在对话框可选模型中显示模型 {model}',
        'model.hint': '关闭后，仅这一个模型不出现在对话框的模型选择器中；该厂商的其它模型不受影响。',
      },
      en: {
        'toggle.label': 'Show in composer model picker',
        'toggle.aria': 'Show {provider} in the composer model picker',
        'toggle.hint': 'When off, this provider’s models are no longer offered in the composer model picker and cannot be newly selected. If a session is currently using one of them, switch that session to another model first.',
        'toggle.unavailable': 'The host settings namespace is not ready yet, so this cannot be toggled.',
        'toggle.readonly': 'This configuration is read-only.',
        'toggle.failed': 'Could not save: {message}',
        'toggle.failedPlain': 'Could not save. Please try again.',
        'model.aria': 'Show model {model} in the composer model picker',
        'model.hint': 'When off, only this model is withheld from the composer model picker; the provider’s other models are unaffected.',
      },
    }

    /** Stylesheet. Theme tokens only, so the row survives a colour-scheme switch. */
    const CSS = [
      // Portalled into the card's 编辑/删除 row: one compact cluster after the buttons.
      '.dmv_inlineRow{display:inline-flex;align-items:center;gap:6px;margin-left:6px;padding-left:10px;border-left:.5px solid var(--dsw-alias-settings-card-stroke);height:28px}',
      '.dmv_inlineLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}',
      // The anchor holds the slot open so the action row can be re-resolved after
      // a page re-render; it contributes no box of its own.
      '.dmv_anchor{display:none}',
      '.dmv_foot{display:flex;flex-direction:column;gap:2px}',
      // Fallback form, used only when react-dom's portal is unavailable.
      '.dmv_root{display:flex;flex-direction:column;gap:4px}',
      '.dmv_head{display:flex;align-items:center;gap:10px}',
      '.dmv_label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}',
      '.dmv_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}',
      '.dmv_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}',
      '.dmv_native{margin:0;cursor:pointer;accent-color:var(--dsw-alias-state-business-primary)}',
      '.dmv_native:disabled{cursor:default;opacity:.4}',
      // Per-model switch: a compact trailing cell inside one model row.
      //
      // The row is a CSS grid with exactly four columns
      // (`minmax(0,1.4fr) minmax(0,1fr) auto auto`: id, name, options, remove).
      // Our mount is a fifth child, so without a fifth column track the grid
      // wraps it onto a second line and the switch floats under the row.
      //
      // The override is written as `!important` on a `:has()`-qualified class
      // match rather than `:where()`: `:where()` contributes zero specificity, so
      // the page's own `.hash_modelRow` rule beat it and the extra track never
      // applied. This selector restates the page's four tracks verbatim and adds
      // exactly one, so untouched rows (which lack the `:has()` match) keep the
      // page's own layout.
      '.dmv_modelMount{display:inline-flex;align-items:center;justify-content:center;margin-left:2px;padding-left:6px;border-left:.5px solid var(--dsw-alias-settings-card-stroke)}',
      '.dmv_modelRow{display:inline-flex;align-items:center;gap:4px}',
      'div:has(> .dmv_modelMount){grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto auto !important}',
    ].join('')

    /**
     * Find the provider card's action cluster (the row holding 编辑 / 删除) from
     * inside our own slot content.
     *
     * The Models page does not expose an actions seat, so the switch is portalled
     * into that row's DOM. Class names there are CSS-module hashes that change
     * between builds, so they are never matched.
     *
     * The search is purely STRUCTURAL: walk up to the card `<li>`, take its first
     * element child (the header row), and return that row's last element child —
     * the action cluster, which the page pushes right with `margin-left:auto`.
     *
     * Computed style is deliberately NOT consulted. `getComputedStyle(el).marginLeft`
     * reports the RESOLVED pixel value in a real browser (`186px`, not `auto`), so
     * matching on `"auto"` only ever works in a layout-less DOM like jsdom — it
     * silently fell through to the fallback branch in the real app.
     *
     * @param node - any DOM node inside our slot content.
     * @returns the action cluster element, or null when the layout is unfamiliar.
     */
    function findActionRow(node) {
      let card = node
      // Up to the card. Our slot anchor is `display:contents` and several wrappers
      // (the outlet anchor, React's own nodes) may sit between, so climb until the
      // first list item rather than assuming a fixed depth.
      while (card !== null && card !== undefined) {
        if (card.nodeType === 1 && card.tagName === 'LI') break
        card = card.parentElement
      }
      if (card === null || card === undefined || card.tagName !== 'LI') return null

      // The header row is the card's first child that is not our own content and
      // not another slot anchor.
      let head = null
      for (const child of card.children) {
        if (child === node || child.contains?.(node)) continue
        if (child.hasAttribute?.('data-slot') === true) continue
        head = child
        break
      }
      if (head === null) return null
      // Its last element child is the action cluster (编辑 / 删除). A card with a
      // single identity child has no action cluster yet.
      const actions = head.lastElementChild
      if (actions === null || actions === head) return null
      return actions
    }

    /**
     * Park a stable mount point at the end of the action row and portal into it.
     *
     * A dedicated child node (rather than the action row itself) keeps React from
     * fighting the page's own children, and lets the two buttons keep their order
     * while the switch sits after them.
     *
     * @param host - the element returned by `findActionRow`.
     * @returns the mount point to portal into.
     */
    function mountPointIn(host) {
      const existing = host.querySelector(':scope > .dmv_mount')
      if (existing !== null) return existing
      const mount = document.createElement('span')
      mount.className = 'dmv_mount'
      host.appendChild(mount)
      return mount
    }

    /**
     * Minimal snapshot store: the shell already ships one, but reaching it would
     * mean another seed require for no benefit here.
     * @param initial - first snapshot.
     * @returns get/subscribe/set trio.
     */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          if (next === snapshot) return
          snapshot = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.error('model-visibility: store listener failed', error)
            }
          }
        },
      }
    }

    /** Message text of a thrown value. */
    function describeError(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** Read the persisted hidden-route list out of one namespace view. */
    function hiddenFrom(view) {
      const raw = view?.value?.[FIELD] ?? view?.user?.[FIELD] ?? view?.base?.[FIELD]
      if (!Array.isArray(raw)) return []
      return [...new Set(raw.filter(id => typeof id === 'string'))]
    }

    /** Read the persisted hidden-model key list out of one namespace view. */
    function hiddenModelsFrom(view) {
      const raw = view?.value?.[FIELD_MODELS] ?? view?.user?.[FIELD_MODELS] ?? view?.base?.[FIELD_MODELS]
      if (!Array.isArray(raw)) return []
      return [...new Set(raw.filter(id => typeof id === 'string'))]
    }

    /** Compose the `hiddenModels` entry for one provider+model pair. */
    function modelKey(route, modelId) {
      return route + KEY_SEP + modelId
    }

    /** Compare two route lists as sets (order is not meaningful here). */
    function sameSet(left, right) {
      return left.length === right.length && left.every(id => right.includes(id))
    }

    // ── settings bridge ───────────────────────────────────────────────────────
    /**
     * Read/write the host-owned settings namespace over the Remote RPC the
     * shipped Models page itself uses:
     *   describe() -> { ok, value: { writable, hasDocument, namespaces: [...] } }
     *   mutate(ns, ops, expectedRevision) -> { ok, value: SettingsNamespaceView }
     *                                       | { ok: false, error: { code, message } }
     * Writes carry the namespace revision, so a concurrent change is refused as
     * `settings/conflict` instead of being silently overwritten.
     * @param ctx - client root context.
     * @returns store plus refresh/toggle operations.
     */
    function createVisibility(ctx) {
      const store = createStore({
        status: 'loading',
        hidden: [],
        hiddenModels: [],
        revision: undefined,
        writable: true,
        namespaces: [],
        error: null,
      })

      /** Serialize writes so two cards toggled quickly cannot lose each other. */
      let tail = Promise.resolve()
      /** Coalesce overlapping describe reads. */
      let inFlight
      let rerun = false
      /**
       * Outstanding writes of our own whose `settings/document-updated` echo must
       * be ignored. The mutate answer already carries the resulting view, so
       * re-describing on the echo is a wasted round trip — and, more visibly, it
       * republishes the store and re-renders every card for no reason.
       */
      let suppressEcho = 0

      const publishView = view => {
        const before = store.getSnapshot()
        const hidden = hiddenFrom(view)
        const hiddenModels = hiddenModelsFrom(view)
        // Publish only on a REAL change. Every mutation echoes back as
        // `settings/document-updated`, which re-runs describe; without this guard
        // each echo republishes an identical snapshot, re-rendering every provider
        // card and re-running its layout effects — the visible flicker when a
        // switch is clicked.
        if (
          before.status === 'ready' &&
          before.revision === view?.revision &&
          sameSet(before.hidden, hidden) &&
          sameSet(before.hiddenModels, hiddenModels)
        ) {
          return
        }
        store.set({
          ...before,
          status: 'ready',
          hidden,
          hiddenModels,
          revision: view?.revision,
          error: null,
        })
      }

      const publishDocument = doc => {
        const namespaces = Array.isArray(doc?.namespaces) ? doc.namespaces : []
        const names = namespaces.map(view => view?.ns).filter(ns => typeof ns === 'string')
        const view = namespaces.find(candidate => candidate?.ns === SETTINGS_NS)
        const writable = doc?.writable !== false
        if (view === undefined) {
          // The host row is not mounted (or its Config declares no volatile field
          // yet), so this namespace is absent from describe. Surface that instead
          // of writing into a namespace nothing owns.
          const before = store.getSnapshot()
          if (before.status === 'unavailable' && sameSet(before.namespaces, names)) return
          store.set({
            status: 'unavailable',
            hidden: [],
            hiddenModels: [],
            revision: undefined,
            writable,
            namespaces: names,
            error: null,
          })
          return
        }
        const before = store.getSnapshot()
        const hidden = hiddenFrom(view)
        const hiddenModels = hiddenModelsFrom(view)
        if (
          before.status === 'ready' &&
          before.revision === view.revision &&
          before.writable === writable &&
          sameSet(before.hidden, hidden) &&
          sameSet(before.hiddenModels, hiddenModels) &&
          sameSet(before.namespaces, names)
        ) {
          return
        }
        store.set({
          status: 'ready',
          hidden,
          hiddenModels,
          revision: view.revision,
          writable,
          namespaces: names,
          error: null,
        })
      }

      const read = async () => {
        try {
          const response = await ctx.remote.settings.describe()
          if (response?.ok) {
            publishDocument(response.value)
            return
          }
          const before = store.getSnapshot()
          store.set({
            ...before,
            status: before.status === 'ready' ? 'ready' : 'error',
            error: response?.error?.message ?? 'settings.describe was refused',
          })
        } catch (error) {
          const before = store.getSnapshot()
          store.set({
            ...before,
            status: before.status === 'ready' ? 'ready' : 'error',
            error: describeError(error),
          })
        }
      }

      /** Re-read the document, folding concurrent requests into one round trip. */
      const refresh = () => {
        if (inFlight !== undefined) {
          rerun = true
          return inFlight
        }
        inFlight = (async () => {
          try {
            do {
              rerun = false
              await read()
            } while (rerun)
          } finally {
            inFlight = undefined
          }
        })()
        return inFlight
      }

      /**
       * Refresh in response to a host push, skipping our own write echoes.
       *
       * A mutation always comes back as `settings/document-updated`; the mutate
       * response already published the new view, so re-reading on that echo only
       * costs a round trip and re-renders the cards.
       * @returns resolution once any needed read settled.
       */
      const refreshFromHost = () => {
        if (suppressEcho > 0) {
          suppressEcho -= 1
          return Promise.resolve()
        }
        return refresh()
      }

      /** Whether the first read has been started (the plugin is lazy). */
      let started = false
      /**
       * Mark that something now wants the state, and start the first read once.
       *
       * Called from the seat's first render and from host pushes. Until either
       * happens the plugin performs no RPC at all, so a user who never opens
       * Settings → Models never pays for a second full-document settings read
       * during app startup.
       * @returns resolution of the first read when it was just started.
       */
      const markInterested = () => {
        if (started) return undefined
        started = true
        return refresh()
      }

      /**
       * Apply the requested visibility for one route, retrying once after a
       * revision conflict (the retry re-reads so it merges the concurrent change
       * instead of clobbering it).
       * @param field - which hidden list this write targets.
       * @param key - the entry to add or remove.
       * @param visible - desired visibility.
       * @param attempt - retry counter.
       * @returns settlement with a message when the host refused.
       */
      const commit = async (field, key, visible, attempt) => {
        const state = store.getSnapshot()
        const current = field === FIELD ? state.hidden : state.hiddenModels
        const next = visible ? current.filter(id => id !== key) : [...current.filter(id => id !== key), key]
        let response
        try {
          // Mark the pending write so the `settings/document-updated` echo it
          // provokes is ignored: the mutate answer already carries the new view,
          // so re-describing would be a wasted round trip that republishes state
          // and re-renders every card.
          suppressEcho += 1
          response = await ctx.remote.settings.mutate(
            SETTINGS_NS,
            [{ op: 'set', path: [field], value: next }],
            state.revision,
          )
        } catch (error) {
          suppressEcho = Math.max(0, suppressEcho - 1)
          return { ok: false, message: describeError(error) }
        }
        // The echo may arrive after the promise settles; leave the count to decay
        // on the next refresh rather than racing it here.
        if (response?.ok !== true) suppressEcho = Math.max(0, suppressEcho - 1)
        if (response?.ok) {
          publishView(response.value)
          return { ok: true }
        }
        if (response?.error?.code === 'settings/conflict' && attempt < 1) {
          await refresh()
          return commit(field, key, visible, attempt + 1)
        }
        return { ok: false, message: response?.error?.message ?? '' }
      }

      /**
       * Toggle one entry optimistically: local state flips now, the write settles
       * later, and a refusal reverts the flip.
       * @param field - which hidden list this write targets.
       * @param key - the entry to add or remove.
       * @param visible - desired visibility.
       * @returns settlement with a message when the write failed.
       */
      const toggle = (field, key, visible) => {
        const before = store.getSnapshot()
        const slot = field === FIELD ? 'hidden' : 'hiddenModels'
        const current = before[slot]
        const optimistic = visible
          ? current.filter(id => id !== key)
          : [...current.filter(id => id !== key), key]
        store.set({ ...before, [slot]: optimistic })

        const task = () => commit(field, key, visible, 0)
        const run = tail.then(task, task)
        tail = run.then(
          () => undefined,
          () => undefined,
        )
        return run.then(outcome => {
          if (!outcome.ok) {
            const latest = store.getSnapshot()
            // Revert only when no newer optimistic change superseded this one.
            if (sameSet(latest[slot], optimistic)) store.set({ ...latest, [slot]: before[slot] })
          }
          return outcome
        })
      }

      /** Toggle one provider route wholesale. */
      const setVisible = (route, visible) => toggle(FIELD, route, visible)

      /** Toggle one model inside a provider. */
      const setModelVisible = (route, modelId, visible) => toggle(FIELD_MODELS, modelKey(route, modelId), visible)

      return { store, refresh, refreshFromHost, markInterested, setVisible, setModelVisible }
    }

    // ── switch row ────────────────────────────────────────────────────────────
    /** Subscribe to a store snapshot (React 18 path, with a pre-18 fallback). */
    function useStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      }
      const [snapshot, setSnapshot] = useState(store.getSnapshot)
      useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store])
      return snapshot
    }

    /**
     * The row rendered inside one provider card.
     *
     * Owner props come from the Models page's `renderSlot` call:
     *   { provider, configured, keyConfigured }
     * where `provider` is the joined directory row and `provider.provider` is the
     * provider ROUTE id — the same id the model picker groups by and the id the
     * host half filters on. `t` is the locale seat and `vis` is this plugin's
     * injected settings bridge.
     * @param props - composed slot props.
     * @returns the labelled switch, or null when the row carries no route id.
     */
    function ProviderVisibilitySwitch(props) {
      const { provider, t, vis } = props
      const state = useStore(vis.store)
      const [failure, setFailure] = useState(null)

      // The Models page just mounted a seat, so the user IS on Settings → Models:
      // start the plugin's first read now (a no-op after the first time). This is
      // what keeps the plugin lazy at app startup while still having the state on
      // the first paint of the page.
      useEffect(() => {
        void vis.markInterested()
      }, [vis])

      const route = typeof provider?.provider === 'string' ? provider.provider : undefined
      const displayName = typeof provider?.displayName === 'string' ? provider.displayName : route

      const onChange = useCallback(
        next => {
          setFailure(null)
          void vis.setVisible(route, next).then(outcome => {
            if (!outcome.ok) setFailure(outcome.message)
          })
        },
        [vis, route],
      )

      // Portal target: the card's 编辑/删除 row, resolved after layout because the
      // page's DOM only exists once this component has mounted.
      const rootRef = useRef(null)
      const [mount, setMount] = useState(null)
      useLayoutEffect(() => {
        if (createPortal === null) return undefined
        const resolve = () => {
          const node = rootRef.current
          // After `route` becomes undefined the component renders null, so the
          // anchor is gone and there is nothing to resolve against.
          if (node === null) return
          const actions = findActionRow(node)
          setMount(actions === null ? null : mountPointIn(actions))
        }
        resolve()
        // Provider cards are re-rendered by the page (editor open/close, add flow),
        // which can replace the action row. Re-resolve when that happens, but stop
        // as soon as the target is gone for good.
        const observer = new MutationObserver(() => {
          if (mount !== null && mount.isConnected) return
          resolve()
        })
        const card = rootRef.current?.closest?.('li')
        if (card !== null && card !== undefined) {
          observer.observe(card, { childList: true, subtree: true })
        }
        return () => observer.disconnect()
      }, [mount])

      // Per-model switches: the provider editor is rendered inline by the page
      // when 编辑 is open, so its model rows are discovered after layout and
      // re-discovered whenever the card subtree changes (rows added/removed, the
      // editor opened/closed, or — importantly — rows REPLACED by a re-render).
      const [modelSlots, setModelSlots] = useState([])
      useLayoutEffect(() => {
        if (createPortal === null || route === undefined) return undefined
        const sync = () => {
          const card = rootRef.current?.closest?.('li')
          if (card === null || card === undefined) return
          const next = []
          for (const row of findModelRows(card)) {
            const id = modelIdOf(row)
            if (id === undefined) continue
            next.push({ mount: modelMountIn(row), modelId: id })
          }
          // Compare the MOUNT NODES, not just the model ids. React portals hold a
          // direct reference to their container, so when the page re-renders and
          // swaps the rows for fresh DOM elements the ids stay the same but the
          // portals would keep writing into detached nodes — the switches vanish.
          setModelSlots(current => {
            const same =
              current.length === next.length &&
              current.every((item, index) => item.modelId === next[index].modelId && item.mount === next[index].mount)
            return same ? current : next
          })
        }
        sync()
        const card = rootRef.current?.closest?.('li')
        if (card === null || card === undefined) return undefined
        const observer = new MutationObserver(sync)
        observer.observe(card, { childList: true, subtree: true })
        return () => observer.disconnect()
      }, [route])

      // Every hook above runs unconditionally, so this early return is safe: it
      // is the LAST thing before rendering and never changes the hook count.
      // `route` is derived from the seat's owner props and is fixed for the
      // lifetime of one registration, so in practice it never flips.
      if (route === undefined) return null

      const tr = (key, params) => {
        if (typeof t !== 'function') return DICT.en[key] ?? key
        const text = t(key, params)
        return typeof text === 'string' && text !== key ? text : (DICT.en[key] ?? key)
      }

      const unavailable = state.status === 'unavailable'
      const loading = state.status === 'loading'
      const readOnly = state.writable === false
      const disabled = unavailable || loading || readOnly
      const visible = !state.hidden.includes(route)
      const label = tr('toggle.label')
      const aria = tr('toggle.aria', { provider: displayName ?? route })
      const hint = tr('toggle.hint')

      const control =
        Switch !== null
          ? h(Switch, { checked: visible, label: aria, title: hint, disabled, onChange })
          : h('input', {
              type: 'checkbox',
              className: 'dmv_native',
              checked: visible,
              disabled,
              'aria-label': aria,
              title: hint,
              onChange: event => onChange(event.target.checked),
            })

      const note = unavailable
        ? tr('toggle.unavailable')
        : readOnly
          ? tr('toggle.readonly')
          : null

      // One error line at most: the host's diagnostic when it sent one, otherwise
      // the generic retry copy.
      const errorLine =
        failure === null
          ? null
          : h(
              'p',
              { className: 'dmv_error', role: 'status' },
              failure === '' ? tr('toggle.failedPlain') : tr('toggle.failed', { message: failure }),
            )

      const inline = h('div', { className: 'dmv_inline' }, control)

      // Per-model portals: one switch per row of THIS provider's model catalog.
      const modelPortals =
        modelSlots.length === 0
          ? null
          : modelSlots.map(slot =>
              createPortal(
                h(ModelVisibilitySwitch, { key: slot.modelId, route, modelId: slot.modelId, vis, t }),
                slot.mount,
                slot.modelId,
              ),
            )

      // Portalled form: the switch joins the 编辑/删除 row. The platform Switch
      // already renders its own `label` text, so the row adds no copy of its own
      // — only the native-checkbox fallback needs a visible label beside it.
      if (mount !== null) {
        return h(
          React.Fragment,
          null,
          h('div', { ref: rootRef, className: 'dmv_anchor' }),
          createPortal(
            h(
              'span',
              { className: 'dmv_inlineRow', title: hint },
              Switch === null ? h('span', { className: 'dmv_inlineLabel' }, label) : null,
              control,
            ),
            mount,
          ),
          modelPortals,
          errorLine === null ? null : h('div', { className: 'dmv_foot' }, h('div', { className: 'dmv_errorRow' }, errorLine)),
          note === null ? null : h('p', { className: 'dmv_note dmv_foot' }, note),
        )
      }

      return h(
        'div',
        { ref: rootRef, className: 'dmv_root' },
        h('div', { className: 'dmv_head' }, h('span', { className: 'dmv_label' }, label), inline),
        modelPortals,
        errorLine,
        note === null ? null : h('p', { className: 'dmv_note' }, note),
      )
    }

    // ── per-model switches inside the provider editor ─────────────────────────
    /**
     * Find the provider editor's model rows.
     *
     * The editor is NOT a slot: it is rendered inline by the Models page when the
     * user opens 编辑, and it exposes no extension seat. So its model rows are
     * located structurally, exactly like the card's action row:
     *
     *   <section aria-label="<models>">            the model catalog block
     *     <div>                                     head (title / reset)
     *     <div>                                     model list
     *       <div class="…modelEntry">               one model
     *         <div class="…modelRow">               id / name inputs + 2 buttons
     *
     * The catalog section is found by its `aria-label` matching the editor's own
     * "models" heading text, and each row by "the row div's last child is a
     * button" — no hashed class names.
     *
     * @param scope - an element containing the editor.
     * @returns the model row elements, in document order.
     */
    function findModelRows(scope) {
      const rows = []
      const sections = scope.querySelectorAll('section[aria-label]')
      for (const section of sections) {
        // The catalog block is the section whose rows each carry a trailing
        // button (the remove-model trash). Other sections in the editor are
        // single fields and match nothing.
        const candidates = section.querySelectorAll('div')
        for (const div of candidates) {
          if (div.querySelector('input[type="text"]') === null) continue
          // A model row's action buttons are its last REAL children. Our own
          // mount point may already be appended after them, so the trailing
          // run of non-mount children is what gets inspected — otherwise a row
          // that already carries a mount would stop looking like a row, the
          // next sync would report zero rows, and the switches would be torn
          // out again by our own append (an oscillating self-inflicted loop).
          const tail = [...div.children].filter(child => !child.classList.contains('dmv_modelMount'))
          if (tail.length === 0) continue
          const last = tail[tail.length - 1]
          if (last.tagName !== 'BUTTON') continue
          // Only the immediate row wrapper, not an ancestor that happens to hold
          // the same descendants.
          const nested = [...div.querySelectorAll('div')].some(
            inner => inner.lastElementChild?.tagName === 'BUTTON' && inner.querySelector('input[type="text"]') !== null,
          )
          if (nested) continue
          rows.push(div)
        }
        if (rows.length > 0) break
      }
      return rows
    }

    /**
     * Read the model id out of one row's first text input.
     * @param row - the model row element.
     * @returns the trimmed id, or undefined when the field is empty.
     */
    function modelIdOf(row) {
      const input = row.querySelector('input[type="text"]')
      if (input === null) return undefined
      const value = typeof input.value === 'string' ? input.value.trim() : ''
      return value.length === 0 ? undefined : value
    }

    /**
     * Attach (idempotently) one mount point to the end of a model row.
     * @param row - the model row element.
     * @returns the mount point.
     */
    function modelMountIn(row) {
      const existing = row.querySelector(':scope > .dmv_modelMount')
      if (existing !== null) return existing
      const mount = document.createElement('span')
      mount.className = 'dmv_modelMount'
      row.appendChild(mount)
      return mount
    }

    /**
     * One switch for one model inside a provider's model catalog.
     *
     * Visibility here is INDEPENDENT of the provider switch: a provider can stay
     * on while individual models are hidden. Hiding every model of a provider is
     * deliberately ignored by the host (it would empty the provider), so the UI
     * never leaves the user with a silently empty vendor.
     *
     * @param props - { route, modelId, vis, t }.
     * @returns the compact switch.
     */
    function ModelVisibilitySwitch(props) {
      const { route, modelId, vis, t } = props
      const state = useStore(vis.store)
      const [failure, setFailure] = useState(null)

      const onChange = useCallback(
        next => {
          setFailure(null)
          void vis.setModelVisible(route, modelId, next).then(outcome => {
            if (!outcome.ok) setFailure(outcome.message)
          })
        },
        [vis, route, modelId],
      )

      const tr = (key, params) => {
        if (typeof t !== 'function') return DICT.en[key] ?? key
        const text = t(key, params)
        return typeof text === 'string' && text !== key ? text : (DICT.en[key] ?? key)
      }

      const unavailable = state.status === 'unavailable'
      const readOnly = state.writable === false
      const disabled = unavailable || state.status === 'loading' || readOnly
      const key = modelKey(route, modelId)
      const visible = !state.hiddenModels.includes(key)
      const aria = tr('model.aria', { model: modelId })
      const hint = failure === null ? tr('model.hint') : tr('toggle.failed', { message: failure })

      const control =
        Switch !== null
          ? h(Switch, { checked: visible, label: aria, title: hint, disabled, onChange })
          : h('input', {
              type: 'checkbox',
              className: 'dmv_native',
              checked: visible,
              disabled,
              'aria-label': aria,
              title: hint,
              onChange: event => onChange(event.target.checked),
            })

      return h('span', { className: 'dmv_modelRow', title: hint }, control)
    }

    // ── registration ──────────────────────────────────────────────────────────
    /**
     * Register the dictionary, the stylesheet, the settings refreshers and one
     * keyed contribution per provider settings namespace.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'model-visibility: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-model-switches')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'model-visibility: styles')

      const vis = createVisibility(ctx)

      ctx.effect(() => {
        // No eager read here. `settings.describe()` returns the WHOLE settings
        // document, and the Models page issues the same call on its own first
        // mount; doing it at plugin activation would add a second full-document
        // read to the app's startup burst for a page the user may never open.
        // The first read is instead triggered by the seat's first render (see
        // `ensureLoaded` below) and by any host push, whichever comes first.
        const disposers = [
          ctx.remote.$on('settings/document-updated', () => {
            // A push means the document exists and may concern us, so this is the
            // one case where a still-idle plugin should read.
            vis.markInterested()
            void vis.refreshFromHost()
          }),
          ctx.on('connection/reset', () => {
            void vis.refresh()
          }),
        ]
        return () => {
          for (const dispose of disposers) dispose()
        }
      }, 'model-visibility: settings refreshers')

      // `slots.inject` waits for the Models section to declare the seat, so this
      // registration survives that plugin loading later (or reloading) without
      // the plugin ever registering into an undeclared slot.
      ctx.slots.inject(SLOT, () => {
        const disposers = []
        const registeredKeys = new Set()

        const ensure = namespace => {
          if (typeof namespace !== 'string' || namespace === '' || registeredKeys.has(namespace)) return
          // Register a seat for every served namespace: the seat is keyed by
          // `settingsNs`, so a namespace that never hosts a provider card simply
          // never dispatches and renders nothing. Doing it this way keeps renamed
          // Loader entry ids (which ARE the settingsNs) working without a code
          // change — the `KNOWN_NAMESPACES` list only covers the window before
          // `settings.describe()` answers.
          registeredKeys.add(namespace)
          try {
            disposers.push(
              ctx.slots.register(
                {
                  name: SLOT,
                  key: namespace,
                  locale: NS,
                  inject: () => ({ vis }),
                },
                ProviderVisibilitySwitch,
              ),
            )
          } catch (error) {
            registeredKeys.delete(namespace)
            console.error(`model-visibility: could not register the provider-card seat for "${namespace}"`, error)
          }
        }

        const sync = () => {
          for (const namespace of KNOWN_NAMESPACES) ensure(namespace)
          for (const namespace of vis.store.getSnapshot().namespaces) ensure(namespace)
        }

        const unsubscribe = vis.store.subscribe(sync)
        sync()

        return () => {
          unsubscribe()
          for (const dispose of disposers) dispose()
        }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
