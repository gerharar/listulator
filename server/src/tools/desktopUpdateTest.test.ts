import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri, type TestKeyPair } from './minisignTesting.js'
import { buildWindowsKitScenarios } from './updaterTestKit.js'
import { checkInstallerTrace, checkUpdateTrace, compareInstall, describeInstallerTrace, describeUpdateTrace, embeddedPubkeys, findAppExe, leftoverKeyFiles, NEGATIVE_CASES, parseRepeats, parseRunArguments, runRepeated, pickInstallers, servedFiles, testAppPaths } from './desktopUpdateTest.js'

/**
 * Tests of the parts of the Windows update test that need no Windows (Phase 31, task 31.7): which two installers a folder holds, where
 * the TEST app lives (and that it can never be the real one), and what the two traces must say after a good update. The driver that
 * installs and clicks is run on a Windows machine; these are the rules it applies.
 */

const name = (version: string) => `ListulatorUpdaterTest_${version}_x64-setup.exe`

describe('pickInstallers', () => {
  it('names the older installer to install and the newer one it is offered, whatever the order of the folder', () => {
    const picked = pickInstallers([name('1.0.0-rc.10'), 'latest.json', name('1.0.0-rc.9'), `${name('1.0.0-rc.10')}.sig`])

    expect(picked).toEqual({ from: { file: name('1.0.0-rc.9'), version: '1.0.0-rc.9' }, to: { file: name('1.0.0-rc.10'), version: '1.0.0-rc.10' } })
  })

  it.each([
    ['none', [] as string[]],
    ['one', [name('1.0.0-rc.1')]],
    ['three', [name('1.0.0-rc.1'), name('1.0.0-rc.2'), name('1.0.0-rc.3')]],
    ['two of the same version', [name('1.0.0-rc.1'), name('1.0.0-rc.1')]],
  ])('refuses a folder with %s test installers', (_label, files) => {
    expect(() => pickInstallers(files)).toThrow(/two test installers/)
  })

  it('does not take the real installer, or a name that only looks like one', () => {
    expect(() => pickInstallers(['Listulator_1.0.0_x64-setup.exe', name('1.0.0-rc.1')])).toThrow(/two test installers/)
    expect(() => pickInstallers([`..\\${name('1.0.0-rc.1')}`, name('1.0.0-rc.2')])).toThrow(/two test installers/)
  })
})

describe('testAppPaths', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }

  it('puts the app and its data under the test product and its own identifier', () => {
    expect(testAppPaths(env)).toEqual({
      installDir: 'C:\\Users\\tester\\AppData\\Local\\ListulatorUpdaterTest',
      dataDir: 'C:\\Users\\tester\\AppData\\Roaming\\com.listulator.desktop.updatertest',
      webviewDir: 'C:\\Users\\tester\\AppData\\Local\\com.listulator.desktop.updatertest',
    })
  })

  it('is the product name and identifier of the committed test config, and not the real ones', () => {
    const overlay = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/tauri.updater-test.conf.json', import.meta.url)), 'utf8')) as { productName: string; identifier: string }
    const real = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url)), 'utf8')) as { productName: string; identifier: string }
    const paths = testAppPaths(env)

    expect(paths.installDir.endsWith(`\\${overlay.productName}`)).toBe(true)
    expect(paths.dataDir.endsWith(`\\${overlay.identifier}`)).toBe(true)
    expect(paths.webviewDir.endsWith(`\\${overlay.identifier}`)).toBe(true)
    expect(overlay.productName).not.toBe(real.productName)
    expect(overlay.identifier).not.toBe(real.identifier)
  })

  it('refuses to run without the two folders it builds its paths from, rather than guess one', () => {
    expect(() => testAppPaths({ APPDATA: env.APPDATA })).toThrow(/LOCALAPPDATA/)
    expect(() => testAppPaths({ LOCALAPPDATA: env.LOCALAPPDATA })).toThrow(/APPDATA/)
  })
})

