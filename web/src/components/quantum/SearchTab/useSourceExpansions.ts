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
export function useSourceExpansions() {
  const [states, setStates] = useState<ReadonlyMap<string, ExpansionState>>(new Map())
  const generation = useRef(0)

  const cancel = useCallback(() => {
    generation.current += 1
  }, [])

  useEffect(() => cancel, [cancel])

  const begin = useCallback(
    (refs: readonly string[], fetchExpansion: (ref: string) => Promise<SourceExpansion>) => {
      generation.current += 1
      const mine = generation.current

      setStates(new Map(refs.map((ref) => [ref, { state: 'loading' } as const])))

      let next = 0
      const settle = (ref: string, value: ExpansionState) => {
        if (generation.current !== mine) return
        setStates((previous) => new Map(previous).set(ref, value))
      }

      async function worker() {
        while (generation.current === mine && next < refs.length) {
          const ref = refs[next]!
          next += 1

          try {
            const { itemCount, status } = await fetchExpansion(ref)
            settle(ref, { state: 'done', itemCount, ...(status ? { status } : {}) })
          } catch {
            settle(ref, { state: 'failed' })
          }
        }
      }

      for (let lane = 0; lane < Math.min(EXPANSION_CONCURRENCY, refs.length); lane += 1) {
        void worker()
      }
    },
    [],
  )

  return { states, begin, cancel }
}
