import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Task 11.1: names and search text are proper nouns, so the OS must not
 * underline or "correct" them (WKWebView does, unasked). Every text entry
 * therefore has to say `spellCheck` outright. Prose boxes are the only
 * exception, and they are listed here by name so an exception is a choice.
 */

const SRC = join(import.meta.dirname)

/** Components that render a text `<input>`/`<textarea>` from props the caller supplies. */
const TEXT_ENTRY = /<(input|textarea|Field|FieldTextArea|MaskedKey)\b/g

/** Inputs that take no words: non-text types, and the numeric minutes fields. */
const NON_TEXT = /\btype="(checkbox|radio|file|range|hidden|color)"|\binputMode="numeric"/

/** Prose the browser may check: `file` + the `label` (or `aria-label`) prop that identifies the box. */
const PROSE = new Set([
  'screens/list/EditListPopover.tsx|FieldTextArea|text.description',
  'components/quantum/AddByHandTab/AddByHandTab.tsx|FieldTextArea|text.descriptionLabel',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : []
  })
}

/** The opening tag starting at `start`, up to its closing `>` outside any `{…}`. */
function openingTag(source: string, start: number): string {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0 && source[index - 1] !== '=') return source.slice(start, index + 1)
  }
  return source.slice(start)
}

function identity(tag: string): string {
  return /\b(?:aria-)?label=\{?"?([\w.]+)/.exec(tag)?.[1] ?? '?'
}

function unguarded(): string[] {
  const found: string[] = []
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')
    const name = relative(SRC, file).split('\\').join('/')
    for (const match of source.matchAll(TEXT_ENTRY)) {
      const tag = openingTag(source, match.index)
      if (NON_TEXT.test(tag)) continue
      // Field.tsx forwards `{...rest}`; its callers are checked at their own call site.
      if (name === 'components/quantum/Field/Field.tsx' && /\{\.\.\.rest\}/.test(tag)) continue
      if (/\bspellCheck\b|\{\.\.\.NAMES\}/.test(tag)) continue
      const line = source.slice(0, match.index).split('\n').length
      const key = `${name}|${match[1]}|${identity(tag)}`
      if (PROSE.has(key)) continue
      found.push(`${name}:${line} <${match[1]}> (${key})`)
    }
  }
  return found
}

describe('spellcheck guard', () => {
  it('every text input and textarea declares spellCheck, except the listed prose boxes', () => {
    expect(unguarded()).toEqual([])
  })

  it('the prose allowlist has no stale entries', () => {
    const live = new Set<string>()
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      const name = relative(SRC, file).split('\\').join('/')
      for (const match of source.matchAll(TEXT_ENTRY)) {
        live.add(`${name}|${match[1]}|${identity(openingTag(source, match.index))}`)
      }
    }
    expect([...PROSE].filter((key) => !live.has(key))).toEqual([])
  })
})