describe('checkInstallerTrace', () => {
  const start = 'hook=preinstall passive=1 update=1 hwnd=1234\r\ninstaller-process-start 1\r\n'
  const end = 'hook=postinstall passive=1 update=1\r\ninstaller-files-in-place 2\r\n'

  it('accepts the trace of a passive update that finished', () => {
    expect(checkInstallerTrace(start, end)).toEqual([])
  })

  it('says when the hook did not run, ran for a fresh install, or ran without the passive flag the updater passes', () => {
    expect(checkInstallerTrace(undefined, end)).toEqual([expect.stringMatching(/update-installer-trace\.txt.*missing/)])
    expect(checkInstallerTrace(start.replace('update=1', 'update=0'), end)).toEqual([expect.stringMatching(/hook=preinstall passive=1 update=1/)])
    expect(checkInstallerTrace(start.replace('passive=1', 'passive=0'), end)).toEqual([expect.stringMatching(/hook=preinstall passive=1 update=1/)])
  })

  it('says when the installer never got as far as putting the files in place', () => {
    expect(checkInstallerTrace(start, undefined)).toEqual([expect.stringMatching(/update-installer-trace-end\.txt.*missing/)])
  })
})

describe('checkUpdateTrace', () => {
  const entry = (step: string, index: number, over: { detail?: string; version?: string } = {}) => ({ t: index, step, ...over })
  const trace = (...entries: ReturnType<typeof entry>[]) => JSON.stringify({ entries })
  const update = { from: '1.0.0-rc.1', to: '1.0.0-rc.2' }
  const from = { version: update.from }
  const start = entry('new-app-start', 90, { version: update.to, detail: `from ${update.from}` })
  // What a Windows update leaves (BL-154, three controlled runs): the old app is ended during the download, so `download-finished` may or may not be there.
  const oldApp = (at: number) => [entry('pressed', at, from), entry('download-started', at + 1, from), entry('download-90%', at + 2, from)]
  const good = (...more: ReturnType<typeof entry>[]) => trace(...oldApp(0), start, ...more)

  it('accepts the trace of an update that went through: the new version marks its first start as coming from the old one', () => {
    expect(checkUpdateTrace(good(), update)).toEqual([])
  })

  it('fails on install-timed-out, wherever it sits', () => {
    expect(checkUpdateTrace(good(entry('install-timed-out', 3)), update)).toEqual([expect.stringMatching(/install-timed-out/)])
  })

  it('does not take the first start of a fresh install for an update: that start comes from "unknown"', () => {
    const fresh = trace(entry('new-app-start', 0, { version: update.from, detail: 'from unknown' }))

    expect(checkUpdateTrace(fresh, update)).toEqual([expect.stringMatching(/new-app-start from 1\.0\.0-rc\.1 to 1\.0\.0-rc\.2/)])
  })

  it('does not take a start of another version, or from another version', () => {
    expect(checkUpdateTrace(trace(entry('new-app-start', 0, { version: '9.9.9', detail: `from ${update.from}` })), update)).toHaveLength(1)
    expect(checkUpdateTrace(trace(entry('new-app-start', 0, { version: update.to, detail: 'from 0.0.1' })), update)).toHaveLength(1)
  })

  it('fails when the trace is missing or damaged', () => {
    expect(checkUpdateTrace(undefined, update)).toEqual([expect.stringMatching(/updateTrace/)])
    expect(checkUpdateTrace('{not json', update)).toEqual([expect.stringMatching(/updateTrace/)])
  })

  describe('the old app’s own marks of the update (BL-154)', () => {
    it('accepts a trace with download-finished too, and one without: the old app may be ended before it writes it', () => {
      expect(checkUpdateTrace(trace(...oldApp(0), entry('download-finished', 3, from), start), update)).toEqual([])
      expect(checkUpdateTrace(good(), update)).toEqual([])
    })

    it('accepts an update whose later marks were lost: the old app is ended right after the download and its last writes can lose that race', () => {
      // Run 40905902133 (a passing controlled update): the final press has `pressed` and nothing after it. Asking for more makes a good update fail.
      expect(checkUpdateTrace(trace(entry('pressed', 0, from), start), update)).toEqual([])
      expect(checkUpdateTrace(trace(entry('pressed', 0, from), entry('download-started', 1, from), start), update)).toEqual([])
    })

    it('fails when the old app never marked pressed before the new version started: that mark is written seconds before the end', () => {
      const marks = oldApp(0).filter((mark) => mark.step !== 'pressed')

      expect(checkUpdateTrace(trace(...marks, start), update)).toEqual([expect.stringContaining('pressed')])
      expect(checkUpdateTrace(trace(start), update)).toEqual([expect.stringContaining('pressed')])
    })

    it('does not take a press of another version, or one written after the new version started', () => {
      expect(checkUpdateTrace(trace(entry('pressed', 0, { version: '9.9.9' }), start), update)).toHaveLength(1)
      expect(checkUpdateTrace(trace(start, entry('pressed', 100, from)), update)).toHaveLength(1)
    })

    it('judges only the press when the new version never started: that is the one problem worth reading', () => {
      expect(checkUpdateTrace(trace(...oldApp(0)), update)).toEqual([expect.stringMatching(/new-app-start/)])
    })
  })
})

