import { describe, expect, it } from 'vitest'
import { cleanCell, cleanMarkup, parseTable, splitSections, CELL_MAX_CHARS } from './wikitext.js'

/**
 * Hostile page text (security review, Phase 19, SR-024). Every regex in the wikitext reader was tried at each start position and
 * scanned on to the end of the text when its closing part was missing, so a page holding one such run made the reader take seconds
 * to hours on the UI thread (64 KB of `== a` and spaces: 4.8 s, and every time quadrupled when the text doubled). Anyone may edit
 * the pages the Wrestling and MMA categories read. The reader is now linear, and these inputs prove it: each is a megabyte, which
 * a quadratic reader would need minutes to hours for, and must finish in well under a second.
 *
 * The second half holds the new code to the old: the regex versions are kept here as the reference, and random markup must come
 * out the same, so the rewrite cannot quietly change what a real page reads as.
 */

const MB = 1_000_000
const BUDGET_MS = 1_500

const hostileCells: [string, string][] = [
  ['a reference opener never closed', '<ref '.repeat(MB / 5)],
  ['a reference never closed', '<ref>'.repeat(MB / 5)],
  ['a reference with a long tag and no closer', '<ref name=a>'.repeat(MB / 12)],
  ['a self-closing look-alike', '<ref/'.repeat(MB / 5)],
  ['an opening tag never closed', '<a '.repeat(MB / 3)],
  ['nothing but angle brackets', '<'.repeat(MB)],
  ['a link never closed', '[[a'.repeat(MB / 3)],
  ['a piped link never closed', '[[a|'.repeat(MB / 4)],
  ['one link with a very long label', `[[a${'|b'.repeat(MB / 2)}`],
  ['a sort template never closed', '{{sort|a|'.repeat(MB / 9)],
  ['a sort template with no key end', '{{sort|'.repeat(MB / 7)],
  ['template openers', '{{'.repeat(MB / 2)],
  ['quotes', "''".repeat(MB / 2)],
  ['a line break tag with endless spaces', `<br${' '.repeat(MB)}`],
  ['line break openers', '<br '.repeat(MB / 4)],
  ['whitespace', ' \t\n'.repeat(MB / 3)],
  ['a closer with nothing before it', '</ref>'.repeat(MB / 6)],
  ['mixed openers', '<ref [[a|{{sort|x|<b '.repeat(MB / 21)],
]

const hostileHeadings: [string, string][] = [
  ['a heading whose end never comes', `== a${' '.repeat(MB)}`],
  ['a heading of words and spaces', `== ${'a '.repeat(MB / 2)}`],
  ['a heading full of equals signs', `==a${'= '.repeat(MB / 2)}`],
  ['a very long heading with a closing run', `== ${'a'.repeat(MB)} ==`],
  ['equals signs only', '='.repeat(MB)],
  ['many headings', '== a ==\n'.repeat(MB / 8)],
  ['many opening runs on one line', '== '.repeat(MB / 3)],
]

describe('the wikitext reader stays linear on hostile text', () => {
  const took = (action: () => unknown): number => {
    const start = performance.now()
    action()

    return performance.now() - start
  }

  it.each(hostileCells)('cleans %s in well under a second', (_name, cell) => {
    expect(took(() => cleanMarkup(cell))).toBeLessThan(BUDGET_MS)
  })

  it.each(hostileHeadings)('splits %s in well under a second', (_name, text) => {
    expect(took(() => splitSections(text))).toBeLessThan(BUDGET_MS)
  })

  it('reads a table holding a hostile cell in well under a second', () => {
    for (const [, cell] of hostileCells) {
      const table = `{|\n|-\n! Event !! Date\n|-\n| ${cell} || 2024\n|}`

      expect(took(() => parseTable(table))).toBeLessThan(BUDGET_MS)
    }
  })

  it('cuts a cell at the limit, so even the least bad input costs a bounded amount', () => {
    expect(CELL_MAX_CHARS).toBe(20_000)
    expect(cleanCell('a'.repeat(CELL_MAX_CHARS * 3)).length).toBe(CELL_MAX_CHARS)
    expect(cleanCell(`${'x'.repeat(CELL_MAX_CHARS)}[[Page|Label]]`)).toBe('x'.repeat(CELL_MAX_CHARS))
  })
})

