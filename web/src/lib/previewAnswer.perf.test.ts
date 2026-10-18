import { afterEach, describe, it, vi } from 'vitest'
import { createMediaTypeRegistry } from '../../../server/src/ingestion/mediaTypes.js'
import { createTestApp } from '../../../server/src/testing/harness.js'

/**
 * Phase 26.0 (BACKLOG BL-098): what the SERVER's preview answer costs for a big library (List Vault) list, which is the only source that can hold above the connector's
 * 10,000 (`MAX_CONNECTOR_ITEMS`; a library list is held to `MAX_LIST_ITEMS`, 50,000): the time to read and parse the file and answer, the size of the answer, and the browser's own
 * `JSON.parse` of it (the Preview's per-row cost is in `e2e/perf/previewSize.perf.ts`). The file is generated and handed to the server as the fetch answer: no list file is committed.
 * Run by hand, never in the suite: `cd web && npx vitest run --config vitest.perf.config.ts previewAnswer`. Prints one `PERF-ANSWER|` line per case.
 */
const SIZES = [2_161, 10_000, 30_000, 50_000]
const LAYOUTS = [
  { name: 'flat', per: 0 },
  { name: 'groups of 25', per: 25 },
  { name: 'groups of 100', per: 100 },
] as const

function fileFor(count: number, per: number): string {
  const rows = Array.from({ length: count }, (_, n) => {
    const group = per === 0 ? '' : `, group: "Volume ${Math.floor(n / per)}"`
    return `  - { title: "Episode ${n}: a title of ordinary length", year: ${1960 + (n % 60)}, minutes: ${20 + (n % 90)}${group} }`
  })

  return `title: Perf ${count}\ncategory: mega\nitems:\n${rows.join('\n')}\n`
}

afterEach(() => vi.unstubAllGlobals())

describe('the server answers a big library list preview (26.0)', () => {
  for (const count of SIZES) {
    for (const layout of LAYOUTS) {
      it(`${count.toLocaleString('en-US')} items, ${layout.name}`, async () => {
        const harness = createTestApp({ mediaTypes: createMediaTypeRegistry([{ key: 'mega', label: 'Mega', sortOrder: 20, defaultDurationMinutes: 120 }]) })
        try {
          const yaml = fileFor(count, layout.per)
          vi.stubGlobal('fetch', vi.fn(async () => new Response(yaml, { status: 200 })))
          await harness.app.ready()
          const url = `/api/media-types/mega/expansion?externalRef=${encodeURIComponent(`canonical:lists/mega/perf-${count}-${layout.per}.yaml`)}&items=true`

          const start = performance.now()
          const reply = await harness.app.inject({ method: 'GET', url })
          const answerMs = Math.round(performance.now() - start)
          const body = reply.body
          const parseStart = performance.now()
          const parsed = JSON.parse(body) as { itemCount?: number }
          const parseMs = Math.round(performance.now() - parseStart)

          process.stdout.write(
            `PERF-ANSWER|${count}|${layout.name}|status ${reply.statusCode}|answer ${answerMs} ms|${Math.round((body.length / 1048576) * 10) / 10} MB|JSON.parse ${parseMs} ms|items ${parsed.itemCount ?? '-'}\n`,
          )
        } finally {
          await harness.cleanup()
        }
      })
    }
  }
})
