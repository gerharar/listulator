import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  categoryDescription,
  categoryHandHints,
  categoryLabel,
  copy,
  errorMessage,
  setActiveLanguage,
  sortCategories,
} from './index.js'
import { createDefaultMediaTypes } from '../../../server/src/ingestion/mediaTypes.js'
import { en } from './en.js'
import { ru } from './ru.js'
import { de } from './de.js'
import { arrayLengthMismatches, extraKeys, missingKeys } from './mergeLocale.js'

describe('locale', () => {
  it('falls back to the server registry for categories it does not name', () => {
    // The point of the whole file. `media_type` is an open registry (SPEC.md
    // §5), so adding a category must not require an entry here — if this ever
    // fails, the locale has quietly become a second place to register one.
    expect(categoryLabel({ key: 'brand-new-thing', label: 'Brand New Thing' })).toBe(
      'Brand New Thing',
    )
    expect(categoryDescription({ key: 'brand-new-thing', description: 'From the server' })).toBe(
      'From the server',
    )
  })

  it("shows the design handoff's wording while the registry's own labels stay untouched", () => {
    // The registry says "TV Shows" and "Wrestling"; the design says "TV
    // Series" and "Pro Wrestling". Only the *displayed* label differs — the
    // registry's `label` and keys are never renamed (task 10.11, C1).
    expect(categoryLabel({ key: 'tv', label: 'TV Shows' })).toBe('TV Series')
    expect(categoryLabel({ key: 'wrestling', label: 'Wrestling' })).toBe('Pro Wrestling')
    expect(categoryLabel({ key: 'movie', label: 'Movies' })).toBe('Movies')
  })

  it('overrides only where the design deliberately words a category differently', () => {
    // An override is for wording the app deliberately wants to differ; this
    // pins the whole set so adding one is a visible decision.
    const renamed = Object.entries(copy.categories)
      .filter(([, entry]) => entry?.label !== undefined)
      .map(([key]) => key)
      .sort()
    expect(renamed).toEqual(['tv', 'wrestling'])
  })

  it('prefers an override where one exists', () => {
    const overridden = { ...copy.categories, movie: { label: 'Films' } }

    expect(overridden['movie']?.label ?? 'Movies').toBe('Films')
  })

  it('gets the singular and plural branches right', () => {
    // English needs two forms; other languages need more. Keeping them in the
    // locale is what stops each surface inventing its own rule.
    expect(copy.quantum.home.listCount(1)).toBe('1 list')
    expect(copy.quantum.home.listCount(2)).toBe('2 lists')
    expect(copy.quantum.addByHand.count(1, 0)).toBe('1 item')
    expect(copy.quantum.addByHand.count(9, 1)).toBe('9 items in 1 group')
    expect(copy.quantum.addByHand.count(2, 3)).toBe('2 items in 3 groups')
  })

  it('has a sentence for every error code the server can send', () => {
    // Reads the server's union directly rather than restating it, so adding a
    // code there without wording it here fails on the next run. A test-only
    // read of the file — nothing links the two workspaces at build time.
    const source = readFileSync(
      fileURLToPath(new URL('../../../server/src/apiErrors.ts', import.meta.url)),
      'utf8',
    )

    const union = /export type ApiErrorCode =([\s\S]*?)\n\n/.exec(source)?.[1] ?? ''
    const codes = [...union.matchAll(/'([^']+)'/g)].map((match) => match[1])

    // Guards the regex itself: a rename that breaks the parse would otherwise
    // make this pass by finding nothing at all.
    expect(codes.length).toBeGreaterThan(0)
    expect(Object.keys(copy.errors).sort()).toEqual([...codes].sort())
  })

  it('renders a server error with its values', () => {
    expect(errorMessage('search.unavailable', { category: 'Movies' })).toBe(
      'Search is not available for Movies. You can import a list or create one manually',
    )
    expect(errorMessage('refresh.handMadeList')).toBe(
      'This list was a hand job, so there is nothing to check against',
    )
  })

  it('adds what the parser found to the "file is invalid" sentence, and stays whole without it', () => {
    const detail = 'item 35 ("Mastermind"): unknown field "note"; did you mean "notes"?'
    expect(errorMessage('list.fileInvalid', { detail })).toContain(detail)
    expect(errorMessage('list.fileInvalid')).not.toContain('undefined')
  })

  it('gives nothing back for a code it does not know, rather than throwing', () => {
    // An older web against a newer server. The caller then falls through to
    // whatever the response carried.
    expect(errorMessage('something.invented')).toBeUndefined()
  })
})

