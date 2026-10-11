import { lstatSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { isRunDirectly } from './runDirectly.js'

/**
 * A local file server for the updater's two-version test (Phase 20, task 20.13a):
 * `npm run updater:serve -- <folder> [--port 8099] [--cut-after <bytes>]`. It serves the files that lie directly in the folder
 * (the manifest `latest.json`, the installers or archives, their signatures) on 127.0.0.1 and nowhere else, so the test build,
 * whose update address is `http://127.0.0.1:8099/latest.json` (apps/desktop/src-tauri/tauri.updater-test.conf.json), can check for
 * and download an update without GitHub. It is a test tool beside a security feature, so it does the least that works: GET and HEAD
 * only, one folder, plain file names only, no listing, no links followed, nothing cached, every request logged. Files are read at each
 * request, so a file replaced between two requests is what the next one gets (the tampered-bundle test).
 */

export const DEFAULT_PORT = 8099
/** The only address this server listens on: this machine, not the network. */
const LOOPBACK = '127.0.0.1'

/** A plain name: it starts with a letter or digit (no dot files, no `..`), then letters, digits, dots, hyphens and underscores. */
export const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface ServeOptions {
  /** The folder whose files are served. */
  dir: string
  /** If set, a download (anything but the manifest) is dropped after this many bytes, to test an interrupted download. */
  cutAfter?: number
  log?: (line: string) => void
}

/** The text of a path made safe to print: anything that is not plain printable ASCII is shown as \xNN, and a long one is cut. */
export function printable(text: string): string {
  const escaped = text.replace(/[^\x20-\x7e]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)

  return escaped.length > 200 ? `${escaped.slice(0, 200)}…` : escaped
}

export function createUpdaterServer({ dir, cutAfter, log = () => undefined }: ServeOptions): Server {
  return createServer((req, res) => {
    const method = req.method ?? ''
    const raw = (req.url ?? '').split('#')[0]!.split('?')[0]!
    const done = (status: number, note: string): void => {
      log(`${new Date().toISOString().slice(11, 19)} ${printable(method)} ${printable(raw)} ${status}${note}`)
    }
    const plain = (status: number, text: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers })
      res.end(text)
    }

    if (method !== 'GET' && method !== 'HEAD') {
      plain(405, 'Method not allowed\n', { allow: 'GET, HEAD' })
      return done(405, '')
    }

    const name = ((): string => {
      try {
        return decodeURIComponent(raw.startsWith('/') ? raw.slice(1) : '')
      } catch {
        return ''
      }
    })()
    let body: Buffer | undefined
    if (PLAIN_NAME.test(name)) {
      try {
        // lstat, not stat: a link is not a file here, so nothing outside the folder can be reached through one.
        if (lstatSync(resolve(dir, name)).isFile()) body = readFileSync(resolve(dir, name))
      } catch {
        body = undefined
      }
    }
    if (body === undefined) {
      plain(404, 'Not found\n')
      return done(404, '')
    }

    res.writeHead(200, {
      'content-type': name.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream',
      'content-length': String(body.length),
      'cache-control': 'no-store',
    })
    if (method === 'HEAD') {
      res.end()
      return done(200, ` ${body.length} bytes`)
    }

    // The manifest is never cut: the check needs it whole, and the interruption under test is the download's.
    if (cutAfter !== undefined && name !== 'latest.json' && cutAfter < body.length) {
      res.write(body.subarray(0, cutAfter), () => res.socket?.destroy())
      return done(200, ` ${body.length} bytes (cut after ${cutAfter} bytes)`)
    }
    res.end(body)
    done(200, ` ${body.length} bytes`)
  })
}

/** Starts the server on the loopback address (127.0.0.1) and nowhere else; port 0 takes any free port (tests). Rejects if the port is taken. */
export function startUpdaterServer(options: ServeOptions, port: number): Promise<Server> {
  const server = createUpdaterServer(options)

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK, () => {
      server.off('error', reject)
      resolvePromise(server)
    })
  })
}

export interface ServeArguments {
  dir: string
  port: number
  cutAfter?: number
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseServeArguments(args: readonly string[]): ServeArguments | string {
  let dir: string | undefined
  let port = DEFAULT_PORT
  let cutAfter: number | undefined

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--port' || arg === '--cut-after') {
      const value = args[index + 1]
      if (value === undefined) return `${arg} needs a number`
      index++
      if (!/^\d+$/.test(value)) return `${arg} needs a whole number, not ${JSON.stringify(value).slice(0, 30)}`
      if (arg === '--port') {
        port = Number(value)
        if (port < 1 || port > 65535) return '--port must be between 1 and 65535'
      } else {
        cutAfter = Number(value)
      }
    } else if (arg.startsWith('-')) {
      return `unknown option ${JSON.stringify(arg).slice(0, 30)} (this server listens on 127.0.0.1 only)`
    } else if (dir === undefined) {
      dir = arg
    } else {
      return 'only one folder can be served'
    }
  }
  if (dir === undefined) return 'name the folder to serve'

  return cutAfter === undefined ? { dir, port } : { dir, port, cutAfter }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseServeArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run updater:serve -- <folder> [--port ${DEFAULT_PORT}] [--cut-after <bytes>]`)
    process.exit(1)
  }
  try {
    if (!lstatSync(parsed.dir).isDirectory()) throw new Error('not a folder')
  } catch {
    console.error(`${parsed.dir} is not a folder`)
    process.exit(1)
  }

  startUpdaterServer({ dir: parsed.dir, ...(parsed.cutAfter === undefined ? {} : { cutAfter: parsed.cutAfter }), log: (line) => console.log(line) }, parsed.port).then(
    () => {
      console.log(`Serving ${resolve(parsed.dir)} at http://127.0.0.1:${parsed.port}/ (Ctrl+C to stop)`)
      if (parsed.cutAfter !== undefined) console.log(`Downloads are cut after ${parsed.cutAfter} bytes (the manifest is not).`)
    },
    (error: Error) => {
      console.error(`Could not listen on 127.0.0.1:${parsed.port}: ${error.message}`)
      process.exit(1)
    },
  )
}
