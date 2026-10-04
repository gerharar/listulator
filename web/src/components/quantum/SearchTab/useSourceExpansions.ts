import { useCallback, useEffect, useRef, useState } from 'react'
import type { SourceExpansion } from '../../../lib/api.js'

export type ExpansionState =
  | { state: 'loading' }
  | { state: 'done'; itemCount: number; status?: 'complete' | 'ongoing' }
  /** A failed count shows no number and no error — the row is still perfectly usable. */
  | { state: 'failed' }

/**
 * Per-result expansions in flight at once. TMDB fetches a runtime per film
 * and MusicBrainz/Comic Vine sit behind a server-side limiter, so more than
 * a couple of parallel requests only queue up server-side — while an "Add
 * list" click would wait behind all of them.
 */
export const EXPANSION_CONCURRENCY = 2

/**
 * Loads each search result's item count and status after its row has
 * rendered (task 10.12, Q11) — never holding the list back.
 *
 * `begin` starts a batch and supersedes any earlier one: responses from a
 * superseded, cancelled or unmounted batch are dropped, and its queued
 * fetches never start. That is what keeps a slow first search from
 * overwriting the second one's counts, and lets "Add list" stop speculative
 * counts from queueing ahead of the import.
 */
/** A count the search answer already carried: the row shows it at once and asks for no `expansion` of its own. */
export type KnownCounts = ReadonlyMap<string, { itemCount: number }>

const NONE: KnownCounts = new Map()

/** One search's pending fetches, shared by the first rows and any "Show more" appended later, so the lanes never multiply. */
interface Batch {
  generation: number
  queue: string[]
  lanes: number
  fetchExpansion: (ref: string) => Promise<SourceExpansion>
}

export function useSourceExpansions() {
  const [states, setStates] = useState<ReadonlyMap<string, ExpansionState>>(new Map())
  const statesRef = useRef(states)
  statesRef.current = states
  const generation = useRef(0)
  const batch = useRef<Batch | undefined>(undefined)

  const cancel = useCallback(() => {
    generation.current += 1
  }, [])

  useEffect(() => cancel, [cancel])

  const settle = useCallback((mine: number, ref: string, value: ExpansionState) => {
    if (generation.current !== mine) return
    setStates((previous) => new Map(previous).set(ref, value))
  }, [])

  const worker = useCallback(
    async (current: Batch) => {
      try {
        while (generation.current === current.generation && current.queue.length > 0) {
          const ref = current.queue.shift()!

          try {
            const { itemCount, status } = await current.fetchExpansion(ref)
            settle(current.generation, ref, { state: 'done', itemCount, ...(status ? { status } : {}) })
          } catch {
            settle(current.generation, ref, { state: 'failed' })
          }
        }
      } finally {
        current.lanes -= 1
      }
    },
    [settle],
  )

  /** Starts lanes up to the limit: the same two whether the queue holds the first rows or some appended later. */
  const pump = useCallback(
    (current: Batch) => {
      while (current.lanes < EXPANSION_CONCURRENCY && current.queue.length > 0) {
        current.lanes += 1
        void worker(current)
      }
    },
    [worker],
  )

  const run = useCallback(
    (
      refs: readonly string[],
      fetchExpansion: (ref: string) => Promise<SourceExpansion>,
      keepDone: boolean,
      known: KnownCounts,
    ) => {
      generation.current += 1
      const mine = generation.current

      // A new batch starts every row over; resuming keeps what is already known.
      const todo = (keepDone ? refs.filter((ref) => statesRef.current.get(ref)?.state !== 'done') : [...refs]).filter(
        (ref) => !known.has(ref),
      )

      setStates((previous) => {
        const next = new Map<string, ExpansionState>(keepDone ? previous : [])
        for (const ref of refs) {
          const count = known.get(ref)
          if (count) next.set(ref, { state: 'done', itemCount: count.itemCount })
          else if (!next.has(ref) || todo.includes(ref)) next.set(ref, { state: 'loading' })
        }
        return next
      })

      batch.current = { generation: mine, queue: todo, lanes: 0, fetchExpansion }
      pump(batch.current)
    },
    [pump],
  )

  const shown = useRef<readonly string[]>([])

  const begin = useCallback(
    (refs: readonly string[], fetchExpansion: (ref: string) => Promise<SourceExpansion>, known: KnownCounts = NONE) => {
      shown.current = refs
      run(refs, fetchExpansion, false, known)
    },
    [run],
  )

  /**
   * More rows under the ones already there ("Show more"): keeps every state, so counts still loading for the
   * rows above are not dropped, and joins the new rows to the same queue and lanes. After a `cancel` (or
   * a newer search) it only records the rows, for `resume` to pick up.
   */
  const append = useCallback(
    (refs: readonly string[], fetchExpansion: (ref: string) => Promise<SourceExpansion>, known: KnownCounts = NONE) => {
      shown.current = [...shown.current, ...refs]
      const todo = refs.filter((ref) => !known.has(ref))

      setStates((previous) => {
        const next = new Map(previous)
        for (const ref of refs) {
          const count = known.get(ref)
          next.set(ref, count ? { state: 'done', itemCount: count.itemCount } : { state: 'loading' })
        }
        return next
      })

      const current = batch.current
      if (!current || current.generation !== generation.current) return

      current.queue.push(...todo)
      pump(current)
    },
    [pump],
  )

  /** Picks the current batch back up after a `cancel`, fetching only what is not already known. */
  const resume = useCallback(
    (fetchExpansion: (ref: string) => Promise<SourceExpansion>) => {
      run(shown.current, fetchExpansion, true, NONE)
    },
    [run],
  )

  return { states, begin, append, resume, cancel }
}
