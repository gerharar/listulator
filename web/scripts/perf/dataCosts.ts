/**
 * Phase 25.0: what the list screen's data work costs by itself, with no DOM (BACKLOG BL-074). Run by hand, not in the suite:
 *   npx tsx scripts/perf/dataCosts.ts
 * It builds lists of 2,500 to 50,000 items (one group, 100 groups, none) and times the pure functions the screen runs on every
 * load, keystroke and tick. The browser half is `e2e/perf/listSize.perf.ts`.
 */
import { buildSpine, listTotals } from '../../src/screens/list/spine.js'
import { NO_FILTER, shownItemIds } from '../../src/screens/list/filtering.js'
import { deriveFacets } from '../../../server/src/catalog/facets.js'
import type { ListGroup, ListItem } from '../../src/lib/api.js'

function makeList(count: number, groupCount: number): { items: ListItem[]; groups: ListGroup[] } {
  const groups: ListGroup[] = Array.from({ length: groupCount }, (_, index) => ({
    id: `g${index}`,
    listId: 'L',
    name: `Volume ${index}`,
    orderIndex: index,
  }))
  const items: ListItem[] = Array.from({ length: count }, (_, index) => ({
    id: `i${index}`,
    listId: 'L',
    title: `Issue ${index}: a title of ordinary length`,
    orderIndex: index,
    timeToConsumeMinutes: 20 + (index % 90),
    timeToConsumeIsEstimated: false,
    consumedAt: index % 7 === 0 ? '2026-01-01' : null,
    source: 'import',
    year: 1960 + (index % 60),
    group: groupCount === 0 ? null : `Volume ${Math.floor((index * groupCount) / count)}`,
    tags: index % 3 === 0 ? ['Hardcover'] : null,
    notes: index % 50 === 0 ? 'A curator note' : null,
    userNote: index % 40 === 0 ? 'My note' : null,
    yearUnk: 0,
    isNew: false,
  })) as ListItem[]

  return { items, groups }
}

/** The median of a few runs, in milliseconds: one run is noise (GC, JIT warm-up). */
function time(run: () => unknown, runs = 5): number {
  run()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)

  return samples[Math.floor(samples.length / 2)]!
}

const rows: string[] = []
for (const count of [2_500, 10_000, 30_000, 50_000]) {
  for (const groupCount of [0, 1, 100]) {
    const { items, groups } = makeList(count, groupCount)
    const spine = time(() => buildSpine(items, groups))
    const totals = time(() => listTotals(items))
    const filtered = time(() => shownItemIds(items, undefined, { ...NO_FILTER, text: 'issue 4' }))
    const facets = time(() => deriveFacets(items as never, [{ key: 'type', label: 'Type' }] as never))
    rows.push(`| ${count.toLocaleString('en-US')} | ${groupCount === 0 ? 'none' : groupCount === 1 ? '1 group' : `${groupCount} groups`} | ${spine.toFixed(1)} | ${totals.toFixed(1)} | ${filtered.toFixed(1)} | ${facets.toFixed(1)} |`)
  }
}

console.log('| items | groups | buildSpine ms | listTotals ms | filter text ms | deriveFacets ms |')
console.log('|---|---|---|---|---|---|')
console.log(rows.join('\n'))
