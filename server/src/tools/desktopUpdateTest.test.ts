import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkInstallerTrace, checkUpdateTrace, findAppExe, parseRunArguments, pickInstallers, testAppPaths } from './desktopUpdateTest.js'

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
  const trace = (...steps: string[]) => JSON.stringify({ entries: steps.map((step, index) => ({ t: index, step })) })

  it('accepts the trace of an update that went through', () => {
    expect(checkUpdateTrace(trace('pressed', 'download-started', 'download-finished', 'new-app-start'))).toEqual([])
  })

  it('fails on install-timed-out, wherever it sits', () => {
    expect(checkUpdateTrace(trace('pressed', 'install-timed-out', 'new-app-start'))).toEqual([expect.stringMatching(/install-timed-out/)])
  })

  it('fails when the new app never marked its start, or the trace is missing or damaged', () => {
    expect(checkUpdateTrace(trace('pressed', 'download-finished'))).toEqual([expect.stringMatching(/new-app-start/)])
    expect(checkUpdateTrace(undefined)).toEqual([expect.stringMatching(/updateTrace/)])
    expect(checkUpdateTrace('{not json')).toEqual([expect.stringMatching(/updateTrace/)])
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
