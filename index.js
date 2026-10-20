/**
 * Model Visibility — Host half.
 *
 * Adds a per-provider on/off switch to Settings → Models and makes a
 * switched-off provider's models disappear from the composer's model picker,
 * without modifying DSH core.
 *
 * ## How the filtering works
 *
 * The browser's model picker (both entries — the `/model` popup and the
 * composer's model seat) reads `session.models`, which the Host builds in
 * `buildModelCatalog` (`@deepseek-ai/dsh-api-session-controller`) by walking
 * `ctx.llm.listProviders()` and `ctx.llm.listModels(provider.id)`, then
 * DROPPING groups with no models:
 *
 *     .filter(group => group.models.length > 0)
 *
 * So an adapter whose `listModels()` answers `[]` loses its whole group from the
 * catalog — which is exactly the seam this plugin uses. `listModels` is patched
 * once on the raw `LlmRuntime` instance; nothing else in the LLM path changes.
 *
 * Consequences of patching only `listModels`, all of them intended:
 *   - The group vanishes from both picker entries (they share one catalog).
 *   - Selecting a hidden model is refused: `session.selectModel` validates via
 *     `modelAvailable()`, which calls `listModels()` and finds nothing.
 *   - Sending is refused the same way, because the send path runs the same check.
 *   - ROUTING IS UNTOUCHED: `resolveModelInfo` / `resolveCallConfig` / the stream
 *     never consult the catalog, so a turn already running on a now-hidden
 *     provider keeps working. Only new selections are constrained.
 *
 * ## Why the raw service instance
 *
 * `ctx.llm` is a cordis *traceable proxy*: reading it hands back a proxy whose
 * `set` trap refuses properties the providing fiber does not own, so a plugin
 * cannot monkey-patch the service through `ctx`. The proxy does, however,
 * forward the `Symbol.for('cordis.original')` key to the underlying instance
 * (`getTraceable`'s `get` trap), and an own property defined on that instance
 * shadows the prototype method for every later `ctx.llm.listModels()` call.
 * Verified against the installed `@deepseek-ai/cordis` 4.0.x.
 *
 * ## Safety posture
 *
 *   - LIVE STATE: the hidden set is read from the volatile config reference on
 *     EVERY call, so a toggle takes effect on the next picker open. No restart,
 *     no re-registration (cordis commits a volatile-only config change into the
 *     running fiber and emits `loader/volatile-update`).
 *   - FAIL OPEN: any error while deciding visibility shows every provider. A
 *     state-read bug must never empty the model picker.
 *   - NEVER LOCK THE PICKER EMPTY: if the configured set would hide every
 *     registered provider, the filter is skipped and everything is shown. A
 *     misconfigured or hand-edited settings file cannot leave the user with no
 *     model at all.
 *   - IDEMPOTENT: the patch is marked on the raw instance, and hot reload swaps
 *     only the state reader, so repeated `apply()` calls cannot stack wrappers.
 *
 * @module dsh-model-switches
 */

import z from '@deepseek-ai/schemastery'

/** Symbol key cordis uses to expose a service's underlying (unproxied) instance. */
const ORIGINAL = Symbol.for('cordis.original')
/** Marker proving this raw instance already carries the catalog filter. */
const INSTALLED = Symbol.for('dsh-model-switches.installed')
/**
 * The state reader shared across hot reloads. `apply()` replaces `read` with a
 * closure over the CURRENT fiber's volatile config, so the one patch installed
 * by the first generation always reports the live value of the newest one.
 */
const STATE = Symbol.for('dsh-model-switches.state')

/**
 * Plugin configuration. Both fields are `.volatile()` on purpose:
 * `dsh-settings` only exposes a namespace whose schema has a volatile field, and
 * it only accepts writes to volatile paths — this is what lets the Models page
 * edit the switches and the running Host observe them without a restart.
 *
 * `hiddenProviders` holds provider ROUTE ids that are switched OFF wholesale.
 * `hiddenModels` holds individual `<route>/<modelId>` pairs switched off one by
 * one inside a provider's own model catalog. Both default to empty, so the safe
 * posture is "everything visible" for an install that upgrades into this plugin.
 */
export const Config = z.object({
  hiddenProviders: z.array(z.string()).default([]).volatile(),
  hiddenModels: z.array(z.string()).default([]).volatile(),
})

/** The `llm` registry is the only service this plugin needs. */
export const inject = ['llm']

/** Diagnostics name for this plugin. */
export const name = 'model-visibility'

/** Separator inside one `hiddenModels` entry. Model ids never contain a NUL. */
const KEY_SEP = '\u0000'

/**
 * Read one volatile string-list field off the live config reference.
 * @param config - the validated plugin config.
 * @param field - which field to read.
 * @returns the entries, or an empty list when the value is unusable.
 */
function listOf(config, field) {
  try {
    const value = config?.[field]?.get?.() ?? config?.[field]
    if (!Array.isArray(value)) return []
    return value.filter(entry => typeof entry === 'string' && entry.length > 0)
  } catch {
    // A broken state read must not hide anything.
    return []
  }
}