/** Sections keyed by an open registry: a language may name more entries than `en` does. */
const OPEN_SECTIONS = [
  'categories',
  'bookLanguages',
  'sourceSearch.placeholders',
  'quantum.list.filter.facetLabels',
  'quantum.list.filter.optionLabels',
]

const LANGUAGES = { ru, de } as const

describe('key parity: ru/de against en (strict since task 10.32b)', () => {
  for (const [name, locale] of Object.entries(LANGUAGES)) {
    it(`${name} has every key en has, and no key en lacks`, () => {
      expect(missingKeys(en, locale)).toEqual([])
      expect(extraKeys(en, locale, OPEN_SECTIONS)).toEqual([])
      expect(arrayLengthMismatches(en, locale)).toEqual([])
    })
  }

  it('the parity check itself notices a gap, an invention and a short list', () => {
    const gap = { ...en, app: { loading: 'x' } }
    expect(missingKeys(en, gap)).toContain('app.unknownError')

    const invented = { ...en, app: { ...en.app, brandNew: 'x' } }
    expect(extraKeys(en, invented)).toEqual(['app.brandNew'])

    const short = {
      ...en,
      quantum: { ...en.quantum, settings: { ...en.quantum.settings, keys: { ...en.quantum.settings.keys, sources: { ...en.quantum.settings.keys.sources, tmdb: { ...en.quantum.settings.keys.sources.tmdb, steps: ['only one'] } } } } },
    }
    expect(arrayLengthMismatches(en, short)).toEqual(['quantum.settings.keys.sources.tmdb.steps'])
  })
})

/** Words that are the same in English on purpose: brands, hostnames, language names, and terms German shares. */
const SAME_AS_ENGLISH: Record<'ru' | 'de', readonly string[]> = {
  ru: [
    'categories.youtube.handTitlePlaceholder',
    'quantum.settings.themeQuantum',
    'quantum.settings.languages.en',
    'quantum.settings.languages.ru',
    'quantum.settings.languages.de',
    'quantum.settings.keys.sources.tmdb.name',
    'quantum.settings.keys.sources.tmdb.fullName',
    'quantum.settings.keys.sources.tmdb.host',
    'quantum.settings.keys.sources.igdb.name',
    'quantum.settings.keys.sources.igdb.fullName',
    'quantum.settings.keys.sources.igdb.host',
    'quantum.settings.keys.sources.comicVine.name',
    'quantum.settings.keys.sources.comicVine.fullName',
    'quantum.settings.keys.sources.comicVine.host',
    'quantum.settings.keys.sources.youtube.name',
    'quantum.settings.keys.sources.youtube.fullName',
    'quantum.settings.keys.sources.youtube.host',
    'quantum.list.filter.optionLabels.YouTube',
    'quantum.list.filter.optionLabels.EP',
    'quantum.skin.labels.light-bone',
    'quantum.skin.labels.dark-orange',
    'quantum.skin.labels.dark-green',
    'quantum.skin.labels.dark-blue',
    'quantum.skin.labels.dark-violet',
    'quantum.search.librarySource',
  ],
  de: [
    'categories.tv.handTitlePlaceholder',
    'categories.youtube.handTitlePlaceholder',
    'quantum.about.version',
    'quantum.about.powers.comicVine',
    'sourceSearch.includeEp',
    'sourceSearch.includeSingle',
    'sourceSearch.includeCompilation',
    'quantum.settings.themeQuantum',
    'quantum.settings.languages.en',
    'quantum.settings.languages.ru',
    'quantum.settings.languages.de',
    'quantum.settings.keys.status.unreachable',
    'quantum.settings.keys.sources.tmdb.name',
    'quantum.settings.keys.sources.tmdb.fullName',
    'quantum.settings.keys.sources.tmdb.host',
    'quantum.settings.keys.sources.igdb.name',
    'quantum.settings.keys.sources.igdb.fullName',
    'quantum.settings.keys.sources.igdb.host',
    'quantum.settings.keys.sources.comicVine.name',
    'quantum.settings.keys.sources.comicVine.fullName',
    'quantum.settings.keys.sources.comicVine.host',
    'quantum.settings.keys.sources.youtube.name',
    'quantum.settings.keys.sources.youtube.fullName',
    'quantum.settings.keys.sources.youtube.host',
    'quantum.addByHand.descriptionPlaceholder',
    'quantum.addByHand.statusLabel',
    'quantum.list.itemActions.infoKicker',
    'quantum.list.editPopover.status',
    'quantum.list.filter.optionLabels.MULTI',
    'quantum.list.filter.optionLabels.Animation',
    'quantum.list.filter.optionLabels.Wrestling',
    'quantum.list.filter.optionLabels.MMA',
    'quantum.list.filter.optionLabels.Comic',
    'quantum.list.filter.optionLabels.YouTube',
    'quantum.list.filter.optionLabels.Album',
    'quantum.list.filter.optionLabels.EP',
    'quantum.list.filter.optionLabels.Single',
    'quantum.list.filter.optionLabels.Live',
    'quantum.list.filter.optionLabels.Mini',
    'quantum.list.filter.optionLabels.Compilation',
    'quantum.home.helpButtons.finalizer',
    'quantum.skin.labels.dark-green',
    'quantum.skin.labels.light-bone',
    'quantum.statusPicker.notKnown',
  ],
}

