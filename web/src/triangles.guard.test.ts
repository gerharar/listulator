import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Canvas H-027 (Phase 47): every disclosure, picker and sort mark is one drawn filled triangle (`Triangle.tsx`), never a text glyph (our fonts have no ▼ ▶ ▲,
 * so each OS took them from a different system font: different sizes, hollow on Windows, off the text's middle) and never a stroked chevron. This reads the
 * source, because a glyph is one character and a chevron is one import that anyone can type back. Comments may name them (this one does); code, CSS and
 * strings may not.
 */
const SRC = import.meta.dirname

/** The characters that draw a triangle as text. */
export const GLYPH = /[▼▶▲▸▾◂◀▴▵▽△▷◁▻◅]/

/** Stroked chevrons that were disclosure marks. Collapse All / Expand All (`ChevronsDownUp`) and To Top / To Bottom (arrows) are actions and are not listed. */
export const STROKED_CHEVRON = /\bChevron(?:Down|Up|Right)\b/

/** The one place a triangle's path is written. */
const TRIANGLE_FILE = join('components', 'quantum', 'Triangle', 'Triangle.tsx')

/** Every `.ts`, `.tsx` and `.css` file under `web/src`, except tests and guards (they name the things they forbid). */
export function sourceFiles(dir: string = SRC): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(?:tsx?|css)$/.test(entry.name) && !/\.(?:test|guard\.test)\.tsx?$/.test(entry.name)) found.push(path)
  }

  return found
}

/** The source with its comments blanked (block comments, `//` lines that are not part of a URL), line breaks kept so a line number still points at the line. */
export function withoutComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')

  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/.*$/gm, (_all, before: string) => before)
}

/** `file:line` of every line of code (comments removed) that matches. */
export function find(pattern: RegExp, files: string[] = sourceFiles()): string[] {
  const hits: string[] = []
  for (const file of files) {
    withoutComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) hits.push(`${relative(SRC, file)}:${index + 1}`)
      })
  }

  return hits
}

describe('no text triangle in the UI', () => {
  it('has no ▼ ▶ ▲ ▸ ▾ glyph in code, CSS or strings', () => {
    expect(find(GLYPH)).toEqual([])
  })

  it('has no stroked ChevronDown, ChevronUp or ChevronRight', () => {
    expect(find(STROKED_CHEVRON)).toEqual([])
  })

  it('writes a triangle’s path in one place, Triangle.tsx (a hand-drawn `M0 0H…L…Z` anywhere else is a second drawing)', () => {
    const others = sourceFiles().filter((file) => relative(SRC, file) !== TRIANGLE_FILE)

    expect(find(/M0 0H[\d$]/, others)).toEqual([])
    expect(find(/M0 0H[\d$]/, [join(SRC, TRIANGLE_FILE)])).toHaveLength(1)
  })
})

describe('the guard’s own reading of source', () => {
  it('finds a glyph in code and ignores one in a comment', () => {
    expect(withoutComments('const a = "▼"')).toMatch(GLYPH)
    expect(withoutComments('/* the ▼ glyph */ const a = 1')).not.toMatch(GLYPH)
    expect(withoutComments('const a = 1 // not a ▶ here')).not.toMatch(GLYPH)
    expect(withoutComments('{/* the ▲ */}<b />')).not.toMatch(GLYPH)
    expect(withoutComments('.q-x { /* ▼ */ color: red }')).not.toMatch(GLYPH)
  })

  it('keeps line numbers, and does not take the // of a URL for a comment', () => {
    const text = withoutComments('/* a\n b */\nconst u = "https://x.test/▼"')

    expect(text.split('\n')).toHaveLength(3)
    expect(text.split('\n')[2]).toMatch(GLYPH)
  })

  it('finds a stroked chevron import and not the action icons', () => {
    expect("import { ChevronDown } from 'lucide-react'").toMatch(STROKED_CHEVRON)
    expect('<ChevronRight size={12} />').toMatch(STROKED_CHEVRON)
    expect('<ChevronsDownUp />').not.toMatch(STROKED_CHEVRON)
    expect('<ArrowUp />').not.toMatch(STROKED_CHEVRON)
  })

  it('lists every file it reads, tests and guards excluded', () => {
    const files = sourceFiles().map((file) => relative(SRC, file))

    expect(files).toContain(TRIANGLE_FILE)
    expect(files).toContain(join('screens', 'about', 'AboutScreen.css'))
    expect(files.filter((file) => /\.test\.|\.guard\./.test(file))).toEqual([])
  })
})
