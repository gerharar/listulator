import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIBRARY } from '../../../e2e-tools/identity/library'

/**
 * The identity tool's community library (BL-182). The List Vault reads `/api/library`, which the tool did not answer, so the Vault slot showed the live library:
 * its counts changed whenever a list reached it and a compare failed on code that had not changed. The tool now answers with this fixed set. The tool itself
 * runs by hand (it needs browsers); this keeps the set honest and the route in place.
 */
describe('the identity tool’s community library', () => {
  it('is reachable and holds a spread of lists: several categories, more than one list in some', () => {
    const categories = new Map<string, number>()
    for (const entry of LIBRARY.entries) categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1)

    expect(LIBRARY.reachable).toBe(true)
    expect(categories.size).toBeGreaterThanOrEqual(3)
    expect(Math.max(...categories.values())).toBeGreaterThan(1)
  })

  it('has one ref per list, each in its own category’s folder', () => {
    const refs = LIBRARY.entries.map((entry) => entry.externalRef)

    expect(new Set(refs).size).toBe(refs.length)
    for (const entry of LIBRARY.entries) expect(entry.externalRef).toMatch(new RegExp(`^canonical:lists/${entry.category}/[\\w-]+\\.yaml$`))
  })

  it('shows every state a row can have: tracked (with the id of its list, and only then), complete, ongoing, an estimated length', () => {
    const entries = LIBRARY.entries

    expect(entries.some((entry) => entry.tracked)).toBe(true)
    for (const entry of entries) expect(entry.trackedListId !== undefined).toBe(entry.tracked)
    expect(entries.some((entry) => entry.status === 'complete')).toBe(true)
    expect(entries.some((entry) => entry.status === 'ongoing')).toBe(true)
    expect(entries.some((entry) => entry.minutesEstimated === true)).toBe(true)
  })

  it('is what the tool answers `/api/library` with, in every capture, compare and sweep', () => {
    const tool = readFileSync(new URL('../../../e2e-tools/identity/capture.tool.ts', import.meta.url), 'utf8')

    expect(tool).toMatch(/import \{ LIBRARY \} from '\.\/library(\.js)?'/)
    expect(tool).toMatch(/page\.route\('\*\*\/api\/library', \(route\) => route\.fulfill\(\{ json: LIBRARY \}\)\)/)
  })
})
