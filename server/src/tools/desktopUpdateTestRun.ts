import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInstallerTrace, checkUpdateTrace, compareInstall, embeddedPubkeys, findAppExe, leftoverKeyFiles, NEGATIVE_CASES, parseRunArguments, pickInstallers, servedFiles, testAppPaths, type FileState } from './desktopUpdateTest.js'
import { isRunDirectly } from './runDirectly.js'
import { DEFAULT_PORT, startUpdaterServer } from './updaterServe.js'
import { buildWindowsKitScenarios } from './updaterTestKit.js'

/**
 * `npm run test:desktop-update -- <folder>` (Phase 31, task 31.7; docs/DECISIONS.md "Phase 31"): the Windows update test, positive path,
 * as one command that does the same on a GitHub runner and on a Windows machine. The folder is the unzipped artifact of the workflow
 * "Updater test (Windows)": the two test installers, the newer one's `.sig`, and `latest.json`.
 *
 * It installs the older test app silently, starts it (the test build opens WebView2's debugging port), serves the folder on
 * 127.0.0.1:8099, runs `web/e2e-desktop/update.spec.ts` against the app, then reads the two traces the update leaves, and always stops
 * the app, uninstalls it and removes its data. It only ever touches the TEST product (its own folder and identifier, `testAppPaths`),
 * and refuses to start if any of that is already on the machine: a leftover is never reused and a real Listulator is never in its way.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The port the test build's window opens (tauri.updater-test.conf.json; the guard pins it). */
const DEBUG_PORT = 9222

export interface RunDeps {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  log: (line: string) => void
  /** Whether something answers on that loopback port; the real check by default. */
  portAnswers?: (port: number) => Promise<boolean>
}

const somethingAnswers = (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  )

/**
 * Ends the programs that run from the TEST app's install folder, found by their path and by nothing else: a real Listulator may have the
 * same file name, so `taskkill /IM` would be wrong. The folder goes in through the environment, never into the script's text.
 * `web/e2e-desktop/update.spec.ts` carries the same two lines.
 */
