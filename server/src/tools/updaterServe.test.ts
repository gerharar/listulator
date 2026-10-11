import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseServeArguments, printable, startUpdaterServer } from './updaterServe.js'

/**
 * The local file server for the updater's two-version test (20.13a): a manifest and bundles from one folder, on this machine's
 * loopback address only. It is a test tool that sits next to a security feature (the updater decides what to trust), so it is kept
 * small and refuses everything it does not need: other methods, other names, anything outside the folder.
 */

let dir: string
let server: Server
let logged: string[]

const BUNDLE = Buffer.from('b'.repeat(5000))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'updater-serve-'))
  writeFileSync(join(dir, 'latest.json'), '{"version":"1.0.0-rc.2"}\n')
  writeFileSync(join(dir, 'Listulator.app.tar.gz'), BUNDLE)
  writeFileSync(join(dir, '.hidden'), 'secret')
  writeFileSync(join(dir, '..outside'), 'x')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'inner.txt'), 'inner')
  logged = []
})

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  rmSync(dir, { recursive: true, force: true })
})

async function start(options: { cutAfter?: number } = {}): Promise<number> {
  server = await startUpdaterServer({ dir, ...(options.cutAfter === undefined ? {} : { cutAfter: options.cutAfter }), log: (line) => logged.push(line) }, 0)

  return (server.address() as AddressInfo).port
}

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  error?: string
}

/** A raw request, so the path is sent exactly as written (a URL parser would tidy `..` away before the server saw it). */
function ask(port: number, path: string, method = 'GET'): Promise<Answer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', (error) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), error: error.message }))
      res.on('aborted', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), error: 'aborted' }))
    })
    req.on('error', (error) => resolve({ status: 0, headers: {}, body: Buffer.concat(chunks), error: error.message }))
    req.end()
  })
}

describe('what it serves', () => {
  it('listens on the loopback address only, not on the network', async () => {
    await start()

    expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
  })

  it('says so, and does not start, when the port is taken', async () => {
    const port = await start()

    await expect(startUpdaterServer({ dir }, port)).rejects.toThrow(/EADDRINUSE|in use/)
  })

  it('serves the manifest as JSON and a bundle as bytes, exactly, with their length', async () => {
    const port = await start()

    const manifest = await ask(port, '/latest.json')
    const bundle = await ask(port, '/Listulator.app.tar.gz')

    expect(manifest.status).toBe(200)
    expect(manifest.headers['content-type']).toMatch(/^application\/json/)
    expect(manifest.body.toString()).toBe('{"version":"1.0.0-rc.2"}\n')
    expect(bundle.status).toBe(200)
    expect(bundle.headers['content-type']).toBe('application/octet-stream')
    expect(bundle.headers['content-length']).toBe(String(BUNDLE.length))
    expect(bundle.body.equals(BUNDLE)).toBe(true)
  })

  it('reads the files at each request, so replacing a file between two requests changes the answer (a tampered bundle, a new manifest)', async () => {
    const port = await start()
    await ask(port, '/latest.json')

    writeFileSync(join(dir, 'latest.json'), '{"version":"9.9.9"}\n')

    expect((await ask(port, '/latest.json')).body.toString()).toBe('{"version":"9.9.9"}\n')
  })

  it('lets nothing be cached', async () => {
    const port = await start()

    expect((await ask(port, '/latest.json')).headers['cache-control']).toBe('no-store')
  })

  it('answers HEAD with the headers and no body', async () => {
    const port = await start()

    const answer = await ask(port, '/Listulator.app.tar.gz', 'HEAD')

    expect(answer.status).toBe(200)
    expect(answer.headers['content-length']).toBe(String(BUNDLE.length))
    expect(answer.body.length).toBe(0)
  })

  it('ignores a query string', async () => {
    const port = await start()

    expect((await ask(port, '/latest.json?current_version=1.0.0-rc.1&target=darwin')).status).toBe(200)
  })

  it('says 404 for a file that is not there, with a short plain text and no path in it', async () => {
    const port = await start()

    const answer = await ask(port, '/nothing.json')

    expect(answer.status).toBe(404)
    expect(answer.body.toString()).not.toContain('/')
  })
})

