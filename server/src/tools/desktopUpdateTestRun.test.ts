import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from './desktopUpdateTestRun.js'

/** The refusals of `npm run test:desktop-update` that come before it touches anything (Phase 31, task 31.7). The rest of it needs Windows. */
describe('run', () => {
  it('does nothing off Windows, and says so', async () => {
    const lines: string[] = []
    const code = await run(['somewhere'], { platform: 'darwin', env: {}, log: (line) => lines.push(line) })

    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/Windows/)
  })

  it('says what is wrong with the command line before it looks at the machine', async () => {
    const lines: string[] = []
    const code = await run(['--keep'], { platform: 'win32', env: {}, log: (line) => lines.push(line) })

    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/unknown option/)
  })

  it('stops on a folder that is not there, without installing anything', async () => {
    const lines: string[] = []
    const code = await run(['Z:\\no\\such\\folder'], { platform: 'win32', env: { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' }, log: (line) => lines.push(line) })

    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/folder/)
  })

  it("does not start while the workflow's throw-away key is still in the runner's temp folder: the test runs after the key is deleted", async () => {
    const temp = mkdtempSync(join(tmpdir(), 'update-test-'))
    try {
      writeFileSync(join(temp, 'updater-test-run.key'), 'x')
      const lines: string[] = []
      const code = await run(['Z:\\no\\such\\folder'], { platform: 'win32', env: { RUNNER_TEMP: temp, LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' }, log: (line) => lines.push(line) })

      expect(code).toBe(1)
      expect(lines.join('\n')).toMatch(/key is still there/)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('does not start when something already answers on the debugging port: it could be any program, and the test would drive it', async () => {
    const lines: string[] = []
    const code = await run(['Z:\\no\\such\\folder'], { platform: 'win32', env: { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' }, log: (line) => lines.push(line), portAnswers: async () => true })

    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/already answers/)
  })
})

/**
 * The first runner run (2026-10-21) hung on "Checking…": the update server lives in the runner's own process, and the spec was started with
 * `spawnSync`, which blocks that process's event loop, so the server never answered. Whatever runs while the server is up must be awaited.
 */
describe('the process that serves the update', () => {
  it('starts the spec without blocking its own event loop', () => {
    const source = readFileSync(new URL('./desktopUpdateTestRun.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/spawnSync\(process\.execPath/)
    expect(source).toMatch(/spawn\(process\.execPath/)
  })
})
