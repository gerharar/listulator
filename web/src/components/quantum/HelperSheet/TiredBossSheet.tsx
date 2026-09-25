import './HelperSheet.css'
import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { api, type MediaList } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Popover } from '../Popover/Popover.js'
import { Sheet } from '../Sheet/Sheet.js'
import { PicksPanel } from './PicksPanel.js'
import { useHelperAnswer } from './useHelperAnswer.js'
import { whyTired } from './helperPicks.js'

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
  const [target, setTarget] = useState<string | undefined>(() =>
    lists.some((entry) => entry.id === initialTarget) ? initialTarget : undefined,
  )
  const [picker, setPicker] = useState<{ anchor: HTMLElement } | null>(null)
  const [query, setQuery] = useState('')
  const { answer, run, retry } = useHelperAnswer()
  const targetList = lists.find((entry) => entry.id === target)

  useEffect(() => {
    if (target) run(() => api.tiredBoss(target))
  }, [target, run])

  const needle = query.trim().toLowerCase()
  const matching = lists.filter((entry) => !needle || entry.title.toLowerCase().includes(needle))

  function choose(listId: string) {
    setPicker(null)
    setQuery('')
    if (listId !== target) setTarget(listId)
  }

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
      {targetList && (
        <PicksPanel
          answer={answer}
          why={whyTired}
          empty={t.nothingElse}
          onRetry={retry}
          onOpenList={onOpenList}
        />
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
