import { describe, expect, it } from 'vitest'
import {
  cleanCell,
  columnIndex,
  extractTables,
  parseTable,
  rowYear,
  splitSections,
} from './wikitext.js'

/** Fragments are taken verbatim from the real UFC and WWE list pages. */

describe('cleanCell', () => {
  it('shows the label of a piped link, and the page of a bare one', () => {
    expect(cleanCell('[[WrestleMania I|WrestleMania]]')).toBe('WrestleMania')
    expect(cleanCell('[[UFC 335]]')).toBe('UFC 335')
  })

  it('strips references, which carry citation soup into titles', () => {
    expect(
      cleanCell('[[UFC 335]] <ref name="x">{{Cite web|url=http://e.com|title=Some article}}</ref>'),
    ).toBe('UFC 335')
    expect(cleanCell('Event<ref name="self-closing" />')).toBe('Event')
  })

  it('removes templates and markup', () => {
    expect(cleanCell('{{dts|2026|Dec|12}}')).toBe('')
    expect(cleanCell("'''Bold event'''")).toBe('Bold event')
    expect(cleanCell('{{nowrap|November 7}}')).toBe('')
    expect(cleanCell('One<br/>Two')).toBe('One Two')
    expect(cleanCell('Cage&nbsp;Match &amp; More')).toBe('Cage Match & More')
  })

  it('leaves ordinary text alone', () => {
    expect(cleanCell('UFC Fight Night 294')).toBe('UFC Fight Night 294')
  })

  /** Verbatim from the real UFC page's earliest, three-digit-padded rows. */
  it('unwraps {{sort|key|display}} to its display text instead of dropping the whole cell', () => {
    expect(cleanCell('{{sort|UFC 001|[[UFC 1|UFC 1: The Beginning]]}}')).toBe('UFC 1: The Beginning')
    expect(cleanCell('{{sort|UFC 002|[[UFC 2|UFC 2: No Way Out]]}}')).toBe('UFC 2: No Way Out')
  })
})

describe('extractTables', () => {
  it('finds each table on a page', () => {
    const page = '{| class="wikitable"\n|a\n|}\ntext\n{| class="wikitable"\n|b\n|}'

    expect(extractTables(page)).toHaveLength(2)
  })

  it('treats a nested table as part of its parent', () => {
    const page = '{| class="wikitable"\n|{| class="inner"\n|x\n|}\n|}'

    expect(extractTables(page)).toHaveLength(1)
  })

  it('finds nothing in a page without tables', () => {
    expect(extractTables('just some prose')).toEqual([])
  })
})

