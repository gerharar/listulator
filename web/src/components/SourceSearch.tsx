import { useState } from 'react'
import { api, type ListSourceResult, type MediaType } from '../lib/api.js'
import {
  ALL_LANGUAGES,
  BOOK_LANGUAGES,
  persistBookLanguage,
  resolveInitialBookLanguage,
} from '../lib/bookLanguage.js'
import { categoryLabel, copy } from '../locale/index.js'

/**
 * Finds something that can become a whole list, and builds it.
 *
 * The search is for *sources* rather than individual items — you look up
 * Jackie Chan and get the filmography, rather than adding films one at a time.
 */
export function SourceSearch({
  mediaType,
  onBuilt,
}: {
  mediaType: MediaType
  onBuilt: (listId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ListSourceResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  /** Which source is being built — importing can take seconds. */
  const [building, setBuilding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Book-only (never shown for any other category) — filters which language
  // a bibliography is built in. Remembered across searches, same pattern as
  // the theme picker (lib/theme.ts).
  const isBookCategory = mediaType.key === 'book'
  const [language, setLanguage] = useState(() =>
    resolveInitialBookLanguage(typeof localStorage === 'undefined' ? undefined : localStorage),
  )
  // Strict by default: a work with no language tag at all is excluded when a
  // specific language is chosen. Real Open Library data showed why —
  // Lucinda Riley has 76 of 133 works with no language tag whatsoever, so
  // "always keep unknown-language books" (the original design) let her whole catalogue
  // through regardless of the language picked. Not remembered across
  // searches — an occasional escape hatch, not a standing preference.
  const [includeUnknown, setIncludeUnknown] = useState(false)

  // Music-only (never shown for any other category) — which non-studio-album
  // release types a built list should also include. EPs and singles on by
  // default, live and compilations off — confirmed with the user. Not
  // remembered across searches, same as includeUnknown above: an occasional
  // choice per list, not a standing preference.
  const isMusicCategory = mediaType.key === 'music'
  const [includeEp, setIncludeEp] = useState(true)
  const [includeSingle, setIncludeSingle] = useState(true)
  const [includeLive, setIncludeLive] = useState(false)
  const [includeCompilation, setIncludeCompilation] = useState(false)

  function changeLanguage(next: string) {
    setLanguage(next)
    persistBookLanguage(typeof localStorage === 'undefined' ? undefined : localStorage, next)
  }

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (!query.trim()) return

    setSearching(true)
    setError(null)
    setResults(null)

    try {
      // Book-only options — searchSources ignores the third argument
      // entirely for every other category. The server computes each
      // result's accurate, language-filtered work count itself, so the
      // count shown here already matches what building it will produce.
      setResults(
        (
          await api.searchSources(
            mediaType.key,
            query.trim(),
            isBookCategory ? { language, includeUnknown } : undefined,
          )
        ).sources,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.sourceSearch.searchFailed)
    } finally {
      setSearching(false)
    }
  }

  async function build(source: ListSourceResult) {
    setBuilding(source.externalRef)
    setError(null)

    try {
      const list = await api.createFromSource({
        mediaType: mediaType.key,
        externalRef: source.externalRef,
        title: source.title,
        ...(isBookCategory ? { language, includeUnknown } : {}),
        ...(isMusicCategory ? { includeEp, includeSingle, includeLive, includeCompilation } : {}),
      })

      onBuilt(list.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.sourceSearch.buildFailed)
      setBuilding(null)
    }
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{copy.sourceSearch.heading(categoryLabel(mediaType))}</h2>
      </header>

      {isBookCategory && (
        <div className="source-search__language">
          <label>
            <span className="small faint">{copy.sourceSearch.languageLabel}</span>
            <select
              className="input"
              value={language}
              onChange={(event) => changeLanguage(event.target.value)}
            >
              <option value={ALL_LANGUAGES}>{copy.sourceSearch.allLanguages}</option>
              {BOOK_LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {language !== ALL_LANGUAGES && (
            <label className="checkbox small faint">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(event) => setIncludeUnknown(event.target.checked)}
              />
              {copy.sourceSearch.includeUnknown}
            </label>
          )}
        </div>
      )}

      {isMusicCategory && (
        <div className="source-search__discography-types">
          <span className="small faint">{copy.sourceSearch.discographyTypesLabel}</span>
          <label className="checkbox small faint">
            <input
              type="checkbox"
              checked={includeEp}
              onChange={(event) => setIncludeEp(event.target.checked)}
            />
            {copy.sourceSearch.includeEp}
          </label>
          <label className="checkbox small faint">
            <input
              type="checkbox"
              checked={includeSingle}
              onChange={(event) => setIncludeSingle(event.target.checked)}
            />
            {copy.sourceSearch.includeSingle}
          </label>
          <label className="checkbox small faint">
            <input
              type="checkbox"
              checked={includeLive}
              onChange={(event) => setIncludeLive(event.target.checked)}
            />
            {copy.sourceSearch.includeLive}
          </label>
          <label className="checkbox small faint">
            <input
              type="checkbox"
              checked={includeCompilation}
              onChange={(event) => setIncludeCompilation(event.target.checked)}
            />
            {copy.sourceSearch.includeCompilation}
          </label>
        </div>
      )}

      <form className="source-search" onSubmit={(event) => void search(event)}>
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            copy.sourceSearch.placeholders[mediaType.key] ?? copy.sourceSearch.defaultPlaceholder
          }
          aria-label={copy.sourceSearch.inputLabel(categoryLabel(mediaType))}
        />
        <button className="button" type="submit" disabled={searching || !query.trim()}>
          {searching ? copy.sourceSearch.searching : copy.sourceSearch.search}
        </button>
      </form>

      {error && <p className="notice notice--error">{error}</p>}

      {building && (
        // TMDB fetches a runtime per film, so a big filmography takes seconds.
        // Silence here reads as a hang.
        <p className="panel__empty">{copy.sourceSearch.building}</p>
      )}

      {!building && results?.length === 0 && (
        <p className="panel__empty">{copy.sourceSearch.nothingFound}</p>
      )}

      {!building && results && results.length > 0 && (
        <ul className="rows">
          {results.map((source) => (
            <li key={source.externalRef}>
              <button type="button" className="row source" onClick={() => void build(source)}>
                <span className="row__title">{source.title}</span>
                {source.detail && <span className="small faint">{source.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
