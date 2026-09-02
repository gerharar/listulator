/**
 * Server configuration, read from the environment once at startup.
 *
 * `singleUserMode` is the flag that keeps this app a personal tool: when on,
 * there is exactly one implicit local user and no login UI. Every table is
 * still `user_id`-scoped (SPEC.md §11), so turning it off later enables real
 * multi-tenancy without a data migration.
 */
export interface ServerConfig {
  singleUserMode: boolean
  databasePath: string
  port: number
  host: string
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Expected a boolean value, got "${value}"`)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    singleUserMode: parseBoolean(env['SINGLE_USER_MODE'], true),
    databasePath: env['DATABASE_PATH'] ?? 'data/duldulator.sqlite',
    port: Number(env['PORT'] ?? 3001),
    host: env['HOST'] ?? '127.0.0.1',
  }
}