/** What the reader did before: the regexes that were quadratic. The reference for the comparison below. */
function referenceCleanCell(raw: string): string {
  return raw
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{sort\|[^|{}]*\|([\s\S]*?)\}\}/gi, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/''+/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function referenceSplitSections(wikitext: string) {
  const sections: { heading: string; body: string; level: number }[] = []
  const pattern = /^(==+)\s*(.+?)\s*==+\s*$/gm
  let lastHeading = ''
  let lastLevel = 0
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(wikitext)) !== null) {
    sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex, match.index), level: lastLevel })
    lastHeading = match[2]!
    lastLevel = match[1]!.length
    lastIndex = pattern.lastIndex
  }
  sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex), level: lastLevel })

  return sections
}

/** A small seeded generator, so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 2 ** 32
  }
}

describe('the linear reader reads what the regex reader read', () => {
  const FRAGMENTS = [
    '<ref', '<REF', '<ref name=a', '<ref name="a b"', '/', '>', '</ref>', '</REF>', '<br', '<br/>', '<br />', '<', 'b', '<b>', '</b>',
    '[[', ']]', ']', '[', '|', '||', '{{sort|', '{{SORT|', '{{', '}}', '}', '{', 'x', 'UFC 1', 'Page', 'Label', "'", "''", "'''",
    '&nbsp;', '&amp;', '&NBSP;', ' ', '  ', '\n', '\t', '0', '-',
  ]

  it('on 6,000 random strings of markup fragments', () => {
    const next = random(20261007)
    const differences: string[] = []

    for (let sample = 0; sample < 6_000; sample += 1) {
      const length = 1 + Math.floor(next() * 14)
      const text = Array.from({ length }, () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]).join('')
      if (cleanMarkup(text) !== referenceCleanCell(text)) differences.push(JSON.stringify(text))
    }

    expect(differences.slice(0, 5)).toEqual([])
  })

  it.each([
    ['a reference with a citation', 'UFC 1<ref name="a">{{cite web|url=https://x.org/|title=T}}</ref> The Beginning'],
    ['a self-closing reference', 'Event<ref name="x" />'],
    ['a sort template with a link', '{{sort|UFC 001|[[UFC 1|UFC 1: The Beginning]]}}'],
    ['links of both kinds', '[[Madison Square Garden]] and [[Las Vegas|Vegas]]'],
    ['quotes and entities', "''Bold'' '''move''' &amp; &nbsp;more"],
    ['line breaks and tags', 'Line one<br>Line two<br/>Three <span class="x">four</span>'],
    ['an unclosed reference', 'Before<ref>never closed'],
    ['a template to strip', 'A {{flag|USA}} B {{nowrap|C}}'],
    ['nested sort and link', '{{sort|k|[[A|B]]}} {{sort|j|plain}}'],
  ])('on a real-looking cell: %s', (_name, cell) => {
    expect(cleanMarkup(cell)).toBe(referenceCleanCell(cell))
  })

  it('on every line shape a heading can have, but a line of equals signs alone', () => {
    const next = random(7)
    const PARTS = ['=', '==', '===', ' ', 'a', 'b c', '= ', ' =', '\r']
    const differences: string[] = []

    for (let sample = 0; sample < 6_000; sample += 1) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
        Array.from({ length: 1 + Math.floor(next() * 7) }, () => PARTS[Math.floor(next() * PARTS.length)]).join(''),
      )
      // A line of nothing but equals signs and spaces has no heading in it. The regex found one anyway: by splitting the run
      // (`=====` as `==` `=` `==`), or by reaching over a line break (`===` then `a==`, or `== a` then `==`, was a heading
      // across two lines, because its `\s*` matches a line break), neither of which any page means.
      const actual = lines.join('\n').split(/[\n\r\u2028\u2029]/)
      if (actual.some((line) => /^[=\s]*$/.test(line) && (line.match(/=/g)?.length ?? 0) >= 2)) continue
      const text = lines.join('\n')
      const shape = (sections: { heading: string; body: string; level: number }[]) => sections.map((section) => [section.heading, section.level, section.body.trim()])

      if (JSON.stringify(shape(splitSections(text))) !== JSON.stringify(shape(referenceSplitSections(text)))) differences.push(JSON.stringify(text))
    }

    expect(differences.slice(0, 5)).toEqual([])
  })

  it('on a page shaped like the ones it reads', () => {
    const page = [
      'Lead text.',
      '== Past events ==',
      '=== 2024 ===',
      '{|\n|-\n| UFC 300 || April 13\n|}',
      '== See also ==',
      'x',
      '====Deeper====',
      '== Upcoming event schedule ==\r\ny',
    ].join('\n')

    expect(splitSections(page).map((s) => [s.heading, s.level, s.body.trim()])).toEqual(
      referenceSplitSections(page).map((s) => [s.heading, s.level, s.body.trim()]),
    )
  })
})
