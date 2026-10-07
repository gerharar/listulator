import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems, itemFromFile } from './bulkItems.js'
import { createList, findListExternalRefs, findListsWithStats, findListWithStats } from './repository.js'

/**
 * The lists overview and the single-list read must not read a list's stored file (BL-075, found measuring big lists, spike S2). The
 * totals query joined every item row and selected each list's whole `source_yaml`, so SQLite handled the file's text once per item:
 * a 10,000-item list imported from a 700 KB file made the overview take 16 to 27 s on the server and 36 to 116 s per statement on the
 * desktop, which sat on "Loading…" for minutes. With the text left out it is milliseconds.
 */
describe('the lists overview and the single-list read, with big stored files and many items', () => {
  let harness: TestApp
  let userId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    userId = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db
  /** The sort of file a big import leaves behind (about 1 MB). */
  const bigFile = `title: Big\ncategory: movie\nitems:\n${'- { title: "Fantastic Four (1961) #1", year: 1961, minutes: 25 }\n'.repeat(17_000)}`

  async function bigList(items: number, sourceYaml: string | null = bigFile) {
    const list = await createList(db(), userId, { title: 'Big', mediaType: 'movie', source: 'file', sourceYaml })
    await createListItems(db(), userId, list.id, Array.from({ length: items }, (_, n) => itemFromFile({ title: `Item ${n}`, minutes: 25 }, 120)))

    return list
  }

  it('answers in well under a second with a 1 MB stored file and 3,000 items, for the overview and for the one list', async () => {
    const list = await bigList(3_000)
    expect(bigFile.length).toBeGreaterThan(900_000)

    let start = performance.now()
    const overview = await findListsWithStats(db(), userId)
    const overviewMs = performance.now() - start
    start = performance.now()
    const one = await findListWithStats(db(), userId, list.id)
    const oneMs = performance.now() - start

    expect(overview[0]?.stats.totalItems).toBe(3_000)
    expect(one?.stats.totalItems).toBe(3_000)
    // Fixed: a few milliseconds. With the bug: seconds (the text copied once per item row).
    expect(overviewMs).toBeLessThan(500)
    expect(oneMs).toBeLessThan(500)
  }, 60_000)

  it('does not carry the stored file in what it returns, and still knows whether a list can be reset', async () => {
    const withFile = await bigList(3)
    const withoutFile = await createList(db(), userId, { title: 'No file', mediaType: 'movie', source: 'file', sourceYaml: null })
    const handMade = await createList(db(), userId, { title: 'By hand', mediaType: 'movie' })

    const overview = await findListsWithStats(db(), userId)
    const by = (id: string) => overview.find((entry) => entry.id === id)!

    for (const entry of overview) expect(entry).not.toHaveProperty('sourceYaml')
    expect(by(withFile.id).canReset).toBe(true)
    expect(by(withoutFile.id).canReset).toBe(false)
    expect(by(handMade.id).canReset).toBe(false) // nothing to go back to
    expect(await findListWithStats(db(), userId, withFile.id)).not.toHaveProperty('sourceYaml')
    expect((await findListWithStats(db(), userId, withoutFile.id))?.canReset).toBe(false)
  })

  it('totals the items as before', async () => {
    const list = await bigList(10, null)

    expect((await findListWithStats(db(), userId, list.id))?.stats).toMatchObject({
      totalItems: 10,
      consumedItems: 0,
      timeRemainingMinutes: 250,
      completionPercent: 0,
    })
  })

  it('lists the library references without reading whole rows', async () => {
    await bigList(2)
    await createList(db(), userId, { title: 'From the library', mediaType: 'movie', source: 'api', externalRef: 'canonical:lists/movie/a.yaml' })
    await createList(db(), userId, { title: 'From a connector', mediaType: 'movie', source: 'api', externalRef: 'tmdb:collection:1' })

    expect((await findListExternalRefs(db(), userId)).sort()).toEqual(['canonical:lists/movie/a.yaml', 'tmdb:collection:1'])
  })
})
