import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem, updateListItem } from './repository.js'
import { InvalidNoteError } from './userNotes.js'

/**
 * H-003 / BL-043: an item may carry the user's own note (`user_note`, `userNote` in the API), a field of its own beside the
 * curator's read-only `notes`. Checked in the repository, the one place the server and the desktop both go through.
 */
describe('an item’s own note (the user’s)', () => {
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
  const newList = () => createList(db(), owner, { title: 'Movies', mediaType: 'movie' })
  const row = (itemId: string) => db().select().from(listItems).where(eq(listItems.id, itemId)).get()!
  const inject = (method: 'POST' | 'PATCH' | 'GET' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as never } : {}) })
  const make = async (extra: Record<string, unknown> = {}) => {
    const list = await newList()
    const item = (await createListItem(db(), owner, list.id, { title: 'Crime Story', timeToConsumeMinutes: 107, ...extra }))!

    return { list, item }
  }

  describe('in the repository', () => {
    it('has no note unless one is given', async () => {
      const { item } = await make()

      expect(row(item.id).userNote).toBeNull()
    })

    it('stores a note on a new item, trimmed', async () => {
      const { item } = await make({ userNote: '  The serious one.  ' })

      expect(row(item.id).userNote).toBe('The serious one.')
    })

    it('sets, changes and clears a note by editing the item', async () => {
      const { list, item } = await make()

      await updateListItem(db(), owner, list.id, item.id, { userNote: 'Watch the Cantonese cut.' })
      expect(row(item.id).userNote).toBe('Watch the Cantonese cut.')

      await updateListItem(db(), owner, list.id, item.id, { userNote: 'Skipped the first time.' })
      expect(row(item.id).userNote).toBe('Skipped the first time.')

      await updateListItem(db(), owner, list.id, item.id, { userNote: '' })
      expect(row(item.id).userNote).toBeNull()
    })

    it.each([['an empty note', ''], ['spaces only', '   \n '], ['null', null]])('clears the note with %s', async (_name, value) => {
      const { list, item } = await make({ userNote: 'A note' })

      await updateListItem(db(), owner, list.id, item.id, { userNote: value })

      expect(row(item.id).userNote).toBeNull()
    })

    it('leaves the note alone when an edit does not mention it', async () => {
      const { list, item } = await make({ userNote: 'Keep me' })

      await updateListItem(db(), owner, list.id, item.id, { title: 'Renamed' })

      expect(row(item.id)).toMatchObject({ title: 'Renamed', userNote: 'Keep me' })
    })

    it('never touches the curator’s notes, and the curator’s notes are never the user’s', async () => {
      const { list, item } = await make({ notes: 'Curator prose', userNote: 'Mine' })

      await updateListItem(db(), owner, list.id, item.id, { userNote: 'Mine, changed' })

      expect(row(item.id)).toMatchObject({ notes: 'Curator prose', userNote: 'Mine, changed' })
    })

    it('takes controls and direction overrides out of what is typed, and keeps its lines', async () => {
      const { list, item } = await make()

      await updateListItem(db(), owner, list.id, item.id, { userNote: 'one\u0000\r\ntwo‮txt' })

      expect(row(item.id).userNote).toBe('one\ntwotxt')
    })

    it('takes a note of 2,048 characters and refuses 2,049, on a new item and on an edit, writing nothing', async () => {
      const { list, item } = await make({ userNote: 'before' })

      await expect(updateListItem(db(), owner, list.id, item.id, { userNote: 'a'.repeat(2048) })).resolves.toBeTruthy()
      await expect(updateListItem(db(), owner, list.id, item.id, { userNote: 'b'.repeat(2049) })).rejects.toBeInstanceOf(InvalidNoteError)
      expect(row(item.id).userNote).toBe('a'.repeat(2048))
      await expect(createListItem(db(), owner, list.id, { title: 'Too much', timeToConsumeMinutes: 1, userNote: 'c'.repeat(2049) })).rejects.toBeInstanceOf(InvalidNoteError)
    })
  })

  describe('over the API', () => {
    it('edits the note with PATCH and reads it with the list', async () => {
      const { list, item } = await make()

      const patched = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { userNote: 'Watch the Cantonese cut.' })

      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toMatchObject({ userNote: 'Watch the Cantonese cut.' })
      expect((await inject('GET', `/lists/${list.id}`)).json().items[0]).toMatchObject({ userNote: 'Watch the Cantonese cut.' })
    })

    it('says a list’s items have no note, as null, until they do', async () => {
      const { list } = await make()

      expect((await inject('GET', `/lists/${list.id}`)).json().items[0]).toMatchObject({ userNote: null })
    })

    it('clears the note with null', async () => {
      const { list, item } = await make({ userNote: 'A note' })

      const patched = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { userNote: null })

      expect(patched.json()).toMatchObject({ userNote: null })
    })

    it('accepts a note when an item is added by hand', async () => {
      const { list } = await make()

      const created = await inject('POST', `/lists/${list.id}/items`, { title: 'Thunderbolt', timeToConsumeMinutes: 110, userNote: 'Hand-added' })

      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({ userNote: 'Hand-added' })
    })

    it('says "item.noteTooLong" for a note over 2,048 characters, rather than a framework message, and changes nothing', async () => {
      const { list, item } = await make({ userNote: 'before' })

      const patched = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { userNote: 'x'.repeat(2049) })

      expect(patched.statusCode).toBe(400)
      expect(patched.json()).toEqual({ code: 'item.noteTooLong' })
      expect(row(item.id).userNote).toBe('before')
      const created = await inject('POST', `/lists/${list.id}/items`, { title: 'T', timeToConsumeMinutes: 1, userNote: 'x'.repeat(2049) })
      expect(created.json()).toEqual({ code: 'item.noteTooLong' })
    })

    it('refuses a note that is not text (an object, a list)', async () => {
      const { list, item } = await make()

      expect((await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { userNote: { text: 'x' } })).statusCode).toBe(400)
      expect((await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { userNote: ['x'] })).statusCode).toBe(400)
    })

    it('puts a deleted item back with its note, from the payload the delete handed out (Undo)', async () => {
      const { list, item } = await make({ userNote: 'Mira says it’s better than season 2' })

      const deleted = await inject('DELETE', `/lists/${list.id}/items/${item.id}`)
      expect(deleted.json().restore.item).toMatchObject({ userNote: 'Mira says it’s better than season 2' })
      const restored = await inject('POST', `/lists/${list.id}/items/restore`, deleted.json().restore)

      expect(restored.statusCode).toBe(200)
      expect(row(item.id).userNote).toBe('Mira says it’s better than season 2')
    })

    it('still puts an item back from a payload written before notes existed', async () => {
      const { list, item } = await make({ userNote: 'Will be lost: the old payload has none' })
      const deleted = await inject('DELETE', `/lists/${list.id}/items/${item.id}`)
      const before = { ...deleted.json().restore.item }
      delete before.userNote

      const restored = await inject('POST', `/lists/${list.id}/items/restore`, { item: before })

      expect(restored.statusCode).toBe(200)
      expect(row(item.id).userNote).toBeNull()
    })
  })
})
