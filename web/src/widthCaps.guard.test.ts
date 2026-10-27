import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Canvas H-021 (Phase 37): text inside a card (a header's description or subline, a help or error line) runs to the edge of the box it sits in
 * and is not held to a column of its own; the card's 1080 px is the measure. This reads the CSS, because a cap is one line anyone can put back, and
 * pins both halves of the entry: the text boxes that must have NO `max-width`, and the caps that size a CONTAINER, which stay exactly as they are.
 */

const SRC = join(import.meta.dirname)
const css = (file: string): string => readFileSync(join(SRC, file), 'utf8')

/** The declaration blocks of every rule whose selector list names `selector` exactly (comments removed; a rule inside a media query counts). */
export function declarationsOf(source: string, selector: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: string[] = []
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(',').map((part) => part.trim().replace(/\s+/g, ' '))
    if (selectors.includes(selector)) found.push(rule[2]!)
  }

  return found
}

/** The values of every `max-width` the selector's rules declare. */
export function maxWidthsOf(source: string, selector: string): string[] {
  return declarationsOf(source, selector).flatMap((block) => [...block.matchAll(/(?:^|[;\s])max-width\s*:\s*([^;}]+)/g)].map((match) => match[1]!.trim()))
}

describe('the width guard\'s own reading of CSS', () => {
  const sample = `
    /* .q-gone { max-width: 1px } */
    .q-a, .q-b p { margin: 0; max-width: 600px; }
    .q-a-long { max-width: 9px }
    @media (max-width: 500px) { .q-a { max-width: none; } }
    .q-c  .q-d { color: red }
  `

  it('finds a rule by its exact selector, also in a comma list and inside a media query, and reads the cap', () => {
    expect(maxWidthsOf(sample, '.q-a')).toEqual(['600px', 'none'])
    expect(maxWidthsOf(sample, '.q-b p')).toEqual(['600px'])
  })

  it('does not take a longer selector, a comment, or a media query\'s own condition for a cap', () => {
    expect(maxWidthsOf(sample, '.q-a-long')).toEqual(['9px'])
    expect(maxWidthsOf(sample, '.q-gone')).toEqual([])
    expect(declarationsOf(sample, '.q-c .q-d')).toHaveLength(1)
    expect(maxWidthsOf(sample, '.q-c .q-d')).toEqual([])
  })

  it('says a selector that is not there has no rule, so a rename cannot make a check pass by finding nothing', () => {
    expect(declarationsOf(sample, '.q-missing')).toEqual([])
  })
})

/** Text the entry frees: file and selector. A cap on any of them is a layout bug (owner, 2026-10-26: it broke short descriptions in the middle of a wide card). */
const NO_CAP: readonly (readonly [string, string])[] = [
  ['screens/list/ListScreen.css', '.q-list-description'],
  ['components/quantum/CreateList/CreateList.css', '.q-create-sub'],
  ['components/quantum/CategoryPicker/CategoryPicker.css', '.q-picker-sub'],
  ['components/quantum/VaultShelf/VaultShelf.css', '.q-vault-line'],
  ['components/quantum/VaultBrowser/VaultBrowser.css', '.q-vb-sub'],
  ['components/quantum/ErrorBlock/ErrorBlock.css', '.q-error-block p'],
  ['components/quantum/HelperSheet/HelperSheet.css', '.q-reel-note'],
]

/** What sizes a container and stays (the entry's keep list), with its value. */
const KEPT: readonly (readonly [string, string, string])[] = [
  ['components/quantum/Sheet/Sheet.css', '.q-sheet', '640px'],
  ['components/quantum/Toast/Toast.css', '.q-toast', '620px'],
  ['components/quantum/Tooltip/Tooltip.css', '.q-tooltip', '320px'],
  ['components/quantum/AddByHandTab/AddByHandTab.css', '.q-hand', '640px'],
  ['components/quantum/ImportFileTab/ImportFileTab.css', '.q-import', '640px'],
  ['screens/settings/SettingsScreen.css', '.q-settings-sections', '880px'],
  ['screens/about/AboutScreen.css', '.q-about-column', '760px'],
  ['components/quantum/LayerCard/LayerCard.css', '.q-layer', '1080px'],
  ['components/quantum/LayerCard/LayerCard.css', '.q-layer.wide', '1400px'],
  ['components/quantum/AppErrorBoundary/AppErrorBoundary.css', '.q-crash .q-error-block', '480px'],
  // The one line of text that keeps a short measure: centred text needs one.
  ['components/quantum/VaultBrowser/VaultBrowser.css', '.q-vb-empty-line', '440px'],
]