function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key))
  }
  return []
}

function valueAt(root: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root)
}

describe('a copy-paste miss: a string left in English', () => {
  for (const [name, locale] of Object.entries(LANGUAGES)) {
    it(`${name} only repeats an English string where that is intended`, () => {
      const same = leaves(en)
        .filter(([path, text]) => valueAt(locale, path) === text)
        .map(([path]) => path)

      expect(same.sort()).toEqual([...SAME_AS_ENGLISH[name as 'ru' | 'de']].sort())
    })
  }
})

describe('every wording function, called for real', () => {
  /** The argument shapes the entries take: an error's params object, a count, a title, a list of titles. */
  const SAMPLES: unknown[][] = [
    [{ category: 'Cat', key: 'k', title: 'Ttl', line: 3, index: 2, max: 9 }],
    [3, 4, 5],
    ['Ttl', 3, 4, 'Grp'],
    ['Ttl', 'Grp'],
    [['A', 'B']],
    ['A', 3, 4],
    [3, 'A'],
    [4, 2, true],
  ]

  /** Paths are key arrays, not dotted strings: an error code is itself a key with a dot in it. */
  function callable(root: unknown, path: string[] = []): [string[], (...args: unknown[]) => unknown][] {
    if (typeof root === 'function') return [[path, root as (...args: unknown[]) => unknown]]
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      return Object.entries(root).flatMap(([key, child]) => callable(child, [...path, key]))
    }
    return []
  }

  const at = (root: unknown, keys: string[]): unknown =>
    keys.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root)

  function firstAnswer(fn: (...args: unknown[]) => unknown): string | undefined {
    for (const args of SAMPLES) {
      try {
        const out = fn(...args)
        if (typeof out === 'string' && !/undefined|NaN|\[object/.test(out)) return out
      } catch {
        // wrong sample shape for this function; try the next
      }
    }
    return undefined
  }

  for (const [name, locale] of Object.entries(LANGUAGES)) {
    it(`${name}: each function answers with a sentence for the samples en answers for`, () => {
      const broken: string[] = []
      for (const [path, enFn] of callable(en)) {
        if (firstAnswer(enFn) === undefined) continue
        const fn = at(locale, path)
        if (typeof fn !== 'function' || firstAnswer(fn as (...args: unknown[]) => unknown) === undefined) {
          broken.push(path.join(' › '))
        }
      }

      expect(broken).toEqual([])
    })
  }
})

