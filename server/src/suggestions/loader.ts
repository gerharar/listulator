import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrategy, StrategyError, type Strategy } from './strategy.js'

/**
 * Strategy files live outside the TypeScript build tree so they can be edited
 * without a rebuild (SPEC.md §6). `<repo>/config/strategies` is three levels up
 * from both `server/src/suggestions` and `server/dist/suggestions`.
 */
const DEFAULT_STRATEGIES_DIR = fileURLToPath(new URL('../../../config/strategies', import.meta.url))

export function strategiesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['STRATEGIES_DIR'] ?? DEFAULT_STRATEGIES_DIR
}

/**
 * Read fresh on every call rather than cached at boot: the whole point of
 * these files is that editing one takes effect immediately. They are small,
 * and a suggestion is a deliberate button press, not a hot path.
 */
export function loadStrategy(name: string, directory: string = strategiesDir()): Strategy {
  const file = join(directory, `${name}.json`)

  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    throw new StrategyError(
      `No strategy file at ${file}. Each button reads its ranking from a JSON file there.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (cause) {
    throw new StrategyError(
      `${file} is not valid JSON: ${cause instanceof Error ? cause.message : 'parse failed'}`,
    )
  }

  return parseStrategy(parsed, file)
}
