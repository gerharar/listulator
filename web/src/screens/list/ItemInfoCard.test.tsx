// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ListItem } from '../../lib/api.js'
import { ItemInfoCard } from './ItemInfoCard.js'

afterEach(cleanup)

const ITEM: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Batman Begins',
  orderIndex: 0,
  timeToConsumeMinutes: 140,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: 2005,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
}

describe('ItemInfoCard', () => {
  it('shows the item’s title and a placeholder where its cover will go', () => {
    render(<ItemInfoCard item={ITEM} />)

    expect(screen.getByText('Batman Begins')).toBeTruthy()
    expect(document.querySelector('.q-info-cover')).not.toBeNull()
  })

  it('shows the item’s notes when it has them', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: 'The game on this platform has extra missions.' }} />)

    expect(screen.getByText('The game on this platform has extra missions.')).toBeTruthy()
  })

  it('leaves no empty slot when there are no notes', () => {
    render(<ItemInfoCard item={ITEM} />)

    expect(document.querySelector('.q-info-notes')).toBeNull()
  })

  it('shows no notes for a blank note', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: '   ' }} />)

    expect(document.querySelector('.q-info-notes')).toBeNull()
  })

  it('says the runtime is an estimate when it is one', () => {
    render(<ItemInfoCard item={{ ...ITEM, timeToConsumeIsEstimated: true }} />)

    expect(screen.getByText(/estimate/i)).toBeTruthy()
  })

  it('is read-only: no field to edit the notes, now or later this phase', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: 'Curator note' }} />)

    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
