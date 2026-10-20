# NOTES-client — the browser half of `dsh-model-switches`

Owner: client-half (task-2). Files owned here: `client.js`, this file.
The host half (`index.js`, `package.json`, `cordis.patch.yml`, `NOTES-host.md`) belongs
to the host-half teammate.

`NOTES-host.md` did not exist when this half was finished, so the contract below is
the one the Lead specified on the shared channel — **ns `model-visibility`, field
`hiddenProviders: string[]` holding the provider ROUTE ids that are switched OFF,
default `[]` (everything visible)**. If the host half ends up using a different
namespace or field name, only the two constants `SETTINGS_NS` and `FIELD` at the top
of `client.js` need to change; nothing else in the bundle hard-codes them.

---

## 1. What the bundle does

One contribution: a compact labelled switch inside **every provider card** of
Settings → Models. ON = that provider's models are offered in the composer's model
picker; OFF = hidden. The filtering itself is the host half's job (it gates the
catalog the picker reads). This half only renders the control and persists the
choice, so the two halves stay independently replaceable and no client-side row
filtering exists anywhere.

## 2. Module format — verified, not assumed

`client.js` is a hand-written **DSH client bundle**, not ESM:

```js
window.__ModuleLoader__.load({ id: 'dsh-model-switches', factory: require => { ... return module.exports } })
```

Verified against the installed runtime:

- `@deepseek-ai/dsh-client-modules/lib/client.js` (browser half) — the loader
  registers factories and materializes them lazily; a factory returns
  `module.exports`, and the plugin exports `apply` + `inject`.
- Every shipped bundle in
  `.dsh-plugin-scratch/asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`
  uses exactly this envelope (e.g. `dsh-client-ui-deepseek-model-label-1017`, 75 lines,
  hand-readable).
- The proven *hand-written* (no build step) example in this profile is
  `C:\Users\feiyi\.dsh\profiles\desktop\node_modules\dsh-our-free-model\client.js` —
  same envelope, `exports.apply` / `exports.inject`, `ctx.slots.inject(...)`,
  `ctx.locale.register(...)`.

`require` may only resolve **platform seed words**. The shell's seed map is literal in
the frontend bundle
(`dsh-web-frontend/dist/assets/index-*.js`, function returning `staticModules`):

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod,
@tanstack/react-virtual, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

`client.js` requires exactly **`react`** and **`@deepseek-ai/dsh-client-ui-primitives`**.
Everything else arrives through `ctx`. (The primitives `require` is wrapped in
`try/catch` and falls back to a native `<input type="checkbox">`, so a shell with a
trimmed seed map degrades instead of failing to mount.)

## 3. Slot used

| | |
|---|---|
| slot | `settings.models.provider-card` |
| declared by | `@deepseek-ai/dsh-client-ui-settings-models` (its `settings.section` registration `children`) |
| kind | `keyed`, `scope: "root"` |
| `entryKey` | **`settingsNs`** — the *owning adapter's settings entry id*, not the provider id |
| where it renders | inside every card that shows a directory row: a saved row's card, its first-run setup posture, and the add-provider draft |
| declared in | `lib/client.js` line ~4492 (`"settings.models.provider-card": { kind: "keyed", scope: "root" }`), dispatched at lines ~2541, ~2616, ~2725 |

Registration (from `apply`):

```js
ctx.slots.inject('settings.models.provider-card', () => {
  // ...one register() per provider settings namespace
  ctx.slots.register(
    { name: 'settings.models.provider-card', key: namespace, locale: NS, inject: () => ({ vis }) },
    ProviderVisibilitySwitch,
  )
})
```

