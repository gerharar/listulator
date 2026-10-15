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
  yearUnk: 0,
  isNew: false,
}

describe('ItemInfoCard', () => {
  it('shows the year as the row does, with its unknown digits as ? (H-005)', () => {
    render(<ItemInfoCard item={{ ...ITEM, year: 1990, yearUnk: 1 }} />)

    expect(screen.getByText('199?')).toBeTruthy()
  })

  it('shows the item’s title and a placeholder where its cover will go', () => {
    render(<ItemInfoCard item={ITEM} />)

    expect(screen.getByText('Batman Begins')).toBeTruthy()
    expect(document.querySelector('.q-info-cover')).not.toBeNull()
  })

  it('shows the item’s notes when it has them', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: 'The game on this platform has extra missions.' }} />)

    expect(screen.getByText('The game on this platform has extra missions.')).toBeTruthy()
  })

  it('has no line about an estimated length: the row carries the ≈ now (owner, 2026-10-15)', () => {
    render(<ItemInfoCard item={{ ...ITEM, timeToConsumeIsEstimated: true }} />)

    expect(document.querySelector('.q-info-note')).toBeNull()
    expect(screen.queryByText('This runtime is a rough estimate')).toBeNull()
  })

  it('leaves no empty slot when there are no notes', () => {
    render(<ItemInfoCard item={ITEM} />)

    expect(document.querySelector('.q-info-notes')).toBeNull()
  })

  it('shows no notes for a blank note', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: '   ' }} />)

    expect(document.querySelector('.q-info-notes')).toBeNull()
  })

  it('is read-only: no field to edit the notes, now or later this phase', () => {
    render(<ItemInfoCard item={{ ...ITEM, notes: 'Curator note' }} />)

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows "-" and no estimate note while its length is still being looked up (15.7)', () => {
    render(<ItemInfoCard item={{ ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, runtimePending: true }} />)

    expect(screen.getByText('-')).toBeTruthy()
    expect(screen.queryByText('2h')).toBeNull()
    expect(screen.queryByText(/estimate/i)).toBeNull()
  })
})
