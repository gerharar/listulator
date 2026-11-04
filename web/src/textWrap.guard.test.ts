import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BL-161 (the owner, Mac, 2026-11-04): in WebKit `text-wrap: pretty` ends every line of a long text about 8% short of its box, where Chromium
 * wraps it fine. H-021 wants `pretty` (no one-word last line), so it stays everywhere but WebKit: every text reads it through `--q-text-wrap`, and one rule in
 * `base.css` turns that to `wrap` where the browser supports `hanging-punctuation`, which only WebKit does. This reads the CSS, because a new text with a bare
 * `text-wrap: pretty` is one line anyone can add, and it would be wrong on the Mac alone, where nobody is looking while building on Windows.
 */

const SRC = join(import.meta.dirname)
const sheets = (readdirSync(SRC, { recursive: true }) as string[]).filter((file) => file.endsWith('.css')).map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))

describe('text-wrap: pretty (BL-161)', () => {
  it('finds the stylesheets, so the checks below cannot pass by reading nothing', () => {
    expect(sheets.length).toBeGreaterThan(30)
    expect(sheets.some(({ text }) => text.includes('--q-text-wrap'))).toBe(true)
  })

  it('is never written bare: every text takes it from --q-text-wrap, with pretty as the fallback', () => {
    const bare = sheets.flatMap(({ file, text }) => [...text.matchAll(/(?<![-\w])text-wrap\s*:\s*([^;}]+)/g)].filter((match) => match[1]!.trim() !== 'var(--q-text-wrap, pretty)').map((match) => `${file}: text-wrap: ${match[1]!.trim()}`))

    expect(bare).toEqual([])
  })

  it('is turned off, to plain wrap, in the one place that tells WebKit by its own feature', () => {
    const base = sheets.find(({ file }) => file.endsWith('styles/quantum/base.css'))!.text

    expect(base.replace(/\s+/g, ' ')).toMatch(/@supports \(hanging-punctuation: first\) \{ html \{ --q-text-wrap: wrap; \} \}/)
  })
})
