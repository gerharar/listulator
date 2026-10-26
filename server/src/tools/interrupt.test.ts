import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { interruptSignal } from './interrupt.js'

/**
 * Ctrl-C (BL-126): a tool that makes a mess on the way (a mounted disk image, a worktree) must not die in the middle of it. The first signal
 * asks the tool to stop and clean up; a second one, from an owner who does not want to wait, ends the process at once.
 */

function fakeProcess() {
  const events = new EventEmitter()
  const exits: number[] = []

  return {
    events,
    exits,
    process: {
      on: (name: 'SIGINT' | 'SIGTERM', listener: () => void) => events.on(name, listener),
      off: (name: 'SIGINT' | 'SIGTERM', listener: () => void) => events.off(name, listener),
      exit: (code: number) => void exits.push(code),
    },
  }
}

describe('interruptSignal', () => {
  it('is not aborted until a signal comes', () => {
    const { process } = fakeProcess()

    expect(interruptSignal(process, () => undefined).signal.aborted).toBe(false)
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('aborts on the first %s, says so, and does not end the process', (name) => {
    const { process, events, exits } = fakeProcess()
    const said: string[] = []
    const { signal } = interruptSignal(process, (line) => said.push(line))

    events.emit(name)

    expect(signal.aborted).toBe(true)
    expect(exits).toEqual([])
    expect(said.join(' ')).toMatch(/cleaning up.*again/i)
  })

  it('ends the process at once on a second signal, with the code a Ctrl-C ends with', () => {
    const { process, events, exits } = fakeProcess()
    interruptSignal(process, () => undefined)

    events.emit('SIGINT')
    events.emit('SIGINT')

    expect(exits).toEqual([130])
  })

  it('stops listening when disposed: a later Ctrl-C is the default again', () => {
    const { process, events } = fakeProcess()
    const interrupt = interruptSignal(process, () => undefined)

    interrupt.dispose()

    expect(events.listenerCount('SIGINT')).toBe(0)
    expect(events.listenerCount('SIGTERM')).toBe(0)
  })
})
