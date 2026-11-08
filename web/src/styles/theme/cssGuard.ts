import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