describe('what it refuses', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('%s: only GET and HEAD are answered', async (method) => {
    const port = await start()

    const answer = await ask(port, '/latest.json', method)

    expect(answer.status).toBe(405)
    expect(answer.headers['allow']).toBe('GET, HEAD')
  })

  it.each([
    ['a path that climbs out', '/../package.json'],
    ['a path that climbs out, encoded', '/%2e%2e/package.json'],
    ['a path that climbs out, with an encoded slash', '/..%2fpackage.json'],
    ['a backslash path', '/..\\package.json'],
    ['a file in a sub-folder', '/sub/inner.txt'],
    ['the folder itself', '/'],
    ['a sub-folder', '/sub'],
    ['a dot file', '/.hidden'],
    ['a name that starts with two dots', '/..outside'],
    ['a NUL byte', '/latest.json%00.png'],
    ['an absolute-looking path', '//etc/passwd'],
    ['a name with a space', '/latest%20.json'],
    ['a malformed escape', '/%zz'],
  ])('answers 404 for %s', async (_name, path) => {
    const port = await start()

    const answer = await ask(port, path)

    expect(answer.status).toBe(404)
    expect(answer.body.toString()).not.toMatch(/inner|secret|root|version/)
  })

  it('does not follow a link out of the folder', async () => {
    writeFileSync(join(tmpdir(), 'updater-serve-target.txt'), 'outside the folder')
    symlinkSync(join(tmpdir(), 'updater-serve-target.txt'), join(dir, 'link.txt'))
    const port = await start()

    const answer = await ask(port, '/link.txt')

    expect(answer.status).toBe(404)
    expect(answer.body.toString()).not.toContain('outside')
  })
})

describe('the log', () => {
  it('writes one line per request: the method, the path, the answer and the size', async () => {
    const port = await start()

    await ask(port, '/latest.json')
    await ask(port, '/missing')
    await ask(port, '/latest.json', 'POST')

    expect(logged).toEqual([expect.stringMatching(/GET \/latest\.json 200 25 bytes/), expect.stringMatching(/GET \/missing 404/), expect.stringMatching(/POST \/latest\.json 405/)])
  })

  it('shows control and non-ASCII characters in a path escaped, so nothing a stranger sends can drive the terminal, and cuts a long one', () => {
    expect(printable('/latest.json')).toBe('/latest.json')
    expect(printable('/x\u001b[31mred\u0007')).toBe('/x\\x1b[31mred\\x07')
    expect(printable('/é\u007f\n')).toBe('/\\xe9\\x7f\\x0a')
    expect(printable('/' + 'a'.repeat(500))).toHaveLength(201)
  })

  it('writes a percent-escaped path as it came, never decoded into the log', async () => {
    const port = await start()

    await ask(port, '/x%1b%5b31mred')

    expect(logged.join('\n')).toContain('/x%1b%5b31mred')
  })
})

describe('an interrupted download (to test a bundle that never arrives whole)', () => {
  it('sends the first bytes of a bundle and then drops the connection, so the client gets less than the length it was told', async () => {
    const port = await start({ cutAfter: 1000 })

    const answer = await ask(port, '/Listulator.app.tar.gz')

    expect(answer.headers['content-length']).toBe(String(BUNDLE.length))
    expect(answer.body.length).toBeLessThan(BUNDLE.length)
    expect(answer.error).toBeDefined()
    expect(logged.join('\n')).toMatch(/cut after 1000 bytes/)
  })

  it('never cuts the manifest, which the check needs whole', async () => {
    const port = await start({ cutAfter: 3 })

    const answer = await ask(port, '/latest.json')

    expect(answer.body.toString()).toBe('{"version":"1.0.0-rc.2"}\n')
    expect(answer.error).toBeUndefined()
  })
})

describe('the command line', () => {
  it('needs a folder, defaults to port 8099 (the test config’s), and takes a port and a cut', () => {
    expect(parseServeArguments(['/tmp/files'])).toEqual({ dir: '/tmp/files', port: 8099 })
    expect(parseServeArguments(['/tmp/files', '--port', '8123', '--cut-after', '2048'])).toEqual({ dir: '/tmp/files', port: 8123, cutAfter: 2048 })
  })

  it.each([
    ['no folder', []],
    ['an unknown option', ['/tmp/files', '--host', '0.0.0.0']],
    ['a port that is not a number', ['/tmp/files', '--port', 'abc']],
    ['a port out of range', ['/tmp/files', '--port', '70000']],
    ['a port of zero', ['/tmp/files', '--port', '0']],
    ['a cut that is not a number', ['/tmp/files', '--cut-after', 'x']],
    ['a negative cut', ['/tmp/files', '--cut-after', '-1']],
    ['a second folder', ['/tmp/a', '/tmp/b']],
    ['an option without its value', ['/tmp/files', '--port']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseServeArguments(args)).toBe('string')
  })
})
