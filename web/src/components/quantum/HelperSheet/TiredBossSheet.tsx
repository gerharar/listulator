import './HelperSheet.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatDuration } from '../../../formatDuration.js'
import { api, type MediaList, type SuggestionPick } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { Popover } from '../Popover/Popover.js'
import { Sheet } from '../Sheet/Sheet.js'
import { Spinner } from '../Spinner/Spinner.js'
import { pickKey, reroll, whyTired } from './helperPicks.js'

export interface TiredBossSheetProps {
  open: boolean
  onClose: () => void
  /** Every list, for the picker. */
  lists: readonly MediaList[]
  /** The list opened last (a preference); the sheet starts on it. Ignored when it no longer exists. */
  initialTarget: string | undefined
  onOpenList: (listId: string) => void
}

/** A long shelf gets a filter field in the picker rather than a menu taller than the window. */
const FILTER_ABOVE = 8
/** The top pick and this many alternates. */
const ALTERNATES = 3

type Answer =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; picks: SuggestionPick[] }

/**
 * I'm Tired, Boss — "And Now For Something Completely Different": name the list
 * you are tired of and get something from a different list *and* a different
 * medium (the engine's `other_lists_and_media` scope). The list is explicit: the
 * sheet opens on the one you opened last, and the picker changes it.
 */
export function TiredBossSheet(props: TiredBossSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null
}

function OpenSheet({ onClose, lists, initialTarget, onOpenList }: TiredBossSheetProps) {
  const text = copy.quantum.helper
  const t = text.tired
  const { announce } = useLiveRegion()
  const [target, setTarget] = useState<string | undefined>(() =>
    lists.some((entry) => entry.id === initialTarget) ? initialTarget : undefined,
  )
  const [answer, setAnswer] = useState<Answer>({ phase: 'idle' })
  const [rejected, setRejected] = useState<string[]>([])
  const [picker, setPicker] = useState<{ anchor: HTMLElement } | null>(null)
  const [query, setQuery] = useState('')
  const request = useRef(0)
  const targetList = lists.find((entry) => entry.id === target)

  const load = useCallback((listId: string) => {
    request.current += 1
    const mine = request.current
    setAnswer({ phase: 'loading' })
    setRejected([])

    api
      .tiredBoss(listId)
      .then(({ picks }) => {
        if (request.current === mine) setAnswer({ phase: 'ready', picks })
      })
      .catch(() => {
        if (request.current === mine) setAnswer({ phase: 'failed' })
      })
  }, [])

  useEffect(() => {
    if (target) load(target)
  }, [target, load])

  const shown = useMemo(
    () => (answer.phase === 'ready' ? reroll(answer.picks, rejected).shown : []),
    [answer, rejected],
  )
  const top = shown[0]

  function notThat() {
    if (answer.phase !== 'ready' || !top) return
    const next = [...rejected, pickKey(top)]

    if (reroll(answer.picks, next).exhausted) {
      setRejected([])
      announce(text.backToStrongest)
    } else {
      setRejected(next)
    }
  }

  const needle = query.trim().toLowerCase()
  const matching = lists.filter((entry) => !needle || entry.title.toLowerCase().includes(needle))

  function choose(listId: string) {
    setPicker(null)
    setQuery('')
    if (listId === target) return
    setTarget(listId)
  }

  const time = (pick: SuggestionPick) => (pick.nextItem ? formatDuration(pick.nextItem.timeToConsumeMinutes) : null)
  const line = (pick: SuggestionPick) => [pick.list.title, time(pick)].filter(Boolean).join(' · ')

  const bar = (
    <>
      <span className="q-tired-lead">{t.tiredOf}</span>
      <button
        type="button"
        className="q-tired-target"
        title={t.pickTitle}
        onClick={(event) => {
          const anchor = event.currentTarget
          setQuery('')
          setPicker((current) => (current ? null : { anchor }))
        }}
      >
        {targetList?.title ?? t.pickList}
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </>
  )

  return (
    <Sheet open onClose={onClose} title={t.title} explain={t.explain} plateSeed={6} bar={bar}>
      {!targetList && <p className="q-helper-note">{t.pickTitle}</p>}
      {targetList && answer.phase === 'loading' && (
        <div className="q-helper-progress">
          <Spinner label={text.loading} />
          <span>{text.loading}</span>
        </div>
      )}
      {targetList && answer.phase === 'failed' && (
        <div className="q-helper-note">
          <p>{text.failed}</p>
          <Button onClick={() => load(targetList.id)}>{text.retry}</Button>
        </div>
      )}
      {answer.phase === 'ready' && !top && <p className="q-helper-note">{t.nothingElse}</p>}
      {answer.phase === 'ready' && top && (
        <>
          <div className="q-pick">
            <div className="q-kicker">{text.topPick}</div>
            <div className="q-pick-item">{top.nextItem?.title ?? top.list.title}</div>
            <div className="q-pick-list">{line(top)}</div>
            <div className="q-pick-why">{whyTired(top)}</div>
            <div className="q-pick-actions">
              <Button variant="primary" onClick={() => onOpenList(top.list.id)}>
                {text.openList}
              </Button>
              <Button onClick={notThat}>{text.notThat}</Button>
            </div>
          </div>
          {shown.length > 1 && (
            <>
              <div className="q-kicker q-alts-kicker">{text.alternates}</div>
              {shown.slice(1, 1 + ALTERNATES).map((pick) => (
                <button key={pickKey(pick)} type="button" className="q-alt" onClick={() => onOpenList(pick.list.id)}>
                  <span className="alt-text">
                    <span className="alt-item">{pick.nextItem?.title ?? pick.list.title}</span>
                    <span className="alt-list">{pick.list.title}</span>
                  </span>
                  <span className="alt-time">{time(pick)}</span>
                </button>
              ))}
            </>
          )}
        </>
      )}

      {picker && (
        <Popover open anchorEl={picker.anchor} onDismiss={() => setPicker(null)} width={300}>
          <div className="q-tired-picker">
            <div className="head">
              <span className="q-kicker">{t.pickerKicker}</span>
              <span className="count">{t.pickerCount(matching.length, lists.length)}</span>
            </div>
            {lists.length > FILTER_ABOVE && (
              <input
                type="text"
                className="filter"
                aria-label={t.pickerFilter}
                placeholder={t.pickerFilter}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            <div className="options">
              {matching.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === target ? 'option current' : 'option'}
                  onClick={() => choose(entry.id)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
            {needle && matching.length === 0 && <p className="none">{t.pickerNone(query)}</p>}
          </div>
        </Popover>
      )}
    </Sheet>
  )
}