describe('describeUpdateTrace (BL-154: what a controlled update leaves, in the public CI log)', () => {
  // The shape a Windows update leaves: the old app is ended during the download, so there is a `download-90%` and never a `download-finished`.
  const windows = JSON.stringify({
    entries: [
      { t: 1_000_000, step: 'pressed', version: '1.0.0-rc.1', detail: '1.0.0-rc.2' },
      { t: 1_000_250, step: 'download-started', version: '1.0.0-rc.1', detail: '7268132' },
      { t: 1_001_900, step: 'download-90%', version: '1.0.0-rc.1' },
      { t: 1_009_400, step: 'new-app-start', version: '1.0.0-rc.2', detail: 'from 1.0.0-rc.1' },
      { t: 1_012_100, step: 'new-app-first-paint', version: '1.0.0-rc.2' },
    ],
  })

  it('lists each mark in order with its version and the milliseconds since the first and since the one before', () => {
    expect(describeUpdateTrace(windows)).toEqual([
      '+0 ms (+0) pressed 1.0.0-rc.1',
      '+250 ms (+250) download-started 1.0.0-rc.1',
      '+1900 ms (+1650) download-90% 1.0.0-rc.1',
      '+9400 ms (+7500) new-app-start 1.0.0-rc.2 from 1.0.0-rc.1',
      '+12100 ms (+2700) new-app-first-paint 1.0.0-rc.2',
    ])
  })

  it('says so, in one line, when the trace is missing, damaged or has no marks, and never throws', () => {
    expect(describeUpdateTrace(undefined)).toEqual(['updateTrace is missing or not readable'])
    expect(describeUpdateTrace('{not json')).toEqual(['updateTrace is missing or not readable'])
    expect(describeUpdateTrace('{"entries":"x"}')).toEqual(['updateTrace is missing or not readable'])
    expect(describeUpdateTrace('{"entries":[]}')).toEqual(['updateTrace has no marks'])
  })

  it('prints nothing but the step, the version, the time and new-app-start’s “from <version>”: the log is public', () => {
    const lines = describeUpdateTrace(
      JSON.stringify({
        entries: [
          { t: 5, step: 'pressed', version: '1.0.0', detail: 'C:\\Users\\Someone\\Secret list', title: 'My private list' },
          { t: 9, step: 'new-app-start', version: '1.0.0', detail: 'from C:\\Users\\Someone', path: 'D:\\x' },
        ],
      }),
    )

    expect(lines.join('\n')).not.toMatch(/Someone|Secret|private|D:/)
    expect(lines).toEqual(['+0 ms (+0) pressed 1.0.0', '+4 ms (+4) new-app-start 1.0.0'])
  })

  it('drops a mark whose step, version or time is not what the app writes, and keeps the others', () => {
    const lines = describeUpdateTrace(
      JSON.stringify({
        entries: [
          { t: 1, step: 'pressed', version: '1.0.0' },
          { t: 'soon', step: 'download-started', version: '1.0.0' },
          { t: 3, step: 'a long step with spaces and a <script>', version: '1.0.0' },
          { t: 4, step: 'download-90%', version: 'x'.repeat(80) },
          null,
          { t: 6, step: 'new-app-start', version: '1.0.1', detail: 'from 1.0.0' },
        ],
      }),
    )

    expect(lines).toEqual(['+0 ms (+0) pressed 1.0.0', '+3 ms (+3) download-90%', '+5 ms (+2) new-app-start 1.0.1 from 1.0.0'])
  })

  it('shows at most 40 marks', () => {
    const many = JSON.stringify({ entries: Array.from({ length: 60 }, (_, i) => ({ t: i, step: 'pressed', version: '1.0.0' })) })

    expect(describeUpdateTrace(many)).toHaveLength(40)
  })
})

