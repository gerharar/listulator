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
})
