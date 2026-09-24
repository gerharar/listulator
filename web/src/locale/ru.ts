import { selectPlural } from './plural.js'
import type { Locale } from './en.js'
import type { DeepPartial } from './types.js'

/**
 * Russian. **A deliberately partial, unreviewed draft** — task 10.8b is
 * the *infrastructure* (runtime selection, fallback, the plural helper),
 * not the translation; the full pass is task 10.32b. What's here exists to
 * exercise the mechanism for real: `duration` demonstrates the one/few/many
 * split English never needs (час/часа/часов — a standard, low-risk
 * example, not the owner's own words), `overview.listCount` shows the same
 * pattern for a UI string, and `app` is a handful of short, common phrases.
 * Everything else is intentionally absent and falls back to English —
 * `locale.test.ts`'s key-parity check reports the gap, it doesn't fail on
 * it, until 10.32b flips `STRICT_PARITY`.
 */
export const ru: DeepPartial<Locale> = {
  app: {
    themeLabel: 'Тема',
    loading: 'Загрузка…',
    unknownError: 'Что-то пошло не так',
  },
  quantum: {
    home: {
      listCount: (n: number): string =>
        `${n} ${selectPlural(n, 'ru', { one: 'список', few: 'списка', many: 'списков', other: 'списка' })}`,
    },
  },
  duration: {
    minutes: (m: number): string =>
      `${m} ${selectPlural(m, 'ru', { one: 'минута', few: 'минуты', many: 'минут', other: 'минуты' })}`,
    hours: (h: number): string =>
      `${h} ${selectPlural(h, 'ru', { one: 'час', few: 'часа', many: 'часов', other: 'часа' })}`,
    hoursMinutes: (h: number, m: number): string =>
      `${h} ${selectPlural(h, 'ru', { one: 'час', few: 'часа', many: 'часов', other: 'часа' })} ` +
      `${m} ${selectPlural(m, 'ru', { one: 'минута', few: 'минуты', many: 'минут', other: 'минуты' })}`,
  },
}
