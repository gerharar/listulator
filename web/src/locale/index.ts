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

/** As `categoryLabel`, for the optional one-line explanation. */
export function categoryDescription(mediaType: {
  key: string
  description?: string | undefined
}): string | undefined {
  return copy.categories[mediaType.key]?.description ?? mediaType.description
}
