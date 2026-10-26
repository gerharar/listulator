/**
 * Ctrl-C for the release tools (BL-126). `release:audit` mounts a disk image and `release:ship` makes a worktree: killed in the middle, each
 * leaves its mess behind (the runbook says how to clean up by hand). So the first SIGINT or SIGTERM does not end the process: it aborts a
 * signal that the tool checks between its steps, the tool stops where it is and runs the same cleanup it runs at the end of any run, and
 * then the program exits. A SECOND signal is an owner who will not wait: the process ends at once, as it would have without this.
 *
 * A Ctrl-C typed in the terminal also reaches the programs the tool started (they share the terminal's process group), so they end on their
 * own; a SIGTERM sent to the tool alone does not, and the cleanup then runs while one of them may still be finishing.
 */

export interface SignalProcess {
  on(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exit(code: number): unknown
}

export interface Interrupt {
  signal: AbortSignal
  /** Puts the signals back to what they were. */
  dispose(): void
}

export function interruptSignal(proc: SignalProcess, say: (line: string) => void): Interrupt {
  const controller = new AbortController()
  const onSignal = () => {
    if (controller.signal.aborted) {
      proc.exit(130)

      return
    }
    controller.abort()
    say('Interrupted: cleaning up (press Ctrl-C again to stop at once and leave the mess)')
  }
  proc.on('SIGINT', onSignal)
  proc.on('SIGTERM', onSignal)

  return {
    signal: controller.signal,
    dispose() {
      proc.off('SIGINT', onSignal)
      proc.off('SIGTERM', onSignal)
    },
  }
}
