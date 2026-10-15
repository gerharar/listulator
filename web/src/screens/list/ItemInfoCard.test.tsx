// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  userNote: null,
  yearUnk: 0,
  isNew: false,
}

const CURATOR = 'Prequel to the series. Fine to watch any time before season 2.'
const MINE = 'Skipped the first time.\nMira says it is better than season 2.'

function renderCard(item: Partial<ListItem>, onEditNote = vi.fn()) {
  render(<ItemInfoCard item={{ ...ITEM, ...item }} onEditNote={onEditNote} />)
  return onEditNote
}

/** The card's parts in reading order, as the design lays them out. */
const order = () =>
  [...document.querySelector('.q-info')!.children].map((child) =>
    child.tagName === 'HR' ? 'hr' : child.className.replace(/^q-/, '') || child.textContent,
  )

describe('ItemInfoCard (H-003): the notes of an item, and whose they are', () => {
  it('a curator note only: the title, then its kicker and the note, no pencil', () => {
    renderCard({ notes: CURATOR })

    expect(order()).toEqual(['info-title', 'kicker', 'info-text'])
    expect(screen.getByText('Curator note').className).toBe('q-kicker')
    expect(screen.getByText(CURATOR)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a note of the user’s only: the title, then its kicker with the pencil and the note', () => {
    renderCard({ userNote: MINE })

    expect(order()).toEqual(['info-title', 'info-head', 'info-text'])
    expect(document.querySelector('.q-info-head')!.textContent).toContain('Your note')
    expect(screen.getByRole('button', { name: 'Edit your note' })).toBeTruthy()
  })

  it('both: the title first, then the curator’s note, a hairline, and the user’s note with its pencil', () => {
    renderCard({ notes: CURATOR, userNote: MINE })

    expect(order()).toEqual(['info-title', 'kicker', 'info-text', 'hr', 'info-head', 'info-text'])
    const kickers = [...document.querySelectorAll('.q-kicker')].map((node) => node.textContent)
    expect(kickers).toEqual(['Curator note', 'Your note'])
  })

  it('keeps the line breaks that were typed', () => {
    renderCard({ userNote: MINE })

    const body = [...document.querySelectorAll('.q-info-text')].at(-1) as HTMLElement
    expect(body.textContent).toBe(MINE)
    // jsdom does not apply the stylesheet, so the rule that keeps the breaks is read from it.
    const css = readFileSync(join(import.meta.dirname, 'ItemInfoCard.css'), 'utf8')
    expect(css).toMatch(/\.q-info-text\s*\{[^}]*white-space:\s*pre-line/)
  })

  it('the pencil on Your note asks for the Edit window on the note; the curator’s note has none', () => {
    const onEditNote = renderCard({ notes: CURATOR, userNote: MINE })

    fireEvent.click(screen.getByRole('button', { name: 'Edit your note' }))

    expect(onEditNote).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('has the title bold, in the sans family the prototype names (the app’s --font does not exist)', () => {
    const css = readFileSync(join(import.meta.dirname, 'ItemInfoCard.css'), 'utf8')

    expect(css).toMatch(/\.q-info-title\s*\{[^}]*font:\s*600 15px\/1\.25 var\(--font-sans\)/)
  })

  it('shows no cover, year or length any more: the row has those', () => {
    renderCard({ notes: CURATOR, timeToConsumeIsEstimated: true })

    expect(document.querySelector('.q-info-cover')).toBeNull()
    expect(document.querySelector('.q-info-facts')).toBeNull()
    expect(screen.queryByText('2005')).toBeNull()
    expect(screen.queryByText('2h 20m')).toBeNull()
    expect(screen.queryByText(/estimate/i)).toBeNull()
  })

  it('is read-only: the notes are text, never a field', () => {
    renderCard({ notes: CURATOR, userNote: MINE })

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('draws a note as text, so markup in it stays text', () => {
    renderCard({ userNote: '<img src=x onerror=alert(1)> **bold**' })

    expect(document.querySelector('.q-info img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)> **bold**')).toBeTruthy()
  })
})