function stopTestApp(installDir: string): void {
  const script = "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:DESKTOP_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') } | Stop-Process -Force"
  const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, DESKTOP_INSTALL_DIR: installDir } })
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The app's `updateTrace`, which the update trace keeps as a JSON string in preferences.json (a plain `{ key: value }` file). */
function updateTraceOf(preferencesText: string | undefined): string | undefined {
  try {
    const value = (JSON.parse(preferencesText ?? '') as Record<string, unknown>)['updateTrace']

    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** Every file under a folder with its size and time, by relative path: what `compareInstall` judges. */
function snapshotInstall(dir: string): Record<string, FileState> {
  const state: Record<string, FileState> = {}
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`)
      else {
        const { size, mtimeMs } = statSync(path)
        state[`${prefix}${entry.name}`] = { size, mtimeMs }
      }
    }
  }
  walk(dir, '')

  return state
}

export async function run(args: readonly string[], deps: RunDeps): Promise<number> {
  const { log } = deps
  if (deps.platform !== 'win32') {
    log('The update test installs a Windows app: run it on Windows (or let the workflow "Updater test (Windows)" do it).')

    return 1
  }
  const parsed = parseRunArguments(args)
  if (typeof parsed === 'string') {
    log(`${parsed}\nUsage: npm run test:desktop-update -- <folder>`)

    return 1
  }
  // The test runs after the workflow has deleted its key. If the key is still there, something is wrong with the order: do not run.
  const runnerTemp = deps.env['RUNNER_TEMP']
  if (runnerTemp !== undefined && runnerTemp !== '') {
    let names: string[] = []
    try {
      names = readdirSync(runnerTemp)
    } catch {
      // no such folder: no key in it
    }
    if (leftoverKeyFiles(names).length > 0) {
      log("The run's throw-away key is still there (in RUNNER_TEMP). The update test runs only after the key is deleted: stopping.")

      return 1
    }
  }
  if (await (deps.portAnswers ?? somethingAnswers)(DEBUG_PORT)) {
    log(`Something already answers on 127.0.0.1:${DEBUG_PORT}, the app's debugging port. Close it first: the test would drive the wrong program.`)

    return 1
  }
  const dir = resolve(parsed.dir)
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    log(`${dir} is not a folder`)

    return 1
  }
  const installers = pickInstallers(files)
  for (const needed of ['latest.json', `${installers.to.file}.sig`]) {
    if (!files.includes(needed)) {
      log(`${dir} has no ${needed}`)

      return 1
    }
  }
  const paths = testAppPaths(deps.env)
  const there = [paths.installDir, paths.dataDir, paths.webviewDir].filter((path) => existsSync(path))
  if (there.length > 0) {
    log(`The test app is already on this machine (${there.join(', ')}). Uninstall "ListulatorUpdaterTest" and delete those folders first: this test never reuses or removes what it did not make.`)

    return 1
  }

  // Only what the update needs is served, from a folder made for the purpose: the folder given may hold anything else.
  const served = mkdtempSync(join(tmpdir(), 'listulator-update-test-'))
  for (const file of servedFiles(installers)) copyFileSync(join(dir, file), join(served, file))
  const cases = mkdtempSync(join(tmpdir(), 'listulator-update-cases-'))
  const serverLines: string[] = []
  const serverLog = (line: string): void => {
    serverLines.push(line)
    log(line)
  }
  let server: Server | undefined
  const serve = async (folder: string, cutAfter?: number): Promise<void> => {
    server = await startUpdaterServer({ dir: folder, ...(cutAfter === undefined ? {} : { cutAfter }), log: serverLog }, DEFAULT_PORT)
  }
  const stopServing = async (): Promise<void> => {
    const stopping = server
    server = undefined
    if (stopping === undefined) return
    stopping.closeAllConnections()
    await new Promise((done) => stopping.close(done))
  }
  const failures: string[] = []
  let cleaned = false
  // Stops the app first (the debugging port goes with it), then the server, then the install. Runs once, whether the test ended or was interrupted.
  const stopEverything = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    stopTestApp(paths.installDir)
    await stopServing()
    await wait(2_000)
    const uninstaller = join(paths.installDir, 'uninstall.exe')
    if (existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { stdio: 'ignore' })
  }
  const interrupted = (): void => {
    void stopEverything().then(() => process.exit(130))
  }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  try {
    log(`Installing ${installers.from.file} …`)
    const installed = spawnSync(join(dir, installers.from.file), ['/S'], { stdio: 'inherit' })
    if (installed.status !== 0) throw new Error(`the installer ended with ${String(installed.status)}`)
    const exe = join(paths.installDir, findAppExe(readdirSync(paths.installDir)))
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()

    log(`Update test: ${installers.from.version} -> ${installers.to.version}`)
    const playwright = createRequire(import.meta.url).resolve('@playwright/test/cli')
    const specEnv = { ...deps.env, DESKTOP_APP_EXE: exe, DESKTOP_INSTALL_DIR: paths.installDir, DESKTOP_FROM: installers.from.version, DESKTOP_TO: installers.to.version }
    // Awaited, not spawnSync: this process also serves the update, and a blocked event loop would never answer the app's check.
    const runSpec = (file: string, extra: Record<string, string> = {}): Promise<number> =>
      new Promise<number>((done) => {
        const child = spawn(process.execPath, [playwright, 'test', '-c', 'playwright.desktop.config.ts', file], { cwd: join(REPO_ROOT, 'web'), stdio: 'inherit', env: { ...specEnv, ...extra } })
        child.once('error', () => done(1))
        child.once('exit', (code) => done(code ?? 1))
      })

    if ((await runSpec('prepare.spec.ts')) !== 0) {
      failures.push('prepare: the app could not be given its list and language')
    } else {
      // The negative cases (31.8) run against the installed OLDER app, one folder each, before the real update changes it.
      const key = embeddedPubkeys(readFileSync(exe))
      const realKey = (JSON.parse(readFileSync(join(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string } } }).plugins.updater.pubkey
      const pubkey = key.length === 1 && key[0] !== realKey ? key[0] : undefined
      log(pubkey === undefined ? `The app's public key could not be read from its program (${key.length} found): the installer's signature is not checked first.` : "The installer's signature is checked against the key the app carries.")
      const scenarios = buildWindowsKitScenarios({
        exe: { name: installers.to.file, bytes: readFileSync(join(dir, installers.to.file)), signature: readFileSync(join(dir, `${installers.to.file}.sig`), 'utf8') },
        installed: installers.from.version,
        ...(pubkey === undefined ? {} : { pubkey }),
        pubDate: `${new Date().toISOString().slice(0, 19)}Z`,
      })
      const before = snapshotInstall(paths.installDir)
      for (const entry of NEGATIVE_CASES) {
        if (entry.notApplicable !== undefined || entry.scenario === undefined) {
          log(`NOT RUN ${entry.name}: ${entry.notApplicable ?? 'no folder'}`)
          continue
        }
        const scenario = scenarios.find((candidate) => candidate.name === entry.scenario)
        if (scenario === undefined) {
          failures.push(`${entry.name}: the kit has no folder ${entry.scenario}`)
          continue
        }
        const caseDir = join(cases, entry.name)
        mkdirSync(caseDir)
        for (const [file, content] of Object.entries(scenario.files)) writeFileSync(join(caseDir, file), content)
        serverLines.length = 0
        await serve(caseDir, entry.cutAfter)
        log(`--- negative case ${entry.name}`)
        const code = await runSpec('negative.spec.ts', { DESKTOP_CASE: entry.name })
        await stopServing()
        if (code !== 0) failures.push(`${entry.name}: the app did not say what the manual test expects`)
        if (entry.cutAfter !== undefined && !serverLines.some((line) => line.includes(`cut after ${entry.cutAfter} bytes`))) failures.push(`${entry.name}: the server never cut a download`)
      }
      for (const difference of compareInstall(before, snapshotInstall(paths.installDir))) failures.push(`the installed app changed during the negative cases: ${difference}`)

      // The real update, last: it changes the installed version.
      await serve(served)
      if ((await runSpec('update.spec.ts')) !== 0) failures.push('update: the app did not take the offered update')
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  } finally {
    await stopEverything()
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
    rmSync(served, { recursive: true, force: true })
    rmSync(cases, { recursive: true, force: true })
  }
  for (const failure of failures) log(`FAILED: ${failure}`)

  // The traces are read before the data is removed, and judged even when the spec failed: they say why.
  const problems = [
    ...checkInstallerTrace(read(join(paths.dataDir, 'update-installer-trace.txt')), read(join(paths.dataDir, 'update-installer-trace-end.txt'))),
    ...checkUpdateTrace(updateTraceOf(read(join(paths.dataDir, 'preferences.json')))),
  ]
  for (const problem of problems) log(`TRACE: ${problem}`)

  // The uninstaller copies itself and returns at once: give it a moment, then take away what is left of the TEST product.
  for (let tries = 0; tries < 30 && existsSync(join(paths.installDir, 'uninstall.exe')); tries++) await wait(1_000)
  for (const path of [paths.installDir, paths.dataDir, paths.webviewDir]) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })

  const ok = failures.length === 0 && problems.length === 0
  log(ok ? 'The update test passed.' : 'The update test FAILED.')

  return ok ? 0 : 1
}

if (isRunDirectly(import.meta.url)) {
  run(process.argv.slice(2), { platform: process.platform, env: process.env, log: (line) => console.log(line) }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    },
  )
}
