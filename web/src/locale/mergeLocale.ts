import type { DeepPartial } from './types.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Builds a language's effective locale: `base` (always `en`) with
 * `partial`'s entries applied over it, key by key and recursively — a
 * section `partial` doesn't mention at all is left as `base` has it, not
 * dropped (task 10.8b: "missing keys fall back to `en` key by key").
 */
export function mergeLocale<T extends object>(base: T, partial: DeepPartial<T> | undefined): T {
  if (!partial) return base

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }

  for (const key of Object.keys(partial)) {
    const baseValue = (base as Record<string, unknown>)[key]
    const partialValue = (partial as Record<string, unknown>)[key]
    if (partialValue === undefined) continue

    result[key] =
      isPlainObject(baseValue) && isPlainObject(partialValue)
        ? mergeLocale(baseValue, partialValue)
        : partialValue
  }

  return result as T
}

/**
 * The dotted paths present in `base` but absent from `partial` — reported
 * (not failed on) below `STRICT_PARITY`'s threshold; see `locale.test.ts`.
 */
export function missingKeys(base: object, partial: object | undefined, path = ''): string[] {
  const missing: string[] = []

  for (const key of Object.keys(base)) {
    const fullPath = path ? `${path}.${key}` : key
    const baseValue = (base as Record<string, unknown>)[key]
    const partialValue = partial ? (partial as Record<string, unknown>)[key] : undefined

    if (partialValue === undefined) {
      missing.push(
        ...(isPlainObject(baseValue) ? missingKeys(baseValue, undefined, fullPath) : [fullPath]),
      )
    } else if (isPlainObject(baseValue) && isPlainObject(partialValue)) {
      missing.push(...missingKeys(baseValue, partialValue, fullPath))
    }
  }

  return missing
}