describe('parseTable', () => {
  it('reads the UFC layout: event first, with templated dates', () => {
    const table = [
      '{| class="wikitable succession-box" style="font-size:90%; "',
      '! scope="col" | Event',
      '! scope="col" | Date',
      '! scope="col" | Venue',
      '|-',
      '|[[UFC 335]] ',
      '|{{dts|2026|Dec|12}}',
      '|[[T-Mobile Arena]]',
      '|-',
      '|UFC Fight Night 294',
      '|{{dts|2026|Nov|21}}',
      '|[[Ali Bin Hamad al-Attiyah Arena]]',
      '|}',
    ].join('\n')

    const rows = parseTable(table)

    expect(rows[0]?.headers).toEqual(['Event', 'Date', 'Venue'])
    expect(rows.map((row) => row.cells[0])).toEqual(['UFC 335', 'UFC Fight Night 294'])
  })

  it('reads the WWE layout, where the event is the second column', () => {
    // Column order differs between pages, which is why columns are found by
    // name rather than position.
    const table = [
      '{| class="wikitable succession-box" style="font-size:85%; width:100%"',
      '|-',
      '! scope="col" style="width:5%;"| Date',
      '! scope="col" style="width:1"| Event',
      '! scope="col" style="width:15%;"| Venue',
      '|-',
      '|March 31',
      '|[[WrestleMania I|WrestleMania]]',
      '|[[Madison Square Garden]]',
      '|}',
    ].join('\n')

    const rows = parseTable(table)

    expect(rows[0]?.headers).toEqual(['Date', 'Event', 'Venue'])
    expect(columnIndex(rows[0]!.headers, ['event'])).toBe(1)
    expect(rows[0]?.cells[1]).toBe('WrestleMania')
  })

  it('separates a cell’s styling from its content', () => {
    // `| style="…" | Value` is one cell, not two.
    const table = '{| class="wikitable"\n! Event\n|-\n| style="text-align:left;" | Backlash\n|}'

    expect(parseTable(table)[0]?.cells).toEqual(['Backlash'])
  })

  it('handles cells written inline with ||', () => {
    const table = '{| class="wikitable"\n! A !! B\n|-\n| one || two\n|}'
    const rows = parseTable(table)

    expect(rows[0]?.headers).toEqual(['A', 'B'])
    expect(rows[0]?.cells).toEqual(['one', 'two'])
  })

  it('falls back to the first row when a table has no ! headers', () => {
    const table = '{| class="wikitable"\n|-\n|Event\n|Date\n|-\n|Bash at the Beach\n|July 7\n|}'
    const rows = parseTable(table)

    expect(rows[0]?.headers).toEqual(['Event', 'Date'])
    expect(rows[0]?.cells[0]).toBe('Bash at the Beach')
  })

  it('reads an empty table without falling over', () => {
    expect(parseTable('{| class="wikitable"\n! Event\n|}')).toEqual([])
  })

  it('reads a plainrowheaders layout, where each row\'s Event cell is a ! not a |', () => {
    // Verbatim shape from the real AEW page: `class="plainrowheaders"`
    // marks each row's first cell with `scope="row"` for accessibility —
    // a per-row header, not a second header row. Routing it into the
    // table's shared `headers` (as a naive "any ! line is a header" rule
    // would) left every row one cell short of the real header count, so
    // every row failed alignment and the whole table silently produced
    // zero events.
    const table = [
      '{| class="sortable wikitable plainrowheaders"',
      '! scope="col" | Event',
      '! scope="col" | Date',
      '! scope="col" | Venue',
      '|-',
      '! scope="row" |[[Double or Nothing (2019)|Double or Nothing]]',
      '|May 25',
      '|[[MGM Grand Garden Arena]]',
      '|-',
      '! scope="row" |[[Fyter Fest (2019)|Fyter Fest]]',
      '|June 29',
      '|[[Daily\'s Place]]',
      '|}',
    ].join('\n')

    const rows = parseTable(table)

    expect(rows[0]?.headers).toEqual(['Event', 'Date', 'Venue'])
    expect(rows.map((row) => row.cells)).toEqual([
      ['Double or Nothing', 'May 25', 'MGM Grand Garden Arena'],
      ['Fyter Fest', 'June 29', "Daily's Place"],
    ])
  })

  describe('rowspan', () => {
    /**
     * Verbatim shape from the real UFC page: UFC 48/47/46 share one Venue
     * cell via `rowspan=3` declared on UFC 48's own row, and UFC 1's Location
     * is inherited via `rowspan=2` from UFC 2's row above it. Confirmed
     * live: 157 of ~789 rows on that page alone (~1 in 5) were silently
     * dropped before this — every later column (Attendance, Ref) sliding
     * into an earlier one's slot would have been worse than dropping, which
     * is why this reconstructs by column position rather than just
     * shortening the cell-count mismatch.
     */
    it('inherits a rowspan cell into the following rows, at the right column', () => {
      const table = [
        '{| class="wikitable"',
        '! # !! Event !! Date !! Venue !! Attendance',
        '|-',
        '|053',
        '|UFC 48: Payback',
        '|Jun 19',
        '|rowspan=3|Mandalay Bay Events Center',
        '|10,000',
        '|-',
        '|052',
        '|UFC 47: It\'s On!',
        '|Apr 2',
        '|11,437',
        '|-',
        '|051',
        '|UFC 46: Supernatural',
        '|Jan 31',
        '|10,700',
        '|}',
      ].join('\n')

      const rows = parseTable(table)

      expect(rows.map((row) => row.cells)).toEqual([
        ['053', 'UFC 48: Payback', 'Jun 19', 'Mandalay Bay Events Center', '10,000'],
        ['052', "UFC 47: It's On!", 'Apr 2', 'Mandalay Bay Events Center', '11,437'],
        ['051', 'UFC 46: Supernatural', 'Jan 31', 'Mandalay Bay Events Center', '10,700'],
      ])
    })

    it('handles rowspan="N" (quoted) and a rowspan combined with another attribute', () => {
      const table = [
        '{| class="wikitable"',
        '! Event !! Location !! Date',
        '|-',
        '|UFC 2: No Way Out',
        '|rowspan="2"|Denver, Colorado',
        '|Mar 11',
        '|-',
        '|UFC 1: The Beginning',
        '|Nov 12',
        '|}',
      ].join('\n')

      expect(parseTable(table).map((row) => row.cells)).toEqual([
        ['UFC 2: No Way Out', 'Denver, Colorado', 'Mar 11'],
        ['UFC 1: The Beginning', 'Denver, Colorado', 'Nov 12'],
      ])

      const withStyle = [
        '{| class="wikitable"',
        '! Event !! Venue !! Date',
        '|-',
        '|Event A',
        '|rowspan=2 style="text-align:center"|Shared Arena',
        '|Jan 1',
        '|-',
        '|Event B',
        '|Jan 8',
        '|}',
      ].join('\n')

      expect(parseTable(withStyle).map((row) => row.cells)).toEqual([
        ['Event A', 'Shared Arena', 'Jan 1'],
        ['Event B', 'Shared Arena', 'Jan 8'],
      ])
    })

    it('a row that still falls short after span reconstruction is left short, not padded', () => {
      // No rowspan at all here — a genuinely malformed/truncated row. The
      // alignment check in `fetchPromotionEvents` is the actual backstop;
      // this just confirms `parseTable` itself doesn't invent a cell.
      const table = [
        '{| class="wikitable"',
        '! Event !! Date !! Venue',
        '|-',
        '|Some Event',
        '|Jan 1',
        '|}',
      ].join('\n')

      expect(parseTable(table)[0]?.cells).toEqual(['Some Event', 'Jan 1'])
    })
  })
})