describe('describeInstallerTrace', () => {
  it('keeps the plain lines the installer’s hooks write, without the empty ones', () => {
    const text = 'hook=preinstall passive=1 update=1 hwnd=0\r\ninstaller-process-start 1761662286517\r\n\r\nwindow-calls topmost=1 notopmost=1 setforeground=0 is-foreground=no\r\n'

    expect(describeInstallerTrace(text)).toEqual([
      'hook=preinstall passive=1 update=1 hwnd=0',
      'installer-process-start 1761662286517',
      'window-calls topmost=1 notopmost=1 setforeground=0 is-foreground=no',
    ])
  })

  it('says so when the file is missing, and drops a line with anything but plain words, numbers and = . _ -', () => {
    expect(describeInstallerTrace(undefined)).toEqual(['(missing)'])
    expect(describeInstallerTrace('ok 1\nC:\\Users\\Someone\\file\nfine=2')).toEqual(['ok 1', 'fine=2'])
  })

  it('shows at most 20 lines', () => {
    expect(describeInstallerTrace(Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'))).toHaveLength(20)
  })
})

describe('findAppExe', () => {
  it('is the one program in the install folder that is not the uninstaller, whatever the case', () => {
    expect(findAppExe(['uninstall.exe', 'listulator-desktop.exe', 'LICENSE', 'WebView2Loader.dll'])).toBe('listulator-desktop.exe')
    expect(findAppExe(['Uninstall.EXE', 'APP.EXE'])).toBe('APP.EXE')
  })

  it('says so when there is none or more than one, rather than start the wrong program', () => {
    expect(() => findAppExe(['uninstall.exe', 'LICENSE'])).toThrow(/one program/)
    expect(() => findAppExe(['a.exe', 'b.exe', 'uninstall.exe'])).toThrow(/one program/)
  })
})

describe('parseRunArguments', () => {
  it('takes the folder of the installers and, by default, nothing else', () => {
    expect(parseRunArguments(['C:\\out'])).toEqual({ dir: 'C:\\out', updateOnly: false })
  })

  it('takes --update-only (no negative cases) and --repeats <n>, in any place', () => {
    expect(parseRunArguments(['C:\\out', '--update-only'])).toEqual({ dir: 'C:\\out', updateOnly: true })
    expect(parseRunArguments(['--repeats', '7', 'C:\\out'])).toEqual({ dir: 'C:\\out', updateOnly: false, repeats: 7 })
    expect(parseRunArguments(['C:\\out', '--update-only', '--repeats', '20'])).toEqual({ dir: 'C:\\out', updateOnly: true, repeats: 20 })
  })

  it.each([['0'], ['21'], ['-1'], ['2.5'], ['ten'], ['1e1'], [' 3'], ['']])('refuses --repeats %j: a whole number from 1 to 20', (value) => {
    expect(parseRunArguments(['C:\\out', '--repeats', value])).toEqual(expect.stringMatching(/repeats/))
  })

  it('refuses --repeats without a value, and a value that is another option', () => {
    expect(parseRunArguments(['C:\\out', '--repeats'])).toEqual(expect.stringMatching(/repeats/))
    expect(parseRunArguments(['C:\\out', '--repeats', '--update-only'])).toEqual(expect.stringMatching(/repeats/))
  })

  it.each([
    ['no folder', [] as string[], /folder/],
    ['two folders', ['a', 'b'], /one folder/],
    ['an option it does not know', ['a', '--cut-after', '5'], /unknown option/],
  ])('says what is wrong with %s', (_label, args, message) => {
    expect(parseRunArguments(args)).toEqual(expect.stringMatching(message))
  })
})

describe('parseRepeats (the number the workflow leaves in the folder)', () => {
  it('is one when there is no file, and the number in it otherwise, spaces and a final line break allowed', () => {
    expect(parseRepeats(undefined)).toBe(1)
    expect(parseRepeats('1')).toBe(1)
    expect(parseRepeats('10\r\n')).toBe(10)
    expect(parseRepeats('  20 ')).toBe(20)
  })

  it.each([[''], ['0'], ['21'], ['3 4'], ['3\n4'], ['abc'], ['1; exit 0'], ['١٢'], ['-5']])('refuses %j with a sentence, never a number', (text) => {
    expect(parseRepeats(text)).toEqual(expect.stringMatching(/1 to 20/))
  })
})

describe('runRepeated (many updates for one build, BL-116)', () => {
  const lines = () => {
    const out: string[] = []
    return { out, log: (line: string) => out.push(line) }
  }

  it('runs every update after the one before, whatever happens to it, and is good only when all passed', async () => {
    const { out, log } = lines()
    const asked: number[] = []
    const outcomes = ['passed', 'hung', 'failed', 'passed'] as const

    const code = await runRepeated(4, async (n) => (asked.push(n), outcomes[n - 1]!), log)

    expect(asked).toEqual([1, 2, 3, 4])
    expect(code).toBe(1)
    expect(out).toEqual([
      'UPDATE 1 of 4: passed',
      'UPDATE 2 of 4: HUNG',
      'UPDATE 3 of 4: FAILED',
      'UPDATE 4 of 4: passed',
      'UPDATES: 2 passed, 1 hung, 1 failed, 0 not started, of 4',
    ])
  })

  it('returns 0 when every update passed', async () => {
    const { out, log } = lines()

    expect(await runRepeated(3, async () => 'passed', log)).toBe(0)
    expect(out.at(-1)).toBe('UPDATES: 3 passed, 0 hung, 0 failed, 0 not started, of 3')
  })

  it('stops starting updates when the time budget is used, and says which were not started', async () => {
    const { out, log } = lines()
    let clock = 0
    const asked: number[] = []

    const code = await runRepeated(5, async (n) => (asked.push(n), (clock += 20 * 60_000), 'passed'), log, () => clock, 45 * 60_000)

    expect(asked).toEqual([1, 2, 3])
    expect(code).toBe(1)
    expect(out.slice(-3)).toEqual(['UPDATE 4 of 5: not started (the time budget is used)', 'UPDATE 5 of 5: not started (the time budget is used)', 'UPDATES: 3 passed, 0 hung, 0 failed, 2 not started, of 5'])
  })

  it('counts an update whose run threw as failed and goes on', async () => {
    const { out, log } = lines()

    const code = await runRepeated(2, async (n) => (n === 1 ? Promise.reject(new Error('boom')) : 'passed'), log)

    expect(code).toBe(1)
    expect(out.slice(0, 3)).toEqual([expect.stringContaining('boom'), 'UPDATE 1 of 2: FAILED', 'UPDATE 2 of 2: passed'])
  })
})

describe('servedFiles', () => {
  it('is the manifest, the update and its signature, and nothing else in the folder: not the installer that is only run, not a stranger', () => {
    const picked = pickInstallers([name('1.0.0-rc.1'), name('1.0.0-rc.2'), 'latest.json', 'passwords.txt'])

    expect(servedFiles(picked)).toEqual(['latest.json', name('1.0.0-rc.2'), `${name('1.0.0-rc.2')}.sig`])
  })
})

describe('leftoverKeyFiles', () => {
  it("finds the run's key and its public half in a temp folder, and nothing that only looks near them", () => {
    expect(leftoverKeyFiles(['updater-test-run.key', 'updater-test-run.key.pub', 'updater-test-run.conf.json', 'other.key', 'notes.txt'])).toEqual(['updater-test-run.key', 'updater-test-run.key.pub'])
    expect(leftoverKeyFiles([])).toEqual([])
  })
})

describe('NEGATIVE_CASES', () => {
  it('are the seven cases of the manual test that a Windows machine can run, in the order the manual test runs them, and the one that it cannot', () => {
    expect(NEGATIVE_CASES.map((entry) => entry.name)).toEqual(['same-version', 'lower-version', 'other-os-windows', 'wrong-version', 'tampered', 'wrong-key', 'cut-download', 'other-os-mac'])
  })

  it('each serves a folder the kit makes, and the interrupted download is the good update cut after 100000 bytes', () => {
    const folders = buildWindowsKitScenarios({ exe: { name: name('1.0.0-rc.2'), bytes: Buffer.from('x'.repeat(50)), signature: signed() }, installed: '1.0.0-rc.1', pubDate: '2026-10-20T08:30:00Z' }).map((entry) => entry.name)

    for (const entry of NEGATIVE_CASES.filter((candidate) => candidate.notApplicable === undefined)) expect(folders, entry.name).toContain(entry.scenario)
    expect(NEGATIVE_CASES.find((entry) => entry.name === 'cut-download')).toMatchObject({ scenario: 'ok', cutAfter: 100000 })
    expect(NEGATIVE_CASES.filter((entry) => entry.cutAfter !== undefined)).toHaveLength(1)
  })

  it('says why the macOS case is not run here, and has no folder to serve for it', () => {
    const mac = NEGATIVE_CASES.find((entry) => entry.name === 'other-os-mac')!

    expect(mac.scenario).toBeUndefined()
    expect(mac.notApplicable).toMatch(/Windows/)
  })
})

function signLikeTauriFor(key: TestKeyPair, file: string, version: string, bytes = Buffer.from('x'.repeat(50))): string {
  return signLikeTauri(key.privateKey, key.keyIdBytes, bytes, `timestamp:1791734534\tfile:${file}\tversion:${version}`)
}

/** A signature for the installer of rc.2 that parses (the kit reads the file and version out of it). */
function signed(): string {
  return signLikeTauriFor(makeKeyPair('0123456789ABCDEF'), name('1.0.0-rc.2'), '1.0.0-rc.2')
}

describe('compareInstall', () => {
  const before = { 'app.exe': { size: 10, mtimeMs: 1 }, 'res/a.txt': { size: 3, mtimeMs: 2 } }

  it('finds nothing when nothing changed', () => {
    expect(compareInstall(before, { ...before })).toEqual([])
  })

  it('names what was added, removed or changed', () => {
    const after = { 'app.exe': { size: 11, mtimeMs: 1 }, 'new.dll': { size: 1, mtimeMs: 5 } }

    expect(compareInstall(before, after).sort()).toEqual(['app.exe changed', 'new.dll added', 'res/a.txt removed'])
  })

  it('counts a changed time as a change, though not a changed size', () => {
    expect(compareInstall(before, { ...before, 'app.exe': { size: 10, mtimeMs: 99 } })).toEqual(['app.exe changed'])
  })
})

describe('embeddedPubkeys', () => {
  const key = makeKeyPair('0123456789ABCDEF').pubkey
  const other = makeKeyPair('FEDCBA9876543210').pubkey

  it("finds the public key a program carries as text, once however often it is there, and nothing else", () => {
    const program = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(`{"pubkey":"${key}"}`), Buffer.from([0, 0]), Buffer.from(key)])

    expect(embeddedPubkeys(program)).toEqual([key])
  })

  it('finds two different keys as two, so a caller can refuse to guess', () => {
    expect(embeddedPubkeys(Buffer.from(`${key} ${other}`)).sort()).toEqual([key, other].sort())
  })

  it('does not take the start of a key, or text that only begins like one', () => {
    expect(embeddedPubkeys(Buffer.from(key.slice(0, 60)))).toEqual([])
    expect(embeddedPubkeys(Buffer.from('dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).toEqual([])
    expect(embeddedPubkeys(Buffer.alloc(0))).toEqual([])
  })
})