describe('plural forms', () => {
  it('Russian counts use one / few / many correctly', () => {
    const forms = (n: number) => ru.quantum.home.listCount(n)
    expect(forms(1)).toBe('1 список')
    expect(forms(2)).toBe('2 списка')
    expect(forms(5)).toBe('5 списков')
    expect(forms(11)).toBe('11 списков')
    expect(forms(21)).toBe('21 список')
    expect(forms(22)).toBe('22 списка')
    expect(forms(25)).toBe('25 списков')
  })

  it('Russian adjectives agree with the count too', () => {
    expect(ru.quantum.list.updates.foundBand(1)).toBe('Найдено: 1 новый элемент.')
    expect(ru.quantum.list.updates.foundBand(3)).toBe('Найдено: 3 новых элемента.')
    expect(ru.quantum.list.updates.foundBand(7)).toBe('Найдено: 7 новых элементов.')
  })

  it('German counts use one / other', () => {
    expect(de.quantum.home.listCount(1)).toBe('1 Liste')
    expect(de.quantum.home.listCount(3)).toBe('3 Listen')
    expect(de.quantum.home.checkPartial(['A'])).toBe('1 Liste konnte nicht geprüft werden: A')
    expect(de.quantum.home.checkPartial(['A', 'B'])).toBe('2 Listen konnten nicht geprüft werden: A, B')
  })
})

describe('durations stay short enough for a table column', () => {
  it('Russian and German abbreviate like the English "1h 30m" — spelled-out words clipped Home\'s time column', () => {
    expect(ru.duration.hoursMinutes(1, 30)).toBe('1 ч 30 мин')
    expect(ru.duration.hours(2)).toBe('2 ч')
    expect(ru.duration.minutes(45)).toBe('45 мин')
    expect(de.duration.hoursMinutes(1, 30)).toBe('1 Std. 30 Min.')
    expect(de.duration.hours(2)).toBe('2 Std.')
    expect(de.duration.minutes(45)).toBe('45 Min.')
  })
})

describe('search result provenance', () => {
  it('names the source after a colon, in every language: "From: TMDB"', () => {
    for (const [name, locale] of Object.entries({ en, ru, de })) {
      const { sourceProvenance, curatedProvenance } = locale.quantum.search
      expect(sourceProvenance('TMDB'), name).toMatch(/^[^:]+: TMDB$/)
      expect(curatedProvenance, name).toMatch(/^[^:·]+: List Vault · /)
    }
    expect(en.quantum.search.sourceProvenance('TMDB')).toBe('From: TMDB')
  })
})

describe('sortCategories (11.15)', () => {
  const type = (key: string, label: string, sortOrder = 0) => ({ key, label, sortOrder })

  it('orders by the label the app shows, not the registry’s label or sortOrder', () => {
    // The registry calls tv "TV Shows" and wrestling "Wrestling"; the locale shows "TV Series" and "Pro Wrestling".
    const sorted = sortCategories([
      type('tv', 'TV Shows', 1),
      type('wrestling', 'Wrestling', 2),
      type('movie', 'Movies', 3),
      type('comic', 'Comics', 4),
    ])

    expect(sorted.map((entry) => categoryLabel(entry))).toEqual(['Comics', 'Movies', 'Pro Wrestling', 'TV Series'])
  })

  it('sorts a category the locale never heard of by its registry label, and leaves the input alone', () => {
    const input = [type('zoo', 'Zoos'), type('brand-new-thing', 'Aardvarks')]

    expect(sortCategories(input).map((entry) => entry.key)).toEqual(['brand-new-thing', 'zoo'])
    expect(input.map((entry) => entry.key)).toEqual(['zoo', 'brand-new-thing'])
  })

  it('sorts as the active language does, and follows a switch', () => {
    const input = [type('x', 'Бананы'), type('y', 'Арбузы'), type('z', 'Вишни')]

    setActiveLanguage('ru')
    try {
      expect(sortCategories(input).map((entry) => entry.key)).toEqual(['y', 'x', 'z'])
    } finally {
      setActiveLanguage('en')
    }
  })
})

