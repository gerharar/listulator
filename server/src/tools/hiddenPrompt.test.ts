import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { askLine, feedPassphrase, readHiddenLine } from './hiddenPrompt.js'

/**
 * The prompts of `release:ship` (31.5). The passphrase prompt is the one place the owner's own process sees the passphrase before it
 * goes to the signer, so it is small, shows nothing the owner types (not even `*`), reads only from a real terminal, and always
 * leaves the terminal as it found it. Tested with a fake terminal, no real one needed.
 */

describe('what typing does to the passphrase so far', () => {
  it('adds printable characters, spaces and non-ASCII ones included', () => {
    expect(feedPassphrase('', 'abc')).toEqual({ text: 'abc', done: false, aborted: false })
    expect(feedPassphrase('ab', ' ü€😀')).toEqual({ text: 'ab ü€😀', done: false, aborted: false })
  })

  it.each([['\r'], ['\n'], ['\r\n']])('is finished by Enter (%j)', (enter) => {
    expect(feedPassphrase('ab', `c${enter}`)).toEqual({ text: 'abc', done: true, aborted: false })
  })

  it('ignores whatever follows the Enter in the same read (a paste)', () => {
    expect(feedPassphrase('', 'abc\nxyz')).toEqual({ text: 'abc', done: true, aborted: false })
  })

  it('removes the last character on Backspace or Delete, one at a time, and does nothing on an empty line', () => {
    expect(feedPassphrase('abc', '\u007f')).toMatchObject({ text: 'ab' })
    expect(feedPassphrase('abc', '\b\b')).toMatchObject({ text: 'a' })
    expect(feedPassphrase('', '\u007f')).toMatchObject({ text: '' })
    expect(feedPassphrase('a😀', '\u007f')).toMatchObject({ text: 'a' })
  })

  it('is cancelled by Ctrl-C, and the text so far is thrown away', () => {
    expect(feedPassphrase('secret', '\u0003')).toEqual({ text: '', done: false, aborted: true })
    expect(feedPassphrase('', 'ab\u0003cd')).toEqual({ text: '', done: false, aborted: true })
  })

  it('is cancelled by Ctrl-D on an empty line only, as in a shell', () => {
    expect(feedPassphrase('', '\u0004')).toMatchObject({ aborted: true })
    expect(feedPassphrase('ab', '\u0004')).toEqual({ text: 'ab', done: false, aborted: false })
  })

  it.each([
    ['an arrow key', '\u001b[A'],
    ['Delete', '\u001b[3~'],
    ['a function key', '\u001bOP'],
    ['a long sequence', '\u001b[1;5C'],
    ['a lone Escape', '\u001b'],
  ])('ignores %s completely, its tail characters too', (_name, sequence) => {
    expect(feedPassphrase('ab', `${sequence}c`)).toEqual({ text: 'abc', done: false, aborted: false })
  })

  it('ignores Tab and other control characters', () => {
    expect(feedPassphrase('', 'a\tb\u0001c')).toMatchObject({ text: 'abc' })
  })
})

/** A terminal that records what the program does to it. */
class FakeTerminal extends PassThrough {
  isTTY = true
  rawModes: boolean[] = []
  setRawMode(mode: boolean): this {
    this.rawModes.push(mode)

    return this
  }
}

function terminal() {
  const input = new FakeTerminal()
  const shown: string[] = []
  const output = { write: (text: string) => shown.push(text) }
  const type = (text: string) => setImmediate(() => input.write(text))

  return { input, output, shown, type }
}

describe('reading the passphrase from a terminal', () => {
  it('returns what was typed, however it arrived in pieces', async () => {
    const { input, output, type } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    type('hun')
    setTimeout(() => type('ter2\r'), 5)

    expect(await promise).toBe('hunter2')
  })

  it('shows the question and a line break, and NOTHING of what is typed: no echo, no asterisks', async () => {
    const { input, output, shown, type } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    type('hunter2\r')
    await promise

    expect(shown).toEqual(['Passphrase: ', '\n'])
    expect(shown.join('')).not.toMatch(/hunter2|\*/)
  })

  it('is in raw mode while it reads (so the terminal does not echo) and puts the terminal back', async () => {
    const { input, output, type } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    type('x\r')
    await promise

    expect(input.rawModes).toEqual([true, false])
    expect(input.listenerCount('data')).toBe(0)
    expect(input.isPaused()).toBe(true)
  })

  it('on Ctrl-C rejects, says nothing of the text, and still puts the terminal back', async () => {
    const { input, output, shown, type } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    type('hunter2\u0003')

    await expect(promise).rejects.toThrow(/interrupted/i)
    await expect(promise).rejects.not.toThrow(/hunter2/)
    expect(input.rawModes).toEqual([true, false])
    expect(input.listenerCount('data')).toBe(0)
    expect(shown.join('')).not.toContain('hunter2')
  })

  it('refuses to read from anything that is not a terminal, and reads nothing: a passphrase is never taken from a pipe or a file', async () => {
    const input = new PassThrough()
    const shown: string[] = []
    input.write('hunter2\n')

    await expect(readHiddenLine('Passphrase: ', { input, output: { write: (text: string) => shown.push(text) } })).rejects.toThrow(/terminal/i)
    expect(shown).toEqual([])
    expect(input.listenerCount('data')).toBe(0)
  })

  it('returns an empty line as it is: it is the caller who decides an empty passphrase is no answer', async () => {
    const { input, output, type } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    type('\r')

    expect(await promise).toBe('')
  })

  it('reads a multi-byte character that arrives split over two reads', async () => {
    const { input, output } = terminal()
    const promise = readHiddenLine('Passphrase: ', { input, output })
    const euro = Buffer.from('€')
    setImmediate(() => input.write(euro.subarray(0, 1)))
    setTimeout(() => input.write(Buffer.concat([euro.subarray(1), Buffer.from('\r')])), 5)

    expect(await promise).toBe('€')
  })
})

describe('reading a visible answer (the key file’s path, yes or no)', () => {
  it('shows the question and returns the line, without its line break', async () => {
    const input = new PassThrough()
    const shown: string[] = []
    const promise = askLine('Publish v1.1.1 now? (y/N) ', { input, output: { write: (text: string) => shown.push(text) } })
    input.write('yes\n')

    expect(await promise).toBe('yes')
    expect(shown.join('')).toContain('Publish v1.1.1 now? (y/N) ')
  })

  it('returns an empty answer when the input ends without an answer', async () => {
    const input = new PassThrough()
    const promise = askLine('Path: ', { input, output: { write: () => true } })
    input.end()

    expect(await promise).toBe('')
  })
})
