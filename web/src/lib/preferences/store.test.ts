import { describe, expect, it } from 'vitest'
import { listPreferenceKey } from './store.js'

describe('listPreferenceKey', () => {
  it('namespaces the same preference key differently for two different lists', () => {
    const listA = listPreferenceKey('list-a', 'collapse')
    const listB = listPreferenceKey('list-b', 'collapse')

    expect(listA).not.toBe(listB)
  })

  it('namespaces two different preference keys differently for the same list', () => {
    const collapse = listPreferenceKey('list-a', 'collapse')
    const lastFocusedRow = listPreferenceKey('list-a', 'lastFocusedRow')

    expect(collapse).not.toBe(lastFocusedRow)
  })
})
