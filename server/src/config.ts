import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** `<repo>/.env` — beside config/strategies, where a self-hoster looks for settings. */
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url))

/**
 * Loads `<repo>/.env` if it exists, using Node's built-in support rather than
 * a dependency. Real environment variables win: a value already exported in
 * the shell is a deliberate override, and a stale file should not beat it.
 *
 * Absent file is normal — every setting has a working default, and the app
 * runs with no configuration at all.
 */
export function loadEnvFile(file: string = ENV_FILE): void {
  if (!existsSync(file)) return

  process.loadEnvFile(file)
}

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
  /**
   * Host names the server answers to beside this machine's own (`localhost`, `127.0.0.1`, `::1`) and `host`:
   * what a phone or another computer uses to reach it (`ALLOWED_HOSTS=nas.local,192.168.1.20`). Every other
   * name is refused (`auth/allowedHosts.ts`).
   */
  allowedHosts: string[]
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Expected a boolean value, got "${value}"`)
}

/** `PORT`: a whole number from 1 to 65535. Anything else would start the server somewhere unexpected (0 is "any free port"). */
function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  const port = Number(trimmed)
  if (!/^\d+$/.test(trimmed) || port < 1 || port > 65535) {
    throw new Error(`Expected PORT to be a whole number from 1 to 65535, got "${value}"`)
  }
  return port
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    singleUserMode: parseBoolean(env['SINGLE_USER_MODE'], true),
    databasePath: env['DATABASE_PATH'] ?? 'data/listulator.sqlite',
    port: parsePort(env['PORT'], 3001),
    host: env['HOST'] ?? '127.0.0.1',
    allowedHosts: (env['ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  }
}
