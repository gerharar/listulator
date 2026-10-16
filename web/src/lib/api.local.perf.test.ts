import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaTypeRegistry } from '../../../server/src/ingestion/mediaTypes.js'

/**
 * Phase 25.8 (BACKLOG BL-074): what the DESKTOP's data path costs at 30,000 and 50,000 items: the SQL the app sends through the plugin
 * (a real in-memory SQLite with the real migrations, the same isolation hook as the built app), without the Tauri IPC and the webview, which
 * only the owner's by-hand run in the dev app can time. Run by hand, never in the suite (its name ends in `.perf.test.ts`, which the normal
 * config excludes):
 *   cd web && npx vitest run --config vitest.perf.config.ts
 * Prints one `PERF-DESKTOP|` line per size.
 */
let sqlite: BetterSqlite3.Database
const positional = (sql: string) => sql.replace(/\$\d+/g, '?')

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { sqlThroughHook } = await import('./isolationHook.testing.js')
  const checked = sqlThroughHook()

  return {
    default: {
      load: vi.fn(async () => ({
        execute: async (sql: string, params: unknown[] = []) => {
          checked('execute', sql, params)
          sqlite.prepare(positional(sql)).run(...params)
        },
        select: async (sql: string, params: unknown[] = []) => {
          checked('select', sql, params)
          return sqlite.prepare(positional(sql)).all(...params)
        },
      })),
    },
  }
})

const registryHolder = vi.hoisted(() => ({ current: [] as readonly unknown[] }))
vi.mock('./ingestion/localMediaTypes.js', () => ({
  getLocalMediaTypes: async () => registryHolder.current,
  resetLocalMediaTypes: () => undefined,
  LOCAL_FETCHERS: {},
}))

function yamlFor(count: number, groups: number): string {
  const rows = Array.from({ length: count }, (_, n) => {
    const group = groups === 0 ? '' : `, group: "Volume ${Math.floor((n * groups) / count)}"`
    return `  - { title: "Issue ${n}: a title of ordinary length", year: ${1960 + (n % 60)}, minutes: ${20 + (n % 90)}${group} }`
  })

  return `title: Perf ${count}\ncategory: movie\nitems:\n${rows.join('\n')}\n`
}

const timed = async <T>(run: () => Promise<T>): Promise<[T, number]> => {
  const start = performance.now()
  const value = await run()

  return [value, Math.round(performance.now() - start)]
}

describe('the desktop data path at 30,000 and 50,000 items (25.8)', () => {
  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:')
    registryHolder.current = createMediaTypeRegistry().list()
  })
  afterEach(() => sqlite.close())

  for (const count of [10_000, 30_000, 50_000]) {
    it(`${count.toLocaleString('en-US')} items in 100 groups`, { timeout: 15 * 60_000 }, async () => {
      vi.resetModules()
      const local = await import('./api.local.js')
      const api = local.createLocalApi()
      const yaml = yamlFor(count, 100)

      const [list, importMs] = await timed(() => api.createFromFile({ yaml }))
      const [detail, listMs] = await timed(() => api.list(list.id))
      const [preview, previewMs] = await timed(() => api.resetPreview(list.id))
      const [reset, resetMs] = await timed(() => api.resetList(list.id))
      const payloadMB = Math.round((JSON.stringify(reset.restore).length / 1048576) * 10) / 10
      const [, undoMs] = await timed(() => api.restoreItems(list.id, reset.restore))
      const [again, listAgainMs] = await timed(() => api.list(list.id))
      const listMB = Math.round((JSON.stringify(detail).length / 1048576) * 10) / 10

      process.stdout.write(
        `PERF-DESKTOP|${count}|import ${importMs} ms|open (list) ${listMs} ms / ${listMB} MB|reset preview ${previewMs} ms|reset ${resetMs} ms (undo payload ${payloadMB} MB)|undo ${undoMs} ms|list after ${listAgainMs} ms\n`,
      )
      expect(detail.items).toHaveLength(count)
      expect(again.items).toHaveLength(count)
      expect(preview).toBeTruthy()
    })
  }
})
