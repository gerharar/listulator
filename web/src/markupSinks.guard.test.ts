import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Nothing in the app turns text into markup (security review, Phase 19, SR-016, SR-024 and CodeQL alert #2). The Wikipedia reader
 * strips tags and links from page text with its own code, and a scanner reads that as an incomplete sanitiser (`<<script>script>`
 * would survive one pass). It is not one: the text it returns is a title, shown by React as text, and no title, note or
 * connector string reaches a place where it would be read as HTML or run. This test is what keeps that true: it fails the day
 * a sink appears, and the author must then either sanitise properly or leave the text out of it.
 */
const SRC = join(import.meta.dirname)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)

    // Tests and their helpers (`*.test.ts`, `*.testing.ts`: one runs the isolation hook's script with `new Function`) are not the app.
    return /\.(ts|tsx)$/.test(name) && !/\.(test|testing)\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** Every way text becomes markup or code in a page. `\b` after the name, so `innerHTMLWarning` as a word of prose does not count. */
const SINKS: [string, RegExp][] = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\.write(ln)?\s*\(/],
  ['eval', /(^|[^.\w])eval\s*\(/],
  ['new Function', /\bnew\s+Function\s*\(/],
  ['setTimeout or setInterval with a string', /\bset(Timeout|Interval)\s*\(\s*['"`]/],
  ['createContextualFragment', /\bcreateContextualFragment\b/],
  ['DOMParser', /\bnew\s+DOMParser\b/],
  ['srcdoc', /\bsrcdoc\b/],
  ['a javascript: address', /['"`]javascript:/i],
]

describe('the app has no place where text is read as markup or run', () => {
  const files = sourceFiles(SRC).filter((path) => !path.endsWith('markupSinks.guard.test.ts'))

  it('looks at the app’s own source (an empty list would pass on nothing)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(SINKS)('has no %s', (_name, pattern) => {
    const hits = files.filter((path) => pattern.test(readFileSync(path, 'utf8'))).map((path) => path.slice(SRC.length + 1))

    expect(hits).toEqual([])
  })
})
