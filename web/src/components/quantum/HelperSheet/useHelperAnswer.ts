import { useCallback, useRef, useState } from 'react'
import type { SuggestionPick } from '../../../lib/api.js'

export type HelperAnswer =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; picks: SuggestionPick[] }

/**
 * One helper's request: asks, and shows only the newest answer if the question
 * changes while an earlier one is still on its way. Each request passes through
 * `loading`, which is what makes per-answer state (what was turned down) start over.
 */
export function useHelperAnswer() {
  const [answer, setAnswer] = useState<HelperAnswer>({ phase: 'idle' })
  const request = useRef(0)
  const last = useRef<(() => Promise<{ picks: SuggestionPick[] }>) | null>(null)

  const run = useCallback((fetcher: () => Promise<{ picks: SuggestionPick[] }>) => {
    last.current = fetcher
    request.current += 1
    const mine = request.current
    setAnswer({ phase: 'loading' })

    fetcher()
      .then(({ picks }) => {
        if (request.current !== mine) return
        setAnswer({ phase: 'ready', picks })
      })
      .catch(() => {
        if (request.current === mine) setAnswer({ phase: 'failed' })
      })
  }, [])

  const retry = useCallback(() => {
    if (last.current) run(last.current)
  }, [run])

  return { answer, run, retry }
}