describe('splitSections', () => {
  it('splits on headings and keeps the lead', () => {
    const page = 'lead text\n==Overview==\nsome prose\n==Past events==\n{| class="wikitable"\n|}'
    const sections = splitSections(page)

    expect(sections.map((section) => section.heading)).toEqual(['', 'Overview', 'Past events'])
    expect(sections[0]?.body).toContain('lead text')
    expect(sections[2]?.body).toContain('wikitable')
  })

  it('handles sub-headings of any depth', () => {
    expect(splitSections('==A==\nx\n===B===\ny').map((section) => section.heading)).toEqual([
      '',
      'A',
      'B',
    ])
  })
})

describe('columnIndex', () => {
  it('matches a header regardless of case or trailing words', () => {
    expect(columnIndex(['Date', 'Event name', 'Venue'], ['event', 'name'])).toBe(1)
    expect(columnIndex(['DATE', 'SHOW'], ['event', 'show'])).toBe(1)
  })

  it('reports -1 when no column matches, so the table can be skipped', () => {
    expect(columnIndex(['Year', 'Number of events'], ['event', 'name'])).toBe(-1)
  })
})

describe('rowYear', () => {
  it('finds a year even inside a template, where cleaning would remove it', () => {
    expect(rowYear('|{{dts|2026|Dec|12}}')).toBe(2026)
    expect(rowYear('|March 31, 1985')).toBe(1985)
  })

  it('reports nothing when a row carries no year', () => {
    expect(rowYear('|WrestleMania|Madison Square Garden')).toBeUndefined()
  })
})

describe('parseTable row alignment', () => {
  it('keeps the raw row, so a year survives cleaning', () => {
    const table = '{| class="wikitable"\n! Event !! Date\n|-\n|[[UFC 1]]\n|{{dts|1993|Nov|12}}\n|}'

    expect(rowYear(parseTable(table)[0]!.raw)).toBe(1993)
  })

  it('exposes short rows so a caller can drop them', () => {
    // A rowspan leaves later rows with fewer cells, shifting every column
    // left — which is how a venue ends up imported as an event.
    const table = [
      '{| class="wikitable"',
      '! Date !! Event !! Venue',
      '|-',
      '|March 31',
      '|WrestleMania',
      '|Madison Square Garden',
      '|-',
      '|April 7',
      '|Los Angeles, California',
      '|}',
    ].join('\n')

    const rows = parseTable(table)
    expect(rows[0]?.cells).toHaveLength(3)
    expect(rows[1]?.cells).toHaveLength(2)
  })
})