`slots.inject` is mandatory: registering into an undeclared slot throws
(`slot "…" is not declared (a parent entry's children table must declare it)` —
verified in the shell's `SlotCore.register`), and `inject` waits for the declaration,
so load order between this plugin and the Models page does not matter.

**Why one registration per namespace.** The seat is *keyed* and dispatched with
`entryKey = settingsNs`, and `SlotCore.register` rejects a duplicate `(key, priority)`
pair. So a single registration cannot cover every card. The bundle registers:

- the three namespaces known up front (`KNOWN_NAMESPACES`):
  `llm-pi-ai`, `llm-deepseek`, `llm-deepseek-account`. Every adapter derives this
  value the same way — `settingsNs: ctx.fiber.entry?.options.id ?? "<package NS>"`
  (`dsh-llm-pi-ai/lib/index.js` line ~2864,
  `dsh-llm-deepseek-account/lib/index.js` line ~509,
  `dsh-llm-deepseek-api-key/lib/index.js` line ~55) — so it is the **Loader entry
  id**, which is *not* always the package name. Concretely, this profile's
  `cordis.patch.yml` mounts the api-key adapter as
  `{ id: llm-deepseek, name: "@deepseek-ai/dsh-llm-deepseek-api-key" }`, so its
  `settingsNs` is `llm-deepseek` and that is the key the seat must use. The
  `?? "<package NS>"` fallback only applies to a row with no entry id;
- plus **every namespace the settings document reports**, added as
  `settings.describe()` answers. This is deliberate: a renamed Loader entry id is
  still a valid `settingsNs`, and this half should not need a code change for it.
  Namespaces that never host a provider card simply never dispatch and render
  nothing.

## 4. Props actually observed

The Models page calls `renderSlot('settings.models.provider-card', ownerProps, { entryKey })`
with these **owner props** (verified at all three call sites):

```ts
{
  provider: ConfigurableProviderView   // the joined directory row
  configured: boolean                  // the row's configured state
  keyConfigured: boolean               // confirmed api-key credential state
}
```

`provider` is the *joined* row built by `joinProviderDirectory`
(`dsh-client-ui-settings-models/lib/client.js` line ~1196), so it carries:

```ts
{
  provider: string        // <-- THE PROVIDER ROUTE ID (e.g. 'sensenova', 'ark', 'deepseek-official')
  displayName: string
  settingsNs: string      // 'llm-pi-ai' | 'llm-deepseek' | 'llm-deepseek-account' | ...
  settingsPath: string[]  // [] when the whole section is the profile
  active: boolean
  declared?, defaultBaseURL?, baseURLEnv?, nativeAuth?, error?
}
```

So the route id is **`props.provider.provider`** — confirmed, exactly as the Lead
said. (`ConfigurableProviderView`'s schema is `llm/listConfigurableProviders` in
`@deepseek-ai/dsh-api-remotes/lib/client.js` line ~7296: `provider`, `displayName`,
`settingsNs`, `settingsPath`, `declared?`, `defaultBaseURL?`, `baseURLEnv?`,
`nativeAuth?`, `error?`.)

Composed props this bundle also receives, and uses:

| prop | source | use |
|---|---|---|
| `t` | the `locale: NS` declaration → renderer's locale seat | all copy |
| `vis` | this plugin's own `inject: () => ({ vis })` | settings bridge |

The registration declares no `children`, so the renderer adds no `renderSlot` seat
here — this row is a leaf.

The component returns `null` when `props.provider.provider` is not a string, so a
malformed/partial row renders nothing rather than a broken control.

## 5. Services injected

```js
const inject = ['slots', 'locale', 'remote', 'remote.settings']
```

- `slots` — `dsh-client-ui-renderer` provides it (`super(ctx, "slots")`).
- `locale` — `dsh-client-locale`.
- `remote` — `@deepseek-ai/dsh-api-gateway` browser half (`super(ctx, "remote")`).
- `remote.settings` — a **Remote namespace service**, keyed `remote.<namespace>`
  (`remoteServiceKey(ns) => \`remote.${ns}\`` in `dsh-api-gateway/lib/client.browser.js`
  line ~2074). It must be declared explicitly in `inject` or it will not resolve —
  exactly what `dsh-client-ui-settings` and `dsh-client-ui-settings-models` declare.

## 6. The exact settings write call

Same RPC the shipped Models page itself uses — **not** `ctx.get('connection').api.*`,
which is not the pattern the shipped page uses.

Read (no arguments):

```js
const response = await ctx.remote.settings.describe()
// response.ok === true
//   response.value.writable   -> false disables every write control
//   response.value.namespaces -> [{ ns, value, base, user, schema, revision, applies, secrets, autoGenerate }]
// response.ok === false -> response.error.{ code, message }
```

The switch reads the persisted list out of the namespace view, preferring the
resolved `value` and falling back to `user`/`base`:

```js
const view = response.value.namespaces.find(row => row.ns === 'model-visibility')
const hidden = view.value.hiddenProviders ?? view.user.hiddenProviders ?? view.base.hiddenProviders ?? []
```

Write (whole-array `set`, the safe form — no read-modify-write race inside the op):

```js
const response = await ctx.remote.settings.mutate(
  'model-visibility',
  [{ op: 'set', path: ['hiddenProviders'], value: next }],
  revision,                       // the namespace view's `revision` from describe()
)
// response.ok === true  -> response.value is the namespace's new redacted view (folds straight back in)
// response.ok === false -> response.error.code === 'settings/conflict' | other, response.error.message
```

`next` is
`visible ? hidden.filter(id => id !== route) : [...hidden.filter(id => id !== route), route]`.

Wire contract verified in `@deepseek-ai/dsh-api-remotes/lib/client.js`:
`settings/describe` (line ~3033) → `{ writable, hasDocument, namespaces[] }`;
`settings/mutate` (line ~3129) → params `ns: string`, `ops: [{op:'set',path:string[],value}|{op:'unset',path}]`,
`expectedRevision?: number` ("revision the caller read; `undefined` writes unconditionally"),
result `SettingsNamespaceView` (`ns`, `value`, `base`, `user`, `schema`, `revision`, …).

Behaviour around the write:

- **Optimistic.** The local snapshot flips first, the write settles later. A refusal
  reverts the flip — but only when no newer optimistic change has superseded it.
- **Serialized.** Writes queue behind one another (`tail`), so two cards toggled
  quickly cannot lose each other's array.
- **One conflict retry.** `settings/conflict` triggers a `describe()` re-read and a
  single retry that merges the concurrent change. No loop.
- **Never blocks the toggle.** The UI never awaits the network before flipping.

## 7. Live state

Exactly the invalidations the shipped Models page follows:

```js
ctx.remote.$on('settings/document-updated', () => { void vis.refresh() })
ctx.on('connection/reset', () => { void vis.refresh() })
```

`$on` is the Remote event face (`dsh-api-gateway/lib/client.browser.js` line ~1680).
Overlapping `describe()` reads fold into one round trip plus one rerun, so a change
made elsewhere (another tab, an external `cordis.patch.yml` edit) refreshes the
switch without polling.

## 8. Dictionary keys

Registered with `ctx.locale.register('model-visibility', { zh, en })`; both locales
carry the same key set. The registration declares `locale: 'model-visibility'`, which
is what gives the component its `t` seat.

| key | zh | en |
|---|---|---|
| `toggle.label` | 在对话框可选模型中显示 | Show in composer model picker |
| `toggle.aria` | 在对话框可选模型中显示 {provider} | Show {provider} in the composer model picker |
| `toggle.hint` | 关闭后，该提供商的模型不会出现在对话框的模型选择器中；已在运行的会话不受影响。 | When off, this provider's models are not offered in the composer model picker; sessions already running are unaffected. |
| `toggle.unavailable` | 宿主设置命名空间尚未就绪，暂时无法切换。 | The host settings namespace is not ready yet, so this cannot be toggled. |
| `toggle.readonly` | 当前配置只读，无法修改。 | This configuration is read-only. |
| `toggle.failed` | 保存失败：{message} | Could not save: {message} |
| `toggle.failedPlain` | 保存失败，请重试。 | Could not save. Please try again. |

`{provider}` / `{message}` use the locale service's own `{name}` interpolation
(`dsh-client-locale/lib/client.js` line ~1427). The component falls back to its own
English strings if `t` is missing or returns the key unchanged, so copy never renders
as a raw dictionary key.

## 9. Switch primitive

`@deepseek-ai/dsh-client-ui-primitives` **is reachable** — it is one of the shell's
`staticModules` seed words, so `require('@deepseek-ai/dsh-client-ui-primitives')`
resolves in a hand-written bundle. Verified signature, from both the shipped usage
(`dsh-client-ui-settings-models/lib/client.js` line ~396) and the primitive itself in
the frontend bundle:

```js
Switch({ checked, onChange(on: boolean), label, disabled?, title?, className? })
// renders <button type="button" role="switch" aria-checked={checked} aria-label={label} title={title}>
```

This bundle passes `{ checked, label, title, disabled, onChange }`. `label` is the
localized aria-label (it names the provider); the visible label sits beside it in the
row. If the primitive is unreachable, a native
`<input type="checkbox" aria-label=… title=…>` with the same `checked`/`disabled`
semantics is rendered instead.

Styling is inline-token only (`--dsw-alias-label-secondary`,
`--dsw-alias-label-tertiary`, `--dsw-alias-state-error-primary`,
`--dsw-alias-state-business-primary`), injected as one `<style data-plugin="dsh-model-switches">`
tag from a `ctx.effect` so a hot reload removes it. No CSS modules, no build step.

## 10. package.json block for the Lead to merge

The browser half loads only when the **bare package row** (Loader entry id == package
name) declares `dsh.client.platform`; a subpath row does not carry it. Required
additions to `dsh-model-switches/package.json`:

```json
{
  "name": "dsh-model-switches",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": []
    }
  }
}
```

Notes on each field:

- `exports["./client"]` **must** point at `./client.js` — the host scan resolves the
  client bundle through `clientExportOf` (`dsh-client-modules/lib/index.js` line ~172),
  accepting a plain string or an object with a string `default`.
- `dsh.client.platform` must be a string (`parseDshClient` throws otherwise);
  `"web"` is the value every shipped client plugin uses.
- `dsh.client.inject` is the list of **package ids** whose bundles must arrive before
  this one. `[]` is correct here: this bundle requires no internal package, only seed
  words. Do not put `remote.settings` or other cordis *service* names here — those go
  in the bundle's own `exports.inject`, which already declares them.
- `dsh.client.immediately: true` makes the shell prefetch this bundle at boot (what
  `dsh-our-free-model` does); harmless either way, since `slots.inject` waits for the
  Models page to declare the seat.
- If the package is ever published, add `"client.js"` to `files`.

## 11. Things that could make the switch not render

Ranked by likelihood, with the exact symptom each produces:

1. **`settings.describe()` does not list `model-visibility`.** The host row's Config
   must declare a `.volatile()` field for the namespace to appear in the document at
   all. When it is absent the switch still *renders*, but disabled, with
   「宿主设置命名空间尚未就绪」 under it — it deliberately does **not** write into a
   namespace nothing owns. This is the expected state until the host half is mounted
   and valid.
2. **`dsh.client.platform` missing, or on a subpath row.** The browser half never
   loads: no seat, no switch, no console error attributable to this plugin. The host
   row must be the bare package name.
3. **The `entryKey` mismatch.** If a card's `settingsNs` is a namespace no seat was
   registered for, that one card renders nothing (the keyed dispatch returns a null
   fallback). Covered by registering every namespace `describe()` reports, plus the
   three known ones — but a provider whose adapter reports an empty `settingsNs`
   (`joinProviderDirectory` sets `settingsNs: ""` for a route with no declared
   settings address) can never host a card at all; that is a Models-page limit, not
   this plugin's.
4. **A pending `inject`.** If `remote`, `remote.settings`, `slots` or `locale` is
   absent from the composition, the plugin fiber waits on it and `apply` never runs —
   silent, no switch. All four are always present in the shipped web/desktop
   composition.
5. **A `slots.register` throw.** Registering the same `(key, priority)` twice throws;
   the bundle tracks registered keys and logs per-namespace failures instead of
   aborting, so one bad namespace cannot take the others down.
6. **Primitives seed trimmed.** Then the native checkbox fallback renders — same
   behaviour, plainer visuals, one `console.warn`.
7. **Component crash.** The renderer wraps every entry in a `SlotErrorBoundary`, so a
   throw in this component renders a `data-slot-error` cell inside that card only; it
   cannot break the Models page.

## 12. How this was verified (no runtime available for a live click)

`node --check client.js` passes. Beyond that, `.dsh-plugin-scratch/client-harness.mjs`
loads the bundle through a stub `window.__ModuleLoader__` with a minimal React stub
(this workspace has no `react` package — the shell inlines it) and a fake `ctx`, then
asserts 30+ behaviours:

- exactly one factory registered, under id `dsh-model-switches`;
- `require` touches only seed words (`react`, `react/jsx-runtime`,
  `@deepseek-ai/dsh-client-ui-primitives`);
- `exports.inject` contains `remote.settings`;
- the dictionary registers under `model-visibility` with identical zh/en key sets;
- `settings.models.provider-card` is injected, and keyed seats are registered for
  `llm-pi-ai`, `llm-deepseek`, `llm-deepseek-account` (plus any served namespace);
- every seat carries `locale: 'model-visibility'`;
- the stylesheet and both invalidations are installed;
- the component renders the platform `Switch`, ON for a route absent from
  `hiddenProviders`, OFF for one present, with a provider-naming aria-label, and
  `null` for a row with no route id;
- a toggle issues
  `mutate('model-visibility', [{op:'set',path:['hiddenProviders'],value:[…]}], 42)`
  with the revision taken from `describe()`;
- `settings/conflict` re-reads and retries exactly once;
- a refused write reverts the optimistic flip and surfaces the message;
- an absent `model-visibility` namespace disables the switch, explains itself, and
  never writes.

Run it with `node .dsh-plugin-scratch/client-harness.mjs` (last line `HARNESS OK`).

Not verified: the live visual result in the running GUI. That needs the plugin
installed into a profile and the host half mounted; the harness covers the contract,
not the pixels.
