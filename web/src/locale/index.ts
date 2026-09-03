import { en, type Locale } from './en.js'

/**
 * The active locale.
 *
 * One language today, so this is a straight re-export rather than a lookup —
 * but every component reads its words from here, which is what makes adding a
 * second language a matter of picking a different object. When that happens
 * this becomes a selection (navigator language, a user setting) and, if the
 * choice needs to change while the app is open, a context; nothing at the call
 * sites has to move either way.
 */
export const copy: Locale = en

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
