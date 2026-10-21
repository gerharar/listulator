import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri, type TestKeyPair } from './minisignTesting.js'
import { buildWindowsKitScenarios } from './updaterTestKit.js'
import { checkInstallerTrace, checkUpdateTrace, compareInstall, embeddedPubkeys, findAppExe, leftoverKeyFiles, NEGATIVE_CASES, parseRunArguments, pickInstallers, servedFiles, testAppPaths } from './desktopUpdateTest.js'

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
  const good = (...more: ReturnType<typeof entry>[]) =>
    trace(entry('pressed', 0, { version: update.from }), entry('download-finished', 1, { version: update.from }), entry('new-app-start', 2, { version: update.to, detail: `from ${update.from}` }), ...more)

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
  it('takes the folder of the installers and nothing else', () => {
    expect(parseRunArguments(['C:\\out'])).toEqual({ dir: 'C:\\out' })
  })

  it.each([
    ['no folder', [] as string[], /folder/],
    ['two folders', ['a', 'b'], /one folder/],
    ['an option it does not know', ['a', '--cut-after', '5'], /unknown option/],
  ])('says what is wrong with %s', (_label, args, message) => {
    expect(parseRunArguments(args)).toEqual(expect.stringMatching(message))
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
