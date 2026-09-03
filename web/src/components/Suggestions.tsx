import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type MediaList, type SuggestionPick } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'
import { formatTimeAgo } from '../lib/relativeTime.js'
import { copy } from '../locale/index.js'

type Strategy = 'tired-boss' | 'suggest' | 'quickie'

interface Result {
  strategy: Strategy
  picks: SuggestionPick[]
}

/**
 * Explains the pick in the same terms the ranking used, without exposing raw
 * factor scores. A suggestion you cannot second-guess is one you stop trusting.
 */
function why(pick: SuggestionPick): string {
  const { stats } = pick.list

  return [
    copy.suggestions.percentDone(stats.completionPercent),
    copy.suggestions.timeLeft(formatDuration(stats.timeRemainingMinutes)),
    formatTimeAgo(stats.lastConsumedAt),
  ].join(' · ')
}

function Pick({ pick }: { pick: SuggestionPick }) {
  return (
    <div className="suggestion__pick">
      <Link className="suggestion__title" to={`/lists/${pick.list.id}`}>
        {pick.list.title}
      </Link>
      {pick.nextItem && (
        <p className="suggestion__next">
          {copy.suggestions.next}
          <strong>{pick.nextItem.title}</strong>{' '}
          <span className="faint">
            {pick.nextItem.timeToConsumeIsEstimated ? '~' : ''}
            {formatDuration(pick.nextItem.timeToConsumeMinutes)}
          </span>
        </p>
      )}
      <p className="small faint">{why(pick)}</p>
    </div>
  )
}

export function Suggestions({ lists }: { lists: MediaList[] }) {
  const [result, setResult] = useState<Result | null>(null)
  const [picking, setPicking] = useState(false)
  const [tiredOf, setTiredOf] = useState('')
  const [busy, setBusy] = useState<Strategy | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(strategy: Strategy, currentListId?: string) {
    setBusy(strategy)
    setError(null)

    try {
      const response =
        strategy === 'tired-boss'
          ? await api.tiredBoss(currentListId!)
          : strategy === 'suggest'
            ? await api.suggest()
            : await api.quickie()

      setResult({ strategy, picks: response.picks })
      setPicking(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.suggestions.failed)
    } finally {
      setBusy(null)
    }
  }

  const [top, ...alternatives] = result?.picks ?? []

  return (
    <section className="panel suggestion">
      <header className="panel__header">
        <h2 className="panel__title">{copy.suggestions.heading}</h2>
      </header>

      <div className="suggestion__buttons">
        <button
          type="button"
          className="button"
          onClick={() => {
            setPicking((open) => !open)
            setResult(null)
          }}
          aria-expanded={picking}
        >
          {copy.suggestions.buttons['tired-boss']}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy !== null}
          onClick={() => void run('suggest')}
        >
          {copy.suggestions.buttons.suggest}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy !== null}
          onClick={() => void run('quickie')}
        >
          {copy.suggestions.buttons.quickie}
        </button>
      </div>

      {picking && (
        <form
          className="suggestion__picker"
          onSubmit={(event) => {
            event.preventDefault()
            void run('tired-boss', tiredOf || lists[0]?.id)
          }}
        >
          {/* Always asked, never inferred: only you know what you are sick of. */}
          <label className="field__label" htmlFor="tired-of">
            {copy.suggestions.tiredOfLabel}
          </label>
          <div className="suggestion__picker-row">
            <select
              id="tired-of"
              className="select"
              value={tiredOf || (lists[0]?.id ?? '')}
              onChange={(event) => setTiredOf(event.target.value)}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.title}
                </option>
              ))}
            </select>
            <button className="button button--primary" type="submit" disabled={busy !== null}>
              {copy.suggestions.submit}
            </button>
          </div>
        </form>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      {busy && <p className="panel__empty">{copy.suggestions.thinking}</p>}

      {!busy && result && (
        <div className="suggestion__result">
          <p className="small faint">{copy.suggestions.promises[result.strategy]}</p>

          {top ? (
            <>
              <Pick pick={top} />
              {alternatives.length > 0 && (
                <p className="small faint suggestion__alternatives">
                  {copy.suggestions.alternativesPrefix}
                  {alternatives.slice(0, 3).map((pick, index) => (
                    <span key={pick.list.id}>
                      {index > 0 && ' · '}
                      <Link to={`/lists/${pick.list.id}`}>{pick.list.title}</Link>
                    </span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              {result.strategy === 'tired-boss'
                ? copy.suggestions.noneToSwitchTo
                : copy.suggestions.noneAtAll}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
