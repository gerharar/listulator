/**
 * A table's own entry for a key, never an inherited one (BL-152, SR-119). The tables that turn text into a name, a code or a label
 * (platforms, language codes, option labels) are plain objects, and the text they are asked about comes from a list file or an API:
 * `table['constructor']` and `table['__proto__']` answer with something every object inherits, which then fails or is drawn as a
 * function or an object. Shared and browser-safe, like `platforms.ts`.
 */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}
