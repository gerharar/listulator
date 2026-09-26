import './SearchTab.css'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, type ListSourceResult, type MediaType, type SourceOptions } from '../../../lib/api.js'
import {
  ALL_LANGUAGES,
  BOOK_LANGUAGES,
  persistBookLanguage,
  resolveInitialBookLanguage,
} from '../../../lib/bookLanguage.js'
import { isDesktop } from '../../../lib/platform.js'
import {
  createFromSourceInput,
  previewPath,
  type PreviewSource,
} from '../../../lib/preview.js'
import { categoryLabel, copy, sourceLabel } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { ErrorBlock, type ErrorBlockAction } from '../ErrorBlock/ErrorBlock.js'
import { ErrorStrip } from '../ErrorStrip/ErrorStrip.js'
import { Field } from '../Field/Field.js'
import { SearchResultRow } from '../SearchResultRow/SearchResultRow.js'
import { Spinner } from '../Spinner/Spinner.js'
import { ToggleChip } from '../ToggleChip/ToggleChip.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { useSourceExpansions } from './useSourceExpansions.js'

export interface SearchTabProps {
  mediaType: MediaType
  /** Called with the new list's id once Add list succeeds. */
  onBuilt: (listId: string) => void
}

/**
 * What sits in the one slot between the form and the results. Errors, an
 * empty search and progress all render here, so the form never jumps.
 */
type Notice =
  | { kind: 'block'; headline: string; explanation: string; action?: ErrorBlockAction }
  | { kind: 'strip'; message: string; retry: () => void }

const CANONICAL_PREFIX = 'canonical:'

/**
 * The Create layer's Search tab (design: "Search {Source}", task 10.12).
 *
 * Searching finds *sources* — an artist, a filmography, a franchise — not
 * single items. Each result's item count (and status, where the source has
 * one) loads in after the rows render (Q11), never holding the list back; a
 * failed count just shows no number. A spinner is the only progress
 * indication, for searching and for importing alike (Q12).
 */
