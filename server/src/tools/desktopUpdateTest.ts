import { win32 } from 'node:path'
import { compareVersions } from './updateManifest.js'

/**
 * The rules of the Windows update test (Phase 31, task 31.7; docs/DECISIONS.md "Phase 31"), apart from the driver that installs the
 * app and clicks in it. Nothing here touches the machine: the driver hands in file names, environment and the text of two traces, so
 * the rules can be tested on any system and applied on a Windows one.
 */

/** The test product of `tauri.updater-test.conf.json`: its own name and identifier, so it never meets a real Listulator install. */
const PRODUCT_NAME = 'ListulatorUpdaterTest'
const IDENTIFIER = 'com.listulator.desktop.updatertest'

const INSTALLER = new RegExp(`^${PRODUCT_NAME}_(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)_x64-setup\\.exe$`)

export interface Installer {
  file: string
  version: string
}

/** The two test installers in a folder's file names: the older one to install and the newer one it is offered. Anything else is left out. */
export function pickInstallers(files: string[]): { from: Installer; to: Installer } {
  const found = files.flatMap((file) => {
    const version = INSTALLER.exec(file)?.[1]

    return version === undefined ? [] : [{ file, version }]
  })
  const [older, newer] = found.sort((a, b) => compareVersions(a.version, b.version))
  if (found.length !== 2 || older === undefined || newer === undefined || compareVersions(older.version, newer.version) === 0) {
    throw new Error(`The folder must hold exactly two test installers of different versions (${PRODUCT_NAME}_<version>_x64-setup.exe), not ${found.length}`)
  }

  return { from: older, to: newer }
}

/** Where the test app, its data and its WebView2 profile live. All come from the test product, never the real one; without the folders they are built from, it stops. */
export function testAppPaths(env: Record<string, string | undefined>): { installDir: string; dataDir: string; webviewDir: string } {
  const local = env['LOCALAPPDATA']
  const roaming = env['APPDATA']
  if (!local) throw new Error('LOCALAPPDATA is not set: this test runs on Windows')
  if (!roaming) throw new Error('APPDATA is not set: this test runs on Windows')

  return { installDir: win32.join(local, PRODUCT_NAME), dataDir: win32.join(roaming, IDENTIFIER), webviewDir: win32.join(local, IDENTIFIER) }
}

/** What is wrong with the two files the installer's hooks write; empty when the installer ran as the updater runs it and finished. */
export function checkInstallerTrace(start: string | undefined, end: string | undefined): string[] {
  const problems: string[] = []
  if (start === undefined) problems.push('update-installer-trace.txt is missing: the installer hook did not run, or the data folder was not there')
  else if (!start.includes('hook=preinstall passive=1 update=1')) problems.push('update-installer-trace.txt does not say hook=preinstall passive=1 update=1: the installer was not run as an update')
  if (end === undefined) problems.push('update-installer-trace-end.txt is missing: the installer never put the files in place')

  return problems
}

/** What is wrong with the app's `updateTrace` (the JSON the update trace keeps in preferences.json) after an update; empty when it is right. */
export function checkUpdateTrace(raw: string | undefined): string[] {
  let steps: string[]
  try {
    const parsed = JSON.parse(raw ?? '') as { entries?: { step?: unknown }[] }
    if (!Array.isArray(parsed.entries)) throw new Error('no entries')
    steps = parsed.entries.map((entry) => String(entry.step))
  } catch {
    return ['updateTrace is missing or not readable in preferences.json']
  }

  const problems: string[] = []
  if (steps.includes('install-timed-out')) problems.push('updateTrace has install-timed-out: the app gave up waiting for the installer')
  if (!steps.includes('new-app-start')) problems.push('updateTrace has no new-app-start: the new version never marked its first start')

  return problems
}

/** The app's program among the files of its install folder: the one `.exe` that is not the uninstaller. */
export function findAppExe(files: string[]): string {
  const programs = files.filter((file) => /\.exe$/i.test(file) && !/^uninstall/i.test(file))
  if (programs.length !== 1) throw new Error(`The install folder must hold exactly one program besides the uninstaller, not ${programs.length}`)

  return programs[0]!
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseRunArguments(args: readonly string[]): { dir: string } | string {
  let dir: string | undefined
  for (const arg of args) {
    if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg).slice(0, 30)}`
    if (dir !== undefined) return 'only one folder can be given'
    dir = arg
  }

  return dir === undefined ? 'name the folder that holds the two test installers, latest.json and the update\'s .sig' : { dir }
}
