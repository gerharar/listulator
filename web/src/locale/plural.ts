/** The CLDR plural categories `Intl.PluralRules` selects among. Not every language uses all six. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

export type PluralForms<T> = Partial<Record<PluralCategory, T>> & { other: T }

const rulesByLocale = new Map<string, Intl.PluralRules>()

function rulesFor(locale: string): Intl.PluralRules {
  let rules = rulesByLocale.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    rulesByLocale.set(locale, rules)
  }
  return rules
}

/**
 * Picks the right form for `n` in `locale`, via `Intl.PluralRules` rather
 * than a hand-rolled `n === 1` check — English and German only ever select
 * "one" or "other", but Russian needs "one"/"few"/"many" too (task 10.8b).
 * `other` is the only required form; a language selecting a category the
 * caller didn't supply falls back to it.
 */
export function selectPlural<T>(n: number, locale: string, forms: PluralForms<T>): T {
  const category = rulesFor(locale).select(n) as PluralCategory
  return forms[category] ?? forms.other
}
