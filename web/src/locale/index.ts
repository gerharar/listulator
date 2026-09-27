import { en, type Locale } from './en.js'
import { ru } from './ru.js'
import { de } from './de.js'
import { mergeLocale } from './mergeLocale.js'
import type { Language } from '../lib/preferences/language.js'

const LOCALES: Record<Language, Locale> = {
  en,
  ru: mergeLocale<Locale>(en, ru),
  de: mergeLocale<Locale>(en, de),
}

let currentLocale: Locale = LOCALES.en
let collator = new Intl.Collator('en')

/**
 * Switches the locale every `copy.x.y` read resolves against, from here on.
 * `LanguageProvider` (`LanguageProvider.tsx`) is the only intended caller —
 * it's what turns this into something that changes *while the app is open*,
 * for components that opt into re-rendering via `useCopy`/`useLanguage`.
 * Plain `copy` readers (everything else, today) pick up the new words on
 * their next render for whatever unrelated reason it happens, same as
 * before this task — nothing at those call sites has to move.
 */
export function setActiveLanguage(language: Language): void {
  currentLocale = LOCALES[language]
  collator = new Intl.Collator(language)
}

/** Orders names people read A–Z in the app's language (a Russian list sorts as Russian does). */
export function compareShown(a: string, b: string): number {
  return collator.compare(a, b)
}

/**
 * The active locale, read fresh on every property access via a `Proxy` —
 * so it can change (`setActiveLanguage`) without every existing
 * `copy.x.y` call site needing to become a hook. See `LanguageProvider.tsx`
 * for the piece that actually re-renders a component when it does.
 */
export const copy: Locale = new Proxy(en, {
  get: (_target, prop, receiver) => Reflect.get(currentLocale, prop, receiver),
}) as Locale

export { en }
export type { Locale }

/**
 * A category's display name.
 *
 * The server's registry is the source of truth — `media_type` is an open
 * registry, so a category added there must render without being named in the
 * locale. An override exists only for wording the app wants to differ.
 */
export function categoryLabel(mediaType: { key: string; label: string }): string {
  return copy.categories[mediaType.key]?.label ?? mediaType.label
}

/**
 * The name of where a category searches: its source ("TMDB"), or the community
 * library for a category that searches curated lists only (Mega, F9). Absent
 * for a category with no search at all.
 */
export function sourceLabel(mediaType: { sourceName?: string; searchScope?: 'library' }): string | undefined {
  return mediaType.searchScope === 'library' ? copy.quantum.search.librarySource : mediaType.sourceName
}

/**
 * The sentence for a server error code.
 *
 * The one cast in the file, and deliberately confined here: each entry declares
 * the parameters it needs, but the code arriving over the wire is only a string,
 * so the lookup cannot be checked statically. An unrecognised code — an older
 * web against a newer server — falls back rather than throwing.
 */
export function errorMessage(code: string, params?: Record<string, unknown>): string | undefined {
  const table = copy.errors as unknown as Record<
    string,
    ((p: Record<string, unknown>) => string) | undefined
  >

  return table[code]?.(params ?? {})
}

/** As `categoryLabel`, for the optional one-line explanation. */
export function categoryDescription(mediaType: {
  key: string
  description?: string | undefined
}): string | undefined {
  return copy.categories[mediaType.key]?.description ?? mediaType.description
}
