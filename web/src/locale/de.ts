import { selectPlural } from './plural.js'
import type { Locale } from './en.js'
import type { DeepPartial } from './types.js'

/**
 * German. Same deliberately partial, unreviewed-draft status as `ru.ts` —
 * see its comment. German's plural rules are the same one/other split as
 * English, so `duration` here mostly demonstrates that the mechanism
 * still routes correctly even when a language doesn't need the extra
 * categories Russian does.
 */
export const de: DeepPartial<Locale> = {
  app: {
    themeLabel: 'Thema',
    loading: 'Lädt…',
    unknownError: 'Etwas ist schiefgelaufen',
  },
  overview: {
    listCount: (n: number): string =>
      `${n} ${selectPlural(n, 'de', { one: 'Liste', other: 'Listen' })}`,
  },
  duration: {
    minutes: (m: number): string =>
      `${m} ${selectPlural(m, 'de', { one: 'Minute', other: 'Minuten' })}`,
    hours: (h: number): string =>
      `${h} ${selectPlural(h, 'de', { one: 'Stunde', other: 'Stunden' })}`,
    hoursMinutes: (h: number, m: number): string =>
      `${h} ${selectPlural(h, 'de', { one: 'Stunde', other: 'Stunden' })} ` +
      `${m} ${selectPlural(m, 'de', { one: 'Minute', other: 'Minuten' })}`,
  },
}