export function SearchTab({ mediaType, onBuilt }: SearchTabProps) {
  const text = copy.quantum.search
  const layerStack = useLayerStack()
  const source = sourceLabel(mediaType) ?? categoryLabel(mediaType)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ListSourceResult[] | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [building, setBuilding] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const searchId = useRef(0)
  const { states, begin, resume, cancel } = useSourceExpansions()

  // Book-only: which language a bibliography is built in. Remembered across
  // searches, like the old picker. Strict about untagged works by default
  // (Lucinda Riley has 76 of 133 works with no language tag at all), and that
  // escape hatch is not remembered.
  const isBook = mediaType.key === 'book'
  const [language, setLanguage] = useState(() =>
    resolveInitialBookLanguage(typeof localStorage === 'undefined' ? undefined : localStorage),
  )
  const [includeUnknown, setIncludeUnknown] = useState(false)

  // Music-only: EPs and singles on by default, live and compilations off —
  // confirmed with the user. Not remembered.
  const isMusic = mediaType.key === 'music'
  const [includeEp, setIncludeEp] = useState(true)
  const [includeSingle, setIncludeSingle] = useState(true)
  const [includeLive, setIncludeLive] = useState(false)
  const [includeCompilation, setIncludeCompilation] = useState(false)

  /** What shapes an expansion — the very options Add list imports with, so the count matches. */
  const options: SourceOptions = useMemo(
    () =>
      isBook
        ? { language, includeUnknown }
        : isMusic
          ? { includeEp, includeSingle, includeLive, includeCompilation }
          : {},
    [isBook, isMusic, language, includeUnknown, includeEp, includeSingle, includeLive, includeCompilation],
  )
  const optionsKey = JSON.stringify(options)

  function noKeyNotice(libraryDown = false): Notice {
    const category = categoryLabel(mediaType)
    const desktop = isDesktop()

    return {
      kind: 'block',
      headline: libraryDown ? text.offlineHeadline(category) : text.noKeyHeadline(source),
      explanation: libraryDown
        ? desktop
          ? text.offlineDesktop(category)
          : text.offlineWeb(category)
        : desktop
          ? text.noKeyDesktop(category)
          : text.noKeyWeb(category),
      // Desktop only: the web build's keys live in the server's environment.
      ...(desktop
        ? {
            action: {
              label: text.openSettings,
              onClick: () =>
                layerStack.push({
                  id: 'settings',
                  kind: 'settings',
                  tabLabel: () => copy.quantum.settings.title,
                  content: '',
                }),
            },
          }
        : {}),
    }
  }

  function noticeFor(cause: unknown, retry: () => void): Notice {
    if (cause instanceof ApiError && cause.code === 'search.unavailable') return noKeyNotice()
    if (cause instanceof ApiError && cause.code === 'search.unavailableOffline') {
      return noKeyNotice(true)
    }
    if (cause instanceof ApiError && cause.code === 'list.sourceEmpty') {
      return {
        kind: 'block',
        headline: text.nothingToImportHeadline,
        explanation: cause.message,
      }
    }

    return {
      kind: 'strip',
      message: cause instanceof Error ? cause.message : copy.sourceSearch.searchFailed,
      retry,
    }
  }

  const fetchExpansion = (ref: string) => api.expansion(mediaType.key, ref, options)

  // Counts depend on the options, so changing one re-fetches them for the rows
  // already on screen. Not on first mount, and not while an import is running.
  const previousOptions = useRef(optionsKey)
  const shownRefs = useRef<string[]>([])
  useEffect(() => {
    if (previousOptions.current === optionsKey) return
    previousOptions.current = optionsKey
    if (shownRefs.current.length > 0 && !building) begin(shownRefs.current, fetchExpansion)
    // `fetchExpansion` closes over `options`, which `optionsKey` stands for.
  }, [optionsKey])

  async function runSearch(rawQuery: string) {
    const trimmed = rawQuery.trim()
    if (!trimmed) return

    searchId.current += 1
    const mine = searchId.current

    cancel()
    shownRefs.current = []
    setSearching(true)
    setNotice(null)
    setResults(null)
    setExpanded(new Set())

    try {
      // Book-only options — searchSources ignores the third argument for every
      // other category. The server computes each result's language-filtered
      // work count itself, so the detail line already matches what Add list makes.
      const { sources, libraryUnreachable } = await api.searchSources(
        mediaType.key,
        trimmed,
        isBook ? { language, includeUnknown } : undefined,
      )
      if (searchId.current !== mine) return

      setResults(sources)
      if (sources.length === 0) {
        setNotice({
          kind: 'block',
          headline: text.nothingFoundHeadline,
          explanation: libraryUnreachable
            ? text.nothingFoundBody + text.nothingFoundLibraryDown
            : text.nothingFoundBody,
        })
        return
      }

      // Results came back, but the curated lists could not be searched: keep
      // the rows, and say what is missing (Retry searches again).
      if (libraryUnreachable) {
        setNotice({ kind: 'strip', message: text.libraryUnreachable, retry: () => void runSearch(trimmed) })
      }

      shownRefs.current = sources.map((entry) => entry.externalRef)
      begin(shownRefs.current, fetchExpansion)
    } catch (cause) {
      if (searchId.current !== mine) return
      setNotice(noticeFor(cause, () => void runSearch(trimmed)))
    } finally {
      if (searchId.current === mine) setSearching(false)
    }
  }

  const sourceFor = (result: ListSourceResult): PreviewSource => ({
    mediaType: mediaType.key,
    externalRef: result.externalRef,
    title: result.title,
    options,
  })

  /** Pushes the Preview layer over this one; Esc or the backdrop comes back here untouched. */
  function preview(result: ListSourceResult) {
    layerStack.push({
      id: `preview-${result.externalRef}`,
      kind: 'preview',
      tabLabel: () => text.previewTab(result.title),
      content: previewPath(sourceFor(result)),
    })
  }

  async function add(result: ListSourceResult) {
    // The server's limiter is first come, first served: speculative counts
    // still queued would make the import wait behind them.
    cancel()
    setBuilding(true)
    setNotice(null)

    try {
      const list = await api.createFromSource(createFromSourceInput(sourceFor(result)))
      onBuilt(list.id)
    } catch (cause) {
      setBuilding(false)
      setNotice(noticeFor(cause, () => void add(result)))
      // The counts were abandoned for the import; pick up the ones not yet
      // known (not the whole batch again — on MusicBrainz that is ~1s each).
      resume(fetchExpansion)
    }
  }

  function toggle(ref: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(ref)) next.add(ref)
      return next
    })
  }

  function changeLanguage(next: string) {
    setLanguage(next)
    persistBookLanguage(typeof localStorage === 'undefined' ? undefined : localStorage, next)
  }

  return (
    <div className="q-search">
      <form
        className="q-search-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void runSearch(query)
        }}
      >
        <Field
          label={text.queryLabel(source)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            copy.sourceSearch.placeholders[mediaType.key] ?? copy.sourceSearch.defaultPlaceholder
          }
          disabled={building}
          // A name to look up, not prose: macOS would otherwise underline it and offer grammar fixes.
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" disabled={building || !query.trim()}>
          {text.searchButton}
        </Button>
      </form>

      {isBook && (
        <div className="q-search-facet">
          <span className="q-kicker">{copy.sourceSearch.languageLabel}</span>
          <ToggleChip
            pressed={language === ALL_LANGUAGES}
            disabled={building}
            onClick={() => changeLanguage(ALL_LANGUAGES)}
          >
            {copy.sourceSearch.allLanguages}
          </ToggleChip>
          {BOOK_LANGUAGES.map((entry) => (
            <ToggleChip
              key={entry.code}
              pressed={language === entry.code}
              disabled={building}
              onClick={() => changeLanguage(entry.code)}
            >
              {copy.bookLanguages[entry.code] ?? entry.label}
            </ToggleChip>
          ))}
          {language !== ALL_LANGUAGES && (
            <ToggleChip
              pressed={includeUnknown}
              disabled={building}
              onClick={() => setIncludeUnknown((value) => !value)}
            >
              {copy.sourceSearch.includeUnknown}
            </ToggleChip>
          )}
        </div>
      )}

      {isMusic && (
        <div className="q-search-facet">
          <span className="q-kicker">{copy.sourceSearch.discographyTypesLabel}</span>
          {(
            [
              [copy.sourceSearch.includeEp, includeEp, setIncludeEp],
              [copy.sourceSearch.includeSingle, includeSingle, setIncludeSingle],
              [copy.sourceSearch.includeLive, includeLive, setIncludeLive],
              [copy.sourceSearch.includeCompilation, includeCompilation, setIncludeCompilation],
            ] as const
          ).map(([label, value, set]) => (
            <ToggleChip
              key={label}
              pressed={value}
              disabled={building}
              onClick={() => set(!value)}
            >
              {label}
            </ToggleChip>
          ))}
        </div>
      )}

      <div className="q-search-slot">
        {searching && (
          <div className="q-search-progress">
            <Spinner label={text.searching} />
            <span>{text.searching}</span>
          </div>
        )}
        {building && (
          <div className="q-search-progress">
            <Spinner label={text.importing} />
            <span>{text.importing}</span>
          </div>
        )}
        {!searching && !building && notice && (
          <SearchNotice notice={notice} onDismiss={() => setNotice(null)} />
        )}
      </div>

      {results && results.length > 0 && (
        <div className="q-search-results">
          <div className="q-search-results-head">
            <span className="q-kicker strong">{text.resultsCount(results.length)}</span>
          </div>
          {results.map((result) => {
            const curated = result.externalRef.startsWith(CANONICAL_PREFIX)

            return (
              <SearchResultRow
                key={result.externalRef}
                title={result.title}
                meta={result.detail}
                curated={curated}
                status={result.status}
                expansion={states.get(result.externalRef)}
                expanded={expanded.has(result.externalRef)}
                onToggle={() => toggle(result.externalRef)}
                description={result.description}
                provenance={curated ? text.curatedProvenance : text.sourceProvenance(source)}
                // A curated list ships its contents with it, so it can always
                // be previewed; an API source only where its adapter is live.
                previewable={curated || mediaType.previewable}
                busy={building}
                onAdd={() => void add(result)}
                onPreview={() => preview(result)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function SearchNotice({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return notice.kind === 'block' ? (
    <ErrorBlock
      headline={notice.headline}
      explanation={notice.explanation}
      {...(notice.action ? { action: notice.action } : {})}
    />
  ) : (
    <ErrorStrip message={notice.message} onRetry={notice.retry} onDismiss={onDismiss} />
  )
}
