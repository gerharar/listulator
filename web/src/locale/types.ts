/**
 * `en.ts` is declared `as const` so its string values are literal types —
 * useful for catching a typo in *that* file, but it means `typeof en`
 * can't be satisfied by another language's different words. `Widen`
 * recurses through the object, turning every literal string into `string`
 * while leaving function signatures (already explicitly typed) and the
 * object shape untouched.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : T extends readonly (infer Item)[]
      ? readonly Widen<Item>[]
      : T extends object
        ? { [K in keyof T]: Widen<T[K]> }
        : T

/**
 * `ru`/`de` may be partial (10.8b) — a whole leaf key is either provided in
 * full or omitted entirely, never half-implemented. Recurses through
 * nested sections the same way `Widen` does.
 */
export type DeepPartial<T> = T extends (...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : T extends readonly (infer Item)[]
    ? readonly DeepPartial<Item>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T