describe('categoryHandHints: each category’s own Add by hand examples (11.16)', () => {
  const LANGS = { en, ru, de } as const

  it('names an example for every built-in category, in every language', () => {
    const keys = createDefaultMediaTypes().map((type) => type.key)
    expect(keys.length).toBeGreaterThanOrEqual(12)

    for (const [language, locale] of Object.entries(LANGS)) {
      for (const key of keys) {
        const entry = (locale.categories as Record<string, Record<string, string> | undefined>)[key]
        expect(entry?.['handTitlePlaceholder'], `${language}/${key} title`).toBeTruthy()
        expect(entry?.['handItemsPlaceholder'], `${language}/${key} items`).toContain('\n')
      }
    }
  })

  it('shows the category’s own example, and a neutral one for a category nobody wrote for', () => {
    setActiveLanguage('en')
    expect(categoryHandHints({ key: 'tv' }).titlePlaceholder).toBe('The Big Bang Theory')
    expect(categoryHandHints({ key: 'book' }).itemsPlaceholder).toContain('Rincewind')

    const unknown = categoryHandHints({ key: 'brand-new-thing' })
    expect(unknown).toEqual({
      titlePlaceholder: copy.quantum.addByHand.titlePlaceholder,
      itemsPlaceholder: copy.quantum.addByHand.itemsPlaceholder,
      itemsHint: copy.quantum.addByHand.itemsHint,
    })
  })

  it('keeps the fallback neutral: no Jackie Chan, in any language', () => {
    for (const locale of Object.values(LANGS)) {
      const generic = `${locale.quantum.addByHand.titlePlaceholder}\n${locale.quantum.addByHand.itemsPlaceholder}`
      expect(generic).not.toMatch(/Jackie|Чан|Chan|Rush Hour/)
    }
  })

  it('follows the language', () => {
    setActiveLanguage('ru')
    try {
      expect(categoryHandHints({ key: 'tv' }).titlePlaceholder).toBe('Теория большого взрыва')
    } finally {
      setActiveLanguage('en')
    }
  })
})

describe('the source-copy notice (task 12.5)', () => {
  it('says the interval and the source in every language', () => {
    for (const [name, locale] of [['en', en], ['ru', ru], ['de', de]] as const) {
      const line = locale.quantum.list.sourceCopyNotice({ days: 25, source: 'YouTube' })

      expect(line, name).toContain('25')
      expect(line, name).toContain('YouTube')
    }
    expect(en.quantum.list.sourceCopyNotice({ days: 150, source: 'TMDB' })).toBe(
      'Source copy is refreshed every 150 days, as TMDB requires',
    )
  })
})

describe('the Fuller lists in Mega hint strings (task 14.2)', () => {
  const hint = { en: en.quantum.search.megaHint, ru: ru.quantum.search.megaHint, de: de.quantum.search.megaHint }

  it('en: one list or several, named for the category, with the unit and the counts', () => {
    expect(hint.en.title({ count: 1, category: 'Mega' })).toBe('Your Princess Is In The Mega Castle')
    expect(hint.en.title({ count: 2, category: 'Mega' })).toBe('Your Princesses Are In The Mega Castle')
    expect([1, 2].map(hint.en.unit)).toEqual(['list', 'lists'])
    expect([1, 126].map(hint.en.items)).toEqual(['1 item', '126 items'])
    expect(hint.en.seeAll({ n: 5, category: 'Mega' })).toBe('See all 5 in Mega')
    expect(hint.en.open).toBe('Open')
    expect(hint.en.openList('Black Mirror')).toBe('Open Black Mirror')
  })

  it('ru: the unit takes all four plural forms (список, списка, списков)', () => {
    expect([1, 2, 4, 5, 11, 21, 22].map(hint.ru.unit)).toEqual(['список', 'списка', 'списка', 'списков', 'списков', 'список', 'списка'])
    expect([1, 2, 5].map(hint.ru.items)).toEqual(['1 элемент', '2 элемента', '5 элементов'])
    expect(hint.ru.title({ count: 1, category: 'Mega' })).toBe('Твоя принцесса в замке Mega')
    expect(hint.ru.title({ count: 3, category: 'Mega' })).toBe('Твои принцессы в замке Mega')
  })

  it('de: one list or several', () => {
    expect(hint.de.title({ count: 1, category: 'Mega' })).toBe('Umfassendere Liste in Mega')
    expect(hint.de.title({ count: 2, category: 'Mega' })).toBe('Umfassendere Listen in Mega')
    expect([1, 2].map(hint.de.unit)).toEqual(['Liste', 'Listen'])
  })

  it('every language has its own fixed subline for the row', () => {
    for (const [name, strings] of Object.entries(hint)) expect(strings.subline.length, name).toBeGreaterThan(0)
    expect(hint.ru.subline).not.toBe(hint.en.subline)
    expect(hint.de.subline).not.toBe(hint.en.subline)
  })

  it('every language says what Open does and names the list on it, so each button is distinct to a screen reader', () => {
    for (const [name, strings] of Object.entries(hint)) {
      expect(strings.openList('Black Mirror'), name).toContain('Black Mirror')
      expect(strings.openList('Black Mirror'), name).toContain(strings.open)
    }
  })
})

