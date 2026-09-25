// The standalone app's strategy loader (task 5.8) — the counterpart to
// server/src/suggestions/loader.ts. That loader reads `config/strategies/*.json`
// with `node:fs`, which doesn't exist in a webview; strategy files are
// bundled as static imports instead (Vite resolves and inlines the JSON at
// build time), and the same `parseStrategy` the server uses validates them,
// so a strategy is checked identically in both places. `engine.ts`'s `rank`
// is untouched — this module only replaces how a `Strategy` object is
// obtained, per docs/DECISIONS.md's "Standalone-app distribution" plan.
import finalizer from '../../../../config/strategies/finalizer.json'
import justOneFix from '../../../../config/strategies/just-one-fix.json'
import quickie from '../../../../config/strategies/quickie.json'
import suggest from '../../../../config/strategies/suggest.json'
import tiredBoss from '../../../../config/strategies/tired-boss.json'
import { parseStrategy, StrategyError, type Strategy } from '../../../../server/src/suggestions/strategy.js'

const BUNDLED: Record<string, unknown> = {
  finalizer,
  'just-one-fix': justOneFix,
  quickie,
  suggest,
  'tired-boss': tiredBoss,
}

/**
 * Parsed once per name rather than on every button press — these are static,
 * bundled files, not something a self-hoster edits and expects to reload
 * live (that live-editing case is what `STRATEGIES_DIR` is for, server-side
 * only).
 */
const cache = new Map<string, Strategy>()

export function loadLocalStrategy(name: string): Strategy {
  const cached = cache.get(name)
  if (cached) return cached

  const raw = BUNDLED[name]
  if (!raw) {
    throw new StrategyError(`No bundled strategy named "${name}".`)
  }

  const strategy = parseStrategy(raw, `config/strategies/${name}.json`)
  cache.set(name, strategy)
  return strategy
}
