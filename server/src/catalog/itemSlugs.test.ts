import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem } from './repository.js'
import { missingSlugRefs, recordSlugs, slugsForList, unansweredRefs } from './itemSlugs.js'

/**
 * H-002 (BL-087), IGDB: a page address needs the game's slug, which the item does not carry. The slug is a public
 * fact about the source's item, so it is cached by ref like a length (`item_runtimes`), not stored on the item.
 */
describe('item slugs', () => {
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
  const NOW = new Date('2026-10-14T12:00:00Z')

  const gameList = async (title: string, refs: (string | null)[]) => {
    const list = await createList(db(), owner, { title, mediaType: 'game', source: 'api', externalRef: 'franchise:1' })
    for (const [index, ref] of refs.entries()) {
      await createListItem(db(), owner, list.id, {
        title: `Game ${index}`,
        timeToConsumeMinutes: 600,
        source: ref ? 'import' : 'manual',
        ...(ref ? { externalRef: ref } : {}),
      })
    }

    return list
  }

  describe('recordSlugs and slugsForList', () => {
    it('remembers a slug, and "IGDB has none" as an answer of its own', async () => {
      const list = await gameList('Zelda', ['game:1', 'game:2', 'game:3'])
      await recordSlugs(db(), [{ ref: 'game:1', slug: 'the-witcher-3-wild-hunt' }, { ref: 'game:2', slug: null }], NOW)

      const found = await slugsForList(db(), list.id)

      expect(found.get('game:1')).toBe('the-witcher-3-wild-hunt')
      expect(found.has('game:2')).toBe(true)
      expect(found.get('game:2')).toBeNull()
      expect(found.has('game:3')).toBe(false)
    })

    it('replaces an earlier answer for the same ref', async () => {
      const list = await gameList('Zelda', ['game:1'])
      await recordSlugs(db(), [{ ref: 'game:1', slug: 'old-slug' }], NOW)
      await recordSlugs(db(), [{ ref: 'game:1', slug: 'new-slug' }], new Date(NOW.getTime() + 1000))

      expect((await slugsForList(db(), list.id)).get('game:1')).toBe('new-slug')
    })

    it('is shared between lists: a game in two lists is asked once', async () => {
      const first = await gameList('One', ['game:1'])
      const second = await gameList('Two', ['game:1'])
      await recordSlugs(db(), [{ ref: 'game:1', slug: 'shared' }], NOW)

      expect((await slugsForList(db(), first.id)).get('game:1')).toBe('shared')
      expect((await slugsForList(db(), second.id)).get('game:1')).toBe('shared')
    })

    it('gives a list only its own items’ slugs, not the whole table', async () => {
      const list = await gameList('Mine', ['game:1'])
      await recordSlugs(db(), [{ ref: 'game:1', slug: 'mine' }, { ref: 'game:99', slug: 'someone-elses' }], NOW)

      expect([...(await slugsForList(db(), list.id)).keys()]).toEqual(['game:1'])
    })

    it('records and reads more rows than one statement can bind', async () => {
      const refs = Array.from({ length: 1200 }, (_, index) => `game:${index + 1}`)
      const list = await gameList('Big', refs)
      await recordSlugs(db(), refs.map((ref) => ({ ref, slug: `slug-${ref.slice(5)}` })), NOW)

      const found = await slugsForList(db(), list.id)

      expect(found.size).toBe(1200)
      expect(found.get('game:1200')).toBe('slug-1200')
    })

    it('records nothing, and asks nothing, for an empty batch', async () => {
      await expect(recordSlugs(db(), [], NOW)).resolves.toBeUndefined()
    })
  })

  describe('missingSlugRefs', () => {
    it('lists the refs of the kinds asked for that have no answer yet, in list order, each once', async () => {
      const list = await gameList('Zelda', ['game:3', 'game:1', 'game:2', 'game:1'])
      await recordSlugs(db(), [{ ref: 'game:2', slug: 'two' }], NOW)

      expect(await missingSlugRefs(db(), list.id, ['game'])).toEqual(['game:3', 'game:1'])
    })

    it('counts a "none" answer as an answer, so it is not asked again', async () => {
      const list = await gameList('Zelda', ['game:1'])
      await recordSlugs(db(), [{ ref: 'game:1', slug: null }], NOW)

      expect(await missingSlugRefs(db(), list.id, ['game'])).toEqual([])
    })

    it('leaves out an item with no ref (typed in by hand) and a ref of another kind', async () => {
      const list = await gameList('Mixed', [null, 'movie:5', 'games:6', 'game:7'])

      expect(await missingSlugRefs(db(), list.id, ['game'])).toEqual(['game:7'])
    })

    it('asks nothing when no kind is given', async () => {
      const list = await gameList('Zelda', ['game:1'])

      expect(await missingSlugRefs(db(), list.id, [])).toEqual([])
    })

    it('does not look into another list', async () => {
      const mine = await gameList('Mine', ['game:1'])
      await gameList('Other', ['game:2'])

      expect(await missingSlugRefs(db(), mine.id, ['game'])).toEqual(['game:1'])
    })
  })

  describe('unansweredRefs, for a caller already holding the items', () => {
    const items = [{ externalRef: 'game:1' }, { externalRef: 'game:2' }, { externalRef: 'game:1' }, { externalRef: null }, { externalRef: 'games:3' }, { externalRef: 'movie:4' }]

    it('gives the refs of the kinds asked for with no answer, once each', () => {
      expect(unansweredRefs(items, new Map([['game:2', 'two']]), ['game'])).toEqual(['game:1'])
    })

    it('counts a "none" answer as an answer', () => {
      expect(unansweredRefs(items, new Map([['game:1', null], ['game:2', null]]), ['game'])).toEqual([])
    })

    it('gives nothing for a kind that is not asked for', () => {
      expect(unansweredRefs(items, new Map(), [])).toEqual([])
    })
  })
})
