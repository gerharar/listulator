import { describe, expect, it } from 'vitest'
import { buildListPatch, invertListPatch, type ListFields } from './listActions.js'

const LIST: ListFields = { title: 'Loki', description: 'The trickster', status: 'ongoing' }
const draft = (over: Partial<{ title: string; description: string; status: ListFields['status'] }> = {}) => ({
  title: LIST.title,
  description: LIST.description ?? '',
  status: LIST.status,
  ...over,
})

describe('buildListPatch', () => {
  it('is null when nothing changed', () => {
    expect(buildListPatch(LIST, draft())).toBeNull()
  })

  it('carries only the fields that changed', () => {
    expect(buildListPatch(LIST, draft({ title: 'Loki S2' }))).toEqual({ title: 'Loki S2' })
    expect(buildListPatch(LIST, draft({ description: 'New' }))).toEqual({ description: 'New' })
    expect(buildListPatch(LIST, draft({ status: 'complete' }))).toEqual({ status: 'complete' })
  })

  it('trims, and treats whitespace-only changes as no change', () => {
    expect(buildListPatch(LIST, draft({ title: '  Loki  ' }))).toBeNull()
    expect(buildListPatch(LIST, draft({ title: ' Loki S2 ' }))).toEqual({ title: 'Loki S2' })
  })

  it('cannot be saved with a blank title', () => {
    expect(buildListPatch(LIST, draft({ title: '   ' }))).toBeNull()
  })

  it('clears a description by emptying it, and a status by choosing Not known', () => {
    expect(buildListPatch(LIST, draft({ description: '  ' }))).toEqual({ description: null })
    expect(buildListPatch(LIST, draft({ status: null }))).toEqual({ status: null })
  })

  it('does not call a missing description a change when the box stays empty', () => {
    const bare: ListFields = { title: 'X', description: null, status: null }

    expect(buildListPatch(bare, { title: 'X', description: '', status: null })).toBeNull()
  })
})

describe('invertListPatch', () => {
  it('puts each changed field back the way it was', () => {
    expect(invertListPatch(LIST, { title: 'Loki S2', status: 'complete' })).toEqual({
      title: 'Loki',
      status: 'ongoing',
    })
  })

  it('brings back an absent description as null', () => {
    const bare: ListFields = { title: 'X', description: null, status: null }

    expect(invertListPatch(bare, { description: 'Now set' })).toEqual({ description: null })
  })

  it('leaves alone what the patch did not touch', () => {
    expect(invertListPatch(LIST, { description: 'New' })).toEqual({ description: 'The trickster' })
  })
})
