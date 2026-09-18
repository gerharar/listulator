/**
 * Book-search language filter (Open Library only — never surfaced for any
 * other category). Codes match Open Library's own `language` field, which
 * uses MARC/ISO 639-2 (bibliographic) three-letter codes, so a code sent
 * here needs no translation on the server side.
 */
export interface BookLanguageOption {
  code: string
  label: string
}

export const ALL_LANGUAGES = 'all'

/** A curated common set, not Open Library's full code list — kept short and named. */
export const BOOK_LANGUAGES: BookLanguageOption[] = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fre', label: 'French' },
  { code: 'ger', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'dut', label: 'Dutch' },
  { code: 'rus', label: 'Russian' },
  { code: 'pol', label: 'Polish' },
  { code: 'swe', label: 'Swedish' },
  { code: 'nor', label: 'Norwegian' },
  { code: 'dan', label: 'Danish' },
  { code: 'fin', label: 'Finnish' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'chi', label: 'Chinese' },
  { code: 'kor', label: 'Korean' },
]

const STORAGE_KEY = 'listulator:bookSearchLanguage'
const DEFAULT_LANGUAGE = 'eng'

export function isBookLanguageCode(value: unknown): value is string {
  return value === ALL_LANGUAGES || BOOK_LANGUAGES.some((entry) => entry.code === value)
}

/** Sentinel a book item's own `language` field carries when kept despite no tag. */
export const UNKNOWN_LANGUAGE = 'unknown'

/**
 * Remembered choice wins; otherwise English. Storage can throw in a private
 * window or with site data blocked, so a failure just means "no preference
 * saved" rather than a broken page — same pattern as `theme.ts`.
 */
export function resolveInitialBookLanguage(storage: Pick<Storage, 'getItem'> | undefined): string {
  try {
    const stored = storage?.getItem(STORAGE_KEY)
    if (isBookLanguageCode(stored)) return stored
  } catch {
    // ignore
  }

  return DEFAULT_LANGUAGE
}

export function persistBookLanguage(
  storage: Pick<Storage, 'setItem'> | undefined,
  language: string,
): void {
  try {
    storage?.setItem(STORAGE_KEY, language)
  } catch {
    // Not being able to remember the choice is not worth breaking anything for.
  }
}
