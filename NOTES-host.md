# NOTES-host — the Host half of `dsh-model-switches`

Owner: Lead (host-half was interrupted after it stalled; the mechanism below was
proved by experiment first, then implemented).

## The gate: `LlmRuntime.listModels`

`buildModelCatalog` (`@deepseek-ai/dsh-api-session-controller`, `lib/types/catalog.js`)
walks `ctx.llm.listProviders()` → `ctx.llm.listModels(provider.id)` and then drops
empty groups:

```js
const groups = catalog.flatMap(i => i.kind === 'group' ? [i.group] : [])
  .filter(group => group.models.length > 0)
```

Returning `[]` from `listModels` for a route therefore removes that route's whole
group from **both** picker entries (the `/model` popup and the composer model
seat share one catalog).

## Why the raw instance (`Symbol.for('cordis.original')`)

`ctx.llm` is a cordis **traceable proxy**. Its `set` trap refuses properties the
providing fiber does not own (`cannot set property "listModels" without provide`),
so a plugin cannot patch the service through `ctx`. Its `get` trap does forward
`Symbol.for('cordis.original')` to the underlying instance
(`getTraceable` → `createTraceable`'s `get`: `if (prop === symbols.original) return target`).
Defining an own `listModels` on that instance shadows the prototype method for
every later `ctx.llm.listModels()` read.

Experimentally confirmed (`.dsh-plugin-scratch/probe-gate.mjs`) against the real
installed cordis 4.0.x:

| strategy | effect |
|---|---|
| `ctx.llm[Symbol.for('cordis.original')]` + own prop | **works** |
| `ctx.reflect.get('llm', false)` + own prop | no effect (different proxy) |
| `ctx.llm.listModels = …` | throws in a real plugin context |
| `Object.defineProperty(raw, 'listModels', …)` | **works** (the form used) |

## Consequences, all verified

- **Both picker entries filter** — they read the same `session.models`.
- **Selection is refused**: `session.selectModel` → `requireModel` → `modelAvailable()`
  calls `listModels()` and finds no hidden model.
- **Sending is refused** the same way (the send path runs the same check).
- **Routing is untouched**: `resolveModelInfo` / `resolveCallConfig` / `llm/stream`
  never consult the catalog, so a turn already running on a now-hidden provider
  keeps working. Only new selections are constrained.

## Live state, no restart

The hidden set is read from the **volatile** config reference on every call:
`config.hiddenProviders.get()`. `cordis-plugin-loader`'s `Entry.update()` detects a
volatile-only config change and calls `_commitVolatile()`, which
`updateVolatile(ref, source)` on the running fiber and emits
`loader/volatile-update` — no remount. So a toggle takes effect on the next
picker open.

## Settings contract (shared with the browser half)

| item | value |
|---|---|
| Loader row id / settings namespace | **`model-visibility`** |
| field | `hiddenProviders: string[]` — provider **route ids** that are OFF |
| default | `[]` = everything visible (safe for an existing install) |
| volatile | **required** — `dsh-settings` only exposes a namespace whose schema has a volatile field (`volatileForm()`), and only accepts writes to volatile paths |

`dsh-settings`' `write()` enforces:

```js
const form = volatileForm(schema)
if (form === undefined) throw `Plugin entry "<ns>" has no volatile fields`
for (const path of paths) if (!isVolatilePath(schema, path)) throw `Config field "…" is not volatile`
```

## Safety posture

1. **Fail open** — any error while deciding visibility shows every provider
   (`isHidden` catches and returns `false`).
2. **Never lock the picker empty** — if the configured set would hide *every*
   registered route, the filter stands down and everything is shown. A
   hand-edited or corrupted settings file cannot leave the user with no model.
3. **Idempotent** — the patch is marked with `Symbol.for('dsh-model-switches.installed')`
   on the raw instance; hot reload only swaps the state reader
   (`Symbol.for('dsh-model-switches.state')`), so wrappers cannot stack.
4. **Teardown** — the reader is cleared with the fiber's effect, so an unloaded
   generation is never consulted. The patch itself stays and is inert without a
   reader.

## Known limitation: hiding the provider a session is already using

The client (`dsh-client-ui-model-selection`, `syncInputs`) recomputes `routable`
**from the catalog**:

```js
const routable = catalog.value.groups.some(group =>
  group.id === selection.provider && group.models.some(model => model.id === selection.model))
```

and `ui-model-selection` pushes a **composer block** when `routable === false`,
which makes the input inert. So if the user switches OFF the provider that a
session's current selection points at, that session's composer locks until they
pick another model.

This is inherent to filtering the catalog (it is also what happens today when an
adapter stops advertising a model), and the fix is the user's: switch the provider
back on, or pick another model. It is called out in the UI copy
(「已在运行的会话不受影响」 refers to *routing*, not to the composer of a session
whose selected model was itself hidden) and documented here rather than worked
around by special-casing a route — doing that would need per-session state the
Host does not own in this seam.

## Verification

- `.dsh-plugin-scratch/probe-gate.mjs` — proves the seam and rejects the dead strategies.
- `.dsh-plugin-scratch/host-test/probe-host.mjs` — the real `LlmRuntime` shape,
  live volatile toggles, the anti-lockout guard, fail-open, idempotency, teardown.
- `.dsh-plugin-scratch/host-test/probe-cordis.mjs` — registers the plugin as a
  **real cordis plugin** with its exported `Config`, lets cordis resolve the
  config, and commits volatile writes the way the Loader does.