/**
 * Snapshot both hidden sets for one `listModels` call.
 * @param config - the validated plugin config.
 * @returns the hidden route list and the hidden `<route>\0<model>` keys.
 */
function hiddenOf(config) {
  return {
    providers: listOf(config, 'hiddenProviders'),
    models: new Set(listOf(config, 'hiddenModels')),
  }
}

/**
 * Decide whether one provider route is hidden right now.
 *
 * Reads the shared state reader (so hot reload is transparent) and applies the
 * "never hide everything" guard: when every registered route is configured off,
 * the whole filter stands down rather than leaving an empty picker.
 *
 * @param raw - the raw `LlmRuntime` instance (for the registered route list).
 * @param state - the cross-generation state holder.
 * @param provider - provider route id being listed.
 * @returns whether this route's models should be withheld entirely.
 */
function isHidden(raw, state, provider) {
  try {
    const read = state.read
    if (typeof read !== 'function') return false
    const hidden = read().providers
    if (hidden.length === 0 || !hidden.includes(provider)) return false
    // Guard: hiding every registered route would empty the picker entirely.
    const routes = raw.listProviders().map(entry => entry?.id).filter(id => typeof id === 'string')
    if (routes.length > 0 && routes.every(id => hidden.includes(id))) return false
    return true
  } catch {
    // Fail open: an exception here must never remove a provider from the picker.
    return false
  }
}

/**
 * Drop the individually-hidden models from one provider's listing.
 *
 * When this would remove EVERY model the adapter offered, the whole per-model
 * filter stands down for that call: an over-eager selection must not make a
 * provider vanish the way a closed provider switch does. (Per-provider hiding is
 * the explicit way to do that, and it has its own guard.)
 *
 * @param models - the adapter's own listing.
 * @param state - the cross-generation state holder.
 * @param provider - provider route id being listed.
 * @returns the visible subset, or the untouched listing when nothing is hidden.
 */
function withoutHiddenModels(models, state, provider) {
  try {
    const read = state.read
    if (typeof read !== 'function') return models
    const hidden = read().models
    if (hidden.size === 0) return models
    const visible = models.filter(model => {
      const id = model?.id
      if (typeof id !== 'string') return true
      return !hidden.has(provider + KEY_SEP + id)
    })
    return visible.length === 0 ? models : visible
  } catch {
    return models
  }
}

/**
 * Install the catalog filter on the raw `LlmRuntime` instance (idempotent).
 *
 * The first call replaces `listModels` with a wrapper that answers `[]` for a
 * hidden route, drops individually-hidden models for a visible one, and
 * otherwise delegates to the original method with the same `this`, so adapter
 * behaviour is byte-for-byte unchanged for visible routes and models.
 *
 * @param raw - the raw `LlmRuntime` instance.
 * @param state - the cross-generation state holder to read visibility from.
 * @param log - logger for the one-time diagnostic.
 * @returns whether the filter is in place.
 */
function installGate(raw, state, log) {
  if (typeof raw?.listModels !== 'function') return false
  if (raw[INSTALLED] === true) return true

  const original = raw.listModels
  const patched = async function listModels(provider) {
    if (isHidden(raw, state, provider)) return []
    const models = await original.call(this, provider)
    if (!Array.isArray(models)) return models
    return withoutHiddenModels(models, state, provider)
  }

  try {
    Object.defineProperty(raw, 'listModels', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: patched,
    })
    Object.defineProperty(raw, INSTALLED, {
      configurable: true,
      enumerable: false,
      value: true,
    })
  } catch (error) {
    log?.warn?.('model-visibility: could not install the model catalog filter')
    log?.warn?.(error)
    return false
  }
  log?.info?.('model-visibility: model catalog filter installed')
  return true
}

/**
 * Plugin body: install the catalog filter and publish this fiber's state reader.
 *
 * @param ctx - Host plugin context (injects `llm`).
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
  // Resolve the raw service instance: `ctx.llm` is a traceable proxy whose
  // `set` trap would refuse this patch, while its `get` trap forwards the
  // `cordis.original` symbol to the real object.
  const raw = ctx.llm?.[ORIGINAL]
  if (raw === undefined) {
    ctx.logger?.warn?.('model-visibility: the raw llm service is unreachable; the model picker will not be filtered')
    return
  }

  // One shared holder per raw instance: a hot reload gets a fresh `config`, and
  // replacing `read` here is what makes the already-installed patch follow it.
  const state = raw[STATE] ?? (raw[STATE] = { read: undefined })
  state.read = () => hiddenOf(config)

  installGate(raw, state, ctx.logger)

  // The reader belongs to this fiber: when it unloads, stop consulting a config
  // whose owner is gone. The patch itself stays (it is harmless when the reader
  // is absent — `isHidden` answers false), and a later generation re-installs it.
  ctx.effect(() => () => {
    if (state.read !== undefined) state.read = undefined
  }, 'model-visibility: state reader')
}
