import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { findListGroups } from './groups.js'
import { seedGroupOrder } from './groups.js'
import { sortChronologically } from './reset.js'
import { createList, createListItem, findListItems } from './repository.js'

/**
 * H-005: Sort by release date and the order of a group use the latest year an item can be, so
 * 1989 < 198? < 1990 < 1999 < 199? < 19?? < 2000, and an item with no year comes after every year.
 */
describe('sorting by release date with partial years', () => {
  let harness: TestApp
  let owner: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    owner = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db

  /** `199?` is 1990 with one unknown digit. */
  const at = (text: string) => {
    const unknown = text.length - text.replace(/\?/g, '').length

    return { year: Number(text.replace(/\?/g, '0')), yearUnk: unknown as 0 | 1 | 2 }
  }

  const build = async (items: { title: string; year?: string; group?: string }[]) => {
    const list = await createList(db(), owner, { title: 'Music', mediaType: 'music' })
    for (const item of items) {
      await createListItem(db(), owner, list.id, {
        title: item.title,
        timeToConsumeMinutes: 40,
        ...(item.year ? at(item.year) : {}),
        ...(item.group ? { group: item.group } : {}),
      })
    }

    return list
  }

  const titles = async (listId: string) => (await findListItems(db(), owner, listId))!.map((item) => item.title)

  it('puts a partial year after the exact years it contains and before the next one', async () => {
    const list = await build([
      { title: 'none' },
      { title: '2000', year: '2000' },
      { title: '19??', year: '19??' },
      { title: '199?', year: '199?' },
      { title: '1999', year: '1999' },
      { title: '1990', year: '1990' },
      { title: '198?', year: '198?' },
      { title: '1989', year: '1989' },
    ])

    await sortChronologically(db(), owner, list.id)

    expect(await titles(list.id)).toEqual(['1989', '198?', '1990', '1999', '199?', '19??', '2000', 'none'])
  })

  it('keeps the order of items with the same year, and of items with none', async () => {
    const list = await build([
      { title: 'b none' },
      { title: 'a 1999', year: '1999' },
      { title: 'a none' },
      { title: 'b 1999', year: '1999' },
      { title: 'a 199?', year: '199?' },
      { title: 'b 199?', year: '199?' },
    ])

    await sortChronologically(db(), owner, list.id)

    expect(await titles(list.id)).toEqual(['a 1999', 'b 1999', 'a 199?', 'b 199?', 'b none', 'a none'])
  })

  it('places a group by its earliest item and sorts inside it by the same key', async () => {
    const list = await build([
      { title: 'loose 1998', year: '1998' },
      { title: 'in 199?', year: '199?', group: 'Arc' },
      { title: 'in 1995', year: '1995', group: 'Arc' },
      { title: 'loose 1996', year: '1996' },
      { title: 'in 19??', year: '19??', group: 'Late' },
      { title: 'loose 1999', year: '1999' },
    ])

    await sortChronologically(db(), owner, list.id)

    // Arc's earliest is 1995; Late is 19?? (as late as 1999.2) so it follows the loose 1999.
    expect(await titles(list.id)).toEqual(['in 1995', 'in 199?', 'loose 1996', 'loose 1998', 'loose 1999', 'in 19??'])
    expect((await findListGroups(db(), owner, list.id))!.map((group) => group.name)).toEqual(['Arc', 'Late'])
  })

  it('puts a group with no dated item after every dated one, in the order it had', async () => {
    const list = await build([
      { title: 'undated', group: 'Undated' },
      { title: 'dated', year: '2001', group: 'Dated' },
      { title: 'loose', year: '2010' },
    ])

    await sortChronologically(db(), owner, list.id)

    expect(await titles(list.id)).toEqual(['dated', 'loose', 'undated'])
  })

  it('orders the groups of an imported list by the same key, once, when it arrives', async () => {
    // By the earliest year alone, 199? (1990) would come before 1995; as late as it can be (1999.1) it comes after.
    const list = await build([
      { title: 'a', year: '199?', group: 'Fuzzy' },
      { title: 'b', year: '1995', group: 'Exact' },
      { title: 'c', group: 'Nothing' },
    ])

    await seedGroupOrder(db(), list.id)

    expect((await findListGroups(db(), owner, list.id))!.map((group) => group.name)).toEqual(['Exact', 'Fuzzy', 'Nothing'])
  })
})
