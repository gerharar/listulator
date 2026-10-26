import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'

/**
 * The prompts of `release:ship` (Phase 31, task 31.5). The passphrase prompt is the one place where the owner's own process sees the
 * updater passphrase before it goes to the signer's environment, so it is kept small:
 *
 *  - it reads only from a real terminal, never from a pipe or a file, so a passphrase cannot be given in a script or a history line;
 *  - the terminal is put in raw mode, so nothing typed is echoed, and nothing of it is written by the program either (no asterisks);
 *  - the terminal is always put back, also when the owner cancels with Ctrl-C;
 *  - an error never mentions what was typed.
 */

export interface PromptInput {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  resume(): unknown
  pause(): unknown
}

export interface PromptOutput {
  write(text: string): unknown
}

export interface PromptStreams {
  input: PromptInput
  output: PromptOutput
}

export interface KeyState {
  /** What has been typed so far. */
  text: string
  /** Enter was pressed. */
  done: boolean
  /** Ctrl-C, or Ctrl-D on an empty line: the text is thrown away. */
  aborted: boolean
}

/** Applies what the terminal sent in one read (a key, or a pasted piece) to the text typed so far. */
export function feedPassphrase(text: string, chunk: string): KeyState {
  let typed = Array.from(text)
  const keys = Array.from(chunk)
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    if (key === '\r' || key === '\n') return { text: typed.join(''), done: true, aborted: false }
    if (key === '\u0003' || (key === '\u0004' && typed.length === 0)) return { text: '', done: false, aborted: true }
    if (key === '\u007f' || key === '\b') typed = typed.slice(0, -1)
    else if (key === '\u001b') {
      // An escape sequence (an arrow, Delete, a function key): skip it whole, up to its final character.
      if (keys[index + 1] === '[' || keys[index + 1] === 'O') {
        index += 2
        while (index < keys.length && !/[@-~]/.test(keys[index]!)) index++
      }
    } else if (key.charCodeAt(0) >= 0x20) typed.push(key)
  }

  return { text: typed.join(''), done: false, aborted: false }
}

/** Reads one line from a terminal without showing it. Rejects, reading nothing, when the input is not a terminal. */
export function readHiddenLine(question: string, { input, output }: PromptStreams): Promise<string> {
  const setRawMode = input.setRawMode?.bind(input)
  if (input.isTTY !== true || setRawMode === undefined) return Promise.reject(new Error('A passphrase is only read from a terminal: run this in a terminal window'))

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let text = ''
    const finish = (error?: Error) => {
      input.removeListener('data', onData)
      setRawMode(false)
      input.pause()
      output.write('\n')
      if (error === undefined) resolve(text)
      else reject(error)
    }
    const onData = (chunk: Buffer | string) => {
      const next = feedPassphrase(text, typeof chunk === 'string' ? chunk : decoder.write(chunk))
      text = next.text
      if (next.aborted) {
        text = ''
        finish(new Error('Interrupted: no passphrase was read'))
      } else if (next.done) finish()
    }

    output.write(question)
    setRawMode(true)
    input.on('data', onData)
    input.resume()
  })
}

/**
 * Reads one visible line (an answer the terminal shows as it is typed): the question, then the line without its line break. An aborted `signal`
 * (Ctrl-C, BL-126) ends the wait with an empty answer, which every caller reads as "no": a prompt that never answers would hold the tool open
 * with its cleanup undone.
 */
export function askLine(question: string, { input, output }: { input: NodeJS.ReadableStream; output: PromptOutput }, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted === true) return Promise.resolve('')
  const lines = createInterface({ input, terminal: false })

  return new Promise((resolve) => {
    let answered = false
    const onAbort = () => lines.close()
    lines.once('line', (line) => {
      answered = true
      signal?.removeEventListener('abort', onAbort)
      lines.close()
      resolve(line)
    })
    lines.once('close', () => {
      signal?.removeEventListener('abort', onAbort)
      if (!answered) resolve('')
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    output.write(question)
  })
}
