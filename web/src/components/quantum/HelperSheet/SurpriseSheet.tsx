import './HelperSheet.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { useReducedMotion } from '../Motion/MotionContext.js'
import { categoryLabel, copy, sortCategories } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { Sheet } from '../Sheet/Sheet.js'
import { Spinner } from '../Spinner/Spinner.js'
import { StatusChip } from '../StatusChip/StatusChip.js'
import { ToggleChip } from '../ToggleChip/ToggleChip.js'
import { useToast } from '../Toast/Toast.js'
import { candidatePool, digitsFor, randomDigits, SPIN_MS, spinDelay } from './discover.js'

export interface SurpriseSheetProps {
  open: boolean
  onClose: () => void
  /** The registry: the shelves offered, in order, and their names. */
  mediaTypes: readonly MediaType[]
  /** This One: preview the entry, to be added through the ordinary canonical path. */
  onTake: (entry: LibraryEntry) => void
  /** For a test; `Math.random` otherwise. */
  random?: () => number
}

type Library = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; entries: LibraryEntry[] }

interface Dials {
  spinning: boolean
  name: string
  digits: string
  result?: LibraryEntry
}

const IDLE: Dials = { spinning: false, name: '', digits: '000000' }

/**
 * Surprise Me: a random community-library list you do not track yet, no engine.
 * Shelves narrow it; the six dials spin, slow and settle on the list's item
 * count (reduced motion skips the show); This One previews it, and Add list
 * imports it through the same canonical path a search result uses.
 */
export function SurpriseSheet(props: SurpriseSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null
}

function OpenSheet({ onClose, mediaTypes, onTake, random = Math.random }: SurpriseSheetProps) {
  const text = copy.quantum.helper.surprise
  const { announce } = useLiveRegion()
  const { showToast } = useToast()
  const reducedMotion = useReducedMotion()
  const [library, setLibrary] = useState<Library>({ phase: 'loading' })
  const [shelves, setShelves] = useState<ReadonlySet<string>>(new Set())
  const [dials, setDials] = useState<Dials>(IDLE)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const request = useRef(0)

  const load = useCallback(() => {
    request.current += 1
    const mine = request.current
    setLibrary({ phase: 'loading' })

    api
      .libraryUntracked()
      .then(({ entries, reachable }) => {
        if (request.current === mine) setLibrary(reachable ? { phase: 'ready', entries } : { phase: 'failed' })
      })
      .catch(() => {
        if (request.current === mine) setLibrary({ phase: 'failed' })
      })
  }, [])

  useEffect(() => {
    load()

    return () => clearTimeout(timer.current)
  }, [load])

  const entries = library.phase === 'ready' ? library.entries : []
  const pool = useMemo(() => candidatePool(entries, shelves), [entries, shelves])
  // Not memoised: the order follows the language, and this is a dozen entries.
  const shelfNames = sortCategories(mediaTypes)

  function stopSpin() {
    clearTimeout(timer.current)
    timer.current = undefined
  }

  /** A shelf changed: whatever was landing or landed is no longer about this selection. */
  function toggleShelf(key: string | null) {
    stopSpin()
    setDials(IDLE)
    setShelves((current) => {
      if (key === null) return new Set()
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)

      return next
    })
  }

  function spin() {
    if (pool.length === 0) {
      showToast({ text: text.nothingLeft(shelves.size) })
      return
    }

    stopSpin()
    const pick = pool[Math.floor(random() * pool.length)]!
    const land = () => {
      timer.current = undefined
      setDials({ spinning: false, name: pick.title, digits: digitsFor(pick.itemCount), result: pick })
      announce(text.landed(pick.title))
    }

    if (reducedMotion) {
      land()
      return
    }

    // The deceleration runs against the clock and `land` is the only way out, so the dials always come to rest.
    const start = Date.now()
    const step = () => {
      const progress = Math.min(1, (Date.now() - start) / SPIN_MS)
      if (progress >= 1) {
        land()
        return
      }
      setDials({
        spinning: true,
        name: pool[Math.floor(random() * pool.length)]!.title,
        digits: randomDigits(random),
      })
      timer.current = setTimeout(step, spinDelay(progress))
    }
    step()
  }

  const count = (key: string) => entries.filter((entry) => entry.category === key).length
  const result = dials.result
  const settled = Boolean(result) && !dials.spinning

  return (
    <Sheet open onClose={onClose} title={text.title} explain={text.explain} plateSeed={6}>
      {library.phase === 'loading' && (
        <div className="q-helper-progress">
          <Spinner label={copy.quantum.helper.loading} />
          <span>{copy.quantum.helper.loading}</span>
        </div>
      )}
      {library.phase === 'failed' && (
        <div className="q-helper-note">
          <p>{text.unreachable}</p>
          <Button onClick={load}>{copy.quantum.helper.retry}</Button>
        </div>
      )}
      {library.phase === 'ready' && (
        <>
          <div className="q-kicker">{text.category}</div>
          <div className="q-shelves">
            <ToggleChip
              pressed={shelves.size === 0}
              title={text.anyTitle(entries.length)}
              onClick={() => toggleShelf(null)}
            >
              {text.any}
            </ToggleChip>
            {shelfNames.map((type) => {
              const n = count(type.key)

              return (
                <ToggleChip
                  key={type.key}
                  pressed={shelves.has(type.key)}
                  className={n === 0 ? 'none' : undefined}
                  title={n > 0 ? text.shelfTitle(n) : text.nothingHere}
                  onClick={() => toggleShelf(type.key)}
                >
                  {categoryLabel(type)}
                </ToggleChip>
              )
            })}
          </div>

          <div className="q-reel">
            <div className="q-reel-head">
              <span className="q-dials" aria-hidden="true">
                {[...dials.digits].map((digit, index, all) => (
                  <span
                    key={index}
                    className={['q-digit', settled && index >= all.length - 3 && 'on', dials.spinning && 'ticking']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {digit}
                  </span>
                ))}
              </span>
            </div>
            <div className="q-reel-result">
              <div className="q-reel-name">
                {settled && (
                  <span className="q-curated" title={text.curatedTip}>
                    <Star width={15} height={15} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  </span>
                )}
                <span>
                  {dials.name ||
                    (pool.length > 0 ? text.pool(pool.length, shelves.size) : text.nothingHere)}
                </span>
                {settled && result?.status && <StatusChip status={result.status} />}
              </div>
              {settled && result && (
                <div className="q-reel-meta">
                  {text.meta(categoryLabel(shelfNames.find((type) => type.key === result.category) ?? { key: result.category, label: result.category }), result.itemCount)}
                </div>
              )}
              {settled && result?.description && <p className="q-reel-desc">{result.description}</p>}
            </div>
            <div className="q-pick-actions">
              {settled && result && (
                <Button variant="primary" onClick={() => onTake(result)}>
                  {text.thisOne}
                </Button>
              )}
              <Button disabled={dials.spinning} onClick={spin}>
                {dials.spinning ? text.spinning : settled ? text.spinAgain : text.spin}
              </Button>
            </div>
          </div>
          <p className="q-helper-note q-reel-note">{text.note}</p>
        </>
      )}
    </Sheet>
  )
}
