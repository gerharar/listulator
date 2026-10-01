import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppUpdateChecker, UpdateCheckState } from './appUpdate.js'

export interface UpdateCheck {
  state: UpdateCheckState
  /** The version an update offers; set in the `available` state. */
  next: string | undefined
  /** Checks again. Does nothing while a check is running. */
  check: () => Promise<void>
  /** Hands off to the checker's download for the offered version. */
  download: () => void
}

/**
 * The state machine behind the About screen's update block (task 13.3). It checks once when the screen opens,
 * starting in `checking` so nothing is ever claimed before an answer. A press while a check runs does
 * nothing; a failed check is `error`; an answer that arrives after the screen has closed is dropped.
 */
export function useUpdateCheck(checker: AppUpdateChecker): UpdateCheck {
  const [state, setState] = useState<UpdateCheckState>('checking')
  const [next, setNext] = useState<string | undefined>(undefined)
  const running = useRef(false)
  const alive = useRef(true)

  const check = useCallback(async (): Promise<void> => {
    if (running.current) return
    running.current = true
    setState('checking')

    try {
      const result = await checker.check()
      if (!alive.current) return

      setNext(result.kind === 'available' ? result.version : undefined)
      setState(result.kind)
    } catch {
      if (alive.current) setState('error')
    } finally {
      running.current = false
    }
  }, [checker])

  // `running` makes the second mount of StrictMode's mount, unmount, mount a no-op: one check, whose
  // answer still counts because `alive` is true again by the time it arrives.
  useEffect(() => {
    alive.current = true
    void check()

    return () => {
      alive.current = false
    }
  }, [check])

  const download = useCallback((): void => {
    if (next === undefined) return

    Promise.resolve(checker.download?.(next)).catch((error: unknown) => console.error('Could not start the update', error))
  }, [checker, next])

  return { state, next, check, download }
}
