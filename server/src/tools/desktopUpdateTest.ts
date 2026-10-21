import { win32 } from 'node:path'
import { compareVersions, keyIdOfPublicKey } from './updateManifest.js'

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

/**
 * What is wrong with the app's `updateTrace` (the JSON the update trace keeps in preferences.json) after the update from `update.from` to
 * `update.to`; empty when it is right. The new version marks its first start as `new-app-start` coming `from <the old version>`: a fresh
 * install marks its first start too (from "unknown"), so only that exact mark says the update happened.
 */
export function checkUpdateTrace(raw: string | undefined, update: { from: string; to: string }): string[] {
  let entries: { step?: unknown; version?: unknown; detail?: unknown }[]
  try {
    const parsed = JSON.parse(raw ?? '') as { entries?: typeof entries }
    if (!Array.isArray(parsed.entries)) throw new Error('no entries')
    entries = parsed.entries
  } catch {
    return ['updateTrace is missing or not readable in preferences.json']
  }

  const problems: string[] = []
  if (entries.some((entry) => entry.step === 'install-timed-out')) problems.push('updateTrace has install-timed-out: the app gave up waiting for the installer')
  if (!entries.some((entry) => entry.step === 'new-app-start' && entry.version === update.to && entry.detail === `from ${update.from}`)) {
    problems.push(`updateTrace has no new-app-start from ${update.from} to ${update.to}: the new version never marked its first start after the update`)
  }

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

/** The files the update server needs, by name: the manifest, the newer installer and its signature. The older installer is only run, and nothing else in the folder is served. */
export function servedFiles(installers: { to: Installer }): string[] {
  return ['latest.json', installers.to.file, `${installers.to.file}.sig`]
}

/** What is left of the workflow's throw-away key in a temp folder (the key and its public half). The test runs after the key is deleted; if it is not, the test does not run. */
export function leftoverKeyFiles(names: string[]): string[] {
  return names.filter((file) => /^updater-test-run\.key(\.pub)?$/.test(file))
}

export interface NegativeCase {
  name: string
  /** The folder of the kit to serve (`buildWindowsKitScenarios`); none for a case this machine cannot run. */
  scenario?: string
  /** The server drops the download after this many bytes (`updater:serve --cut-after`). */
  cutAfter?: number
  /** Why the case is not run here. */
  notApplicable?: string
}

/** The negative cases of the manual test (docs/updater-test.md, Part 3), in its order. Each is run against the installed older app and must leave it as it was. */
export const NEGATIVE_CASES: readonly NegativeCase[] = [
  { name: 'same-version', scenario: 'same-version' },
  { name: 'lower-version', scenario: 'lower-version' },
  { name: 'other-os-windows', scenario: 'other-os-windows' },
  { name: 'wrong-version', scenario: 'wrong-version' },
  { name: 'tampered', scenario: 'tampered' },
  { name: 'wrong-key', scenario: 'wrong-key' },
  { name: 'cut-download', scenario: 'ok', cutAfter: 100000 },
  { name: 'other-os-mac', notApplicable: 'the manifest with a macOS entry only is a macOS case: this is Windows (the owner runs it on the Mac)' },
]

export interface FileState {
  size: number
  mtimeMs: number
}

/** What differs between two listings of the install folder (path to size and time); empty when the app is as it was. */
export function compareInstall(before: Record<string, FileState>, after: Record<string, FileState>): string[] {
  const differences: string[] = []
  for (const [path, state] of Object.entries(before)) {
    const now = after[path]
    if (now === undefined) differences.push(`${path} removed`)
    else if (now.size !== state.size || now.mtimeMs !== state.mtimeMs) differences.push(`${path} changed`)
  }
  for (const path of Object.keys(after)) if (before[path] === undefined) differences.push(`${path} added`)

  return differences
}

/** The minisign public keys a program carries as text (the updater plugin's key sits in the app's embedded config), each once. A caller that finds several does not guess. */
export function embeddedPubkeys(program: Buffer): string[] {
  const found = new Set<string>()
  for (const match of program.toString('latin1').matchAll(/dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6[A-Za-z0-9+/]+={0,2}/g)) {
    if (keyIdOfPublicKey(match[0]) !== undefined) found.add(match[0])
  }

  return [...found]
}
