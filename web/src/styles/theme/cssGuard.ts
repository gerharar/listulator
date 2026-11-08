import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * What the theme guards (elevation, alpha) share: reading a stylesheet under `web/src` without its comments, and reading one declaration out of
 * one rule, so a test can say "this rule draws its shadow, its opacity, its filter from that token" without a CSS parser.
 */
const SRC = join(import.meta.dirname, '..', '..')

/** A stylesheet under `web/src`, comments removed. */
export const read = (path: string): string => readFileSync(join(SRC, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** One value in a form that does not depend on how it was typed: no extra spaces, no leading zero before a point, no trailing zero after one. */
export const plain = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\b0\./g, '.')
    .replace(/(\.\d*[1-9])0+\b/g, '$1')
    .trim()

/** The `property` declared by the rule whose selector is exactly `selector`, as written. */
export function declared(css: string, selector: string, property: string): string | undefined {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&')
  const rule = new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`).exec(css)
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(rule?.[1] ?? '')?.[1]?.trim()
}

/** Every place among the given stylesheets that defines the custom property `token`, as written. */
export const definitions = (token: string, paths: readonly string[]): string[] =>
  paths
    .map((path) => new RegExp(`(?:^|[;{\\s])${token}\\s*:\\s*([^;]+);`).exec(read(path))?.[1])
    .filter((value): value is string => value !== undefined)

/** Splits on the commas outside any parentheses: `var(--a,var(--b))` is one piece. */
export function topLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < value.length; at++) {
    if (value[at] === '(') depth++
    else if (value[at] === ')') depth--
    else if (value[at] === ',' && depth === 0) {
      parts.push(value.slice(start, at))
      start = at + 1
    }
  }
  return [...parts, value.slice(start)]
}

export interface Declaration {
  /** The selector (or at-rule header) of the rule the declaration is in, whitespace collapsed. */
  selector: string
  property: string
  value: string
  /** Inside a `@keyframes`, whatever its step is called. */
  keyframes: boolean
}

/**
 * Every declaration in a stylesheet, with its rule's selector, in order. Comments are skipped, and so are the `;`, `{` and `}` inside parentheses
 * and quotes (a `url('x;y')`). Not a CSS parser: enough to say which rule a property is in and whether a keyframes holds it.
 */
export function declarations(css: string): Declaration[] {
  const found: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  let depth = 0
  let quote = ''

  const emit = () => {
    const colon = buffer.indexOf(':')
    if (colon > 0 && stack.length > 0) {
      const name = buffer.slice(0, colon).trim()
      found.push({
        selector: stack[stack.length - 1]!,
        property: name.startsWith('--') ? name : name.toLowerCase(),
        value: buffer.slice(colon + 1).trim(),
        keyframes: stack.some((header) => /^@(?:-\w+-)?keyframes\b/.test(header)),
      })
    }
    buffer = ''
  }

  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (quote) {
      if (char === quote) quote = ''
      buffer += char
    } else if (char === '"' || char === "'") {
      quote = char
      buffer += char
    } else if (char === '(') {
      depth++
      buffer += char
    } else if (char === ')') {
      depth--
      buffer += char
    } else if (depth > 0) {
      buffer += char
    } else if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '))
      buffer = ''
    } else if (char === '}') {
      emit()
      stack.pop()
    } else if (char === ';') {
      emit()
    } else {
      buffer += char
    }
  }
  return found
}

/** Every value each custom property is given in a stylesheet, in every block that sets it. */
export function customProperties(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const d of declarations(css)) {
    if (!d.property.startsWith('--')) continue
    found.set(d.property, [...(found.get(d.property) ?? []), d.value])
  }
  return found
}

/** Every stylesheet under `web/src`, as a path relative to it with forward slashes, in a fixed order. */
export function stylesheets(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
      return entry.name.endsWith('.css') ? [relative(SRC, path).split(sep).join('/')] : []
    })
  return walk(SRC).sort()
}
