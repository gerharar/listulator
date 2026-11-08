import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `var(--font)` names a token that does not exist (the tokens are `--font-sans` and `--font-mono`). A `font` shorthand
 * that uses it is invalid at computed-value time, so the browser drops the whole declaration and the text inherits:
 * weight and size are lost without any error. Found on the item card's title (H-003, 2026-10-15); the twelve older
 * uses were fixed under BL-097 (owner, 2026-10-15).
 */
const SRC = join(import.meta.dirname)

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path, keep)
    return keep(entry.name) ? [path] : []
  })
}

const cssFiles = (dir: string) => files(dir, (name) => name.endsWith('.css'))

/** Application code: every .ts and .tsx that is not a test or a guard. */
const sourceFiles = (dir: string) => files(dir, (name) => /\.tsx?$/.test(name) && !/\.(test|guard\.test)\.tsx?$/.test(name))

const relPath = (file: string) => relative(SRC, file).split('\\').join('/')
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
/** The family of a theme is declared in @font-face blocks, which are the one place a family may be named. */
const withoutFontFaces = (text: string) => text.replace(/@font-face\s*{[^}]*}/g, '')
const TOKEN_OR_KEYWORD = /^(var\(--font-(sans|mono)\)|inherit|initial|unset|revert)$/

describe('the font token', () => {
  it('no stylesheet uses var(--font), which is not defined', () => {
    const using = cssFiles(SRC)
      .filter((file) => /var\(--font\)/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .sort()

    expect(using).toEqual([])
  })

  it('a font-family is named only through --font-sans or --font-mono (X-002: a theme swaps the role, not the components)', () => {
    const naming = cssFiles(SRC).flatMap((file) => {
      const text = withoutFontFaces(withoutComments(readFileSync(file, 'utf8')))
      return [...text.matchAll(/(?<![\w-])font-family\s*:\s*([^;}]+)/g)]
        .filter((match) => !TOKEN_OR_KEYWORD.test(match[1]!.trim()))
        .map((match) => `${relPath(file)}: font-family: ${match[1]!.trim()}`)
    })

    expect(naming).toEqual([])
  })

  it('a font shorthand takes its family from the token too', () => {
    const naming = cssFiles(SRC).flatMap((file) => {
      const text = withoutFontFaces(withoutComments(readFileSync(file, 'utf8')))
      return [...text.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/g)]
        .filter((match) => !TOKEN_OR_KEYWORD.test(match[1]!.trim()) && !/\bvar\(--font-(sans|mono)\)\s*$/.test(match[1]!.trim()))
        .map((match) => `${relPath(file)}: font: ${match[1]!.trim()}`)
    })

    expect(naming).toEqual([])
  })

  it('no .ts or .tsx file names a family either (canvas, inline styles)', () => {
    const naming = sourceFiles(SRC)
      .filter((file) => /font-?family/i.test(readFileSync(file, 'utf8')))
      .map(relPath)

    expect(naming).toEqual([])
  })

  it('@font-face is declared in styles/theme/fonts.css and nowhere else', () => {
    const declaring = cssFiles(SRC)
      .filter((file) => /@font-face/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map(relPath)

    expect(declaring).toEqual(['styles/theme/fonts.css'])
  })

  it('the two tokens are defined by the Quantum tokens and by a theme file, nowhere else', () => {
    const defining = cssFiles(SRC)
      .filter((file) => /--font-(sans|mono)\s*:/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map(relPath)
      .sort()

    expect(defining).toEqual(['styles/quantum/tokens.css', 'styles/theme/exzed.css'])
  })
})