describe('text inside a card runs to the edge of its box (H-021)', () => {
  it.each(NO_CAP)('%s: %s has no cap', (file, selector) => {
    const source = css(file)

    // It must exist, or a rename would pass by finding nothing.
    expect(declarationsOf(source, selector), `${selector} is not in ${file}`).not.toHaveLength(0)
    expect(maxWidthsOf(source, selector).filter((value) => value !== 'none'), `${selector} in ${file}`).toEqual([])
  })
})

describe('the caps that size a container stay, exactly (H-021)', () => {
  it.each(KEPT)('%s: %s is %s', (file, selector, width) => {
    const source = css(file)

    expect(declarationsOf(source, selector), `${selector} is not in ${file}`).not.toHaveLength(0)
    expect(maxWidthsOf(source, selector)).toEqual([width])
  })
})

/** Whether any rule of the selector declares `property: value`. */
const declares = (source: string, selector: string, property: string, value: RegExp): boolean =>
  declarationsOf(source, selector).some((block) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*${value.source}\\s*(?:;|$)`).test(block.trim()))

describe('how that text wraps (H-021: it wraps only when it is longer than its box, and no one-word last line)', () => {
  /** The text boxes of the entry, plus the browser's centred line that keeps its measure. */
  const PRETTY: readonly (readonly [string, string])[] = [...NO_CAP, ['components/quantum/VaultBrowser/VaultBrowser.css', '.q-vb-empty-line']]

  it.each(PRETTY)('%s: %s wraps with text-wrap: pretty', (file, selector) => {
    expect(declares(css(file), selector, 'text-wrap', /pretty/), `${selector} in ${file}`).toBe(true)
  })

  // An unbreakable run (a long address in a description) would otherwise sit over the header's buttons: the entry's own test is that no header
  // text overlaps or pushes them, and `min-width: 0` alone does not stop a word from overflowing its box (an engineering addition, owner 2026-10-27).
  it.each(NO_CAP)('%s: %s breaks a word that does not fit (overflow-wrap: anywhere)', (file, selector) => {
    expect(declares(css(file), selector, 'overflow-wrap', /anywhere/), `${selector} in ${file}`).toBe(true)
  })

  // The text box is a flex child beside the header's buttons: without min-width: 0 it cannot be narrower than its longest run.
  const TITLE_BOXES: readonly (readonly [string, string])[] = [
    ['screens/list/ListScreen.css', '.q-list-titles'],
    ['components/quantum/CreateList/CreateList.css', '.q-create-titles'],
    ['components/quantum/CategoryPicker/CategoryPicker.css', '.q-picker-titles'],
    ['components/quantum/VaultBrowser/VaultBrowser.css', '.q-vb-titles'],
    ['components/quantum/VaultShelf/VaultShelf.css', '.q-vault-intro'],
  ]

  it.each(TITLE_BOXES)('%s: %s can be narrower than its text (min-width: 0)', (file, selector) => {
    expect(declares(css(file), selector, 'min-width', /0(?:px)?/), `${selector} in ${file}`).toBe(true)
  })

  // Long text beside it takes the whole row, and a flex item shrinks by default: the ✕ was squeezed from 40px to 25px (found measuring it in a browser).
  it('keeps the icon button its size when text beside it is long (flex: none)', () => {
    expect(declares(css('components/quantum/Button/Button.css'), '.q-icon-btn', 'flex', /none/)).toBe(true)
  })
})

