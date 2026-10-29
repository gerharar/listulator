import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'
import { hangDumpScript } from '../../server/src/tools/hangDump.js'

/**
 * Reaching the installed test app from a spec (Phase 31, tasks 31.7 and 31.8): through WebView2's debugging port, which the test build's
 * window opens and no other build does. The runner (`npm run test:desktop-update`) has installed and started the app and gives the specs
 * what they need through the environment.
 */
export const PORT = 9222
export const APP_EXE = process.env['DESKTOP_APP_EXE'] ?? ''
export const INSTALL_DIR = process.env['DESKTOP_INSTALL_DIR'] ?? ''
export const FROM = process.env['DESKTOP_FROM'] ?? ''
export const TO = process.env['DESKTOP_TO'] ?? ''
export const TITLE = 'Update Test List'
export const ITEMS = ['Eins', 'Zwei', 'Drei'] as const

export interface Attached {
  browser: Browser
  page: Page
}

/** The app's window, once its debugging port answers; null if nothing answers within the time. Each call connects afresh. */
export async function connect(waitMs: number): Promise<Attached | null> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    try {
      const answer = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (answer.ok) {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
        const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => !candidate.url().startsWith('devtools:'))
        if (page !== undefined) {
          await page.waitForLoadState('domcontentloaded')

          return { browser, page }
        }
        await browser.close()
      }
    } catch {
      // not up yet, or going down
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return null
}

export async function attach(waitMs = 90_000): Promise<Attached> {
  const found = await connect(waitMs)
  if (found === null) throw new Error(`the app's debugging port ${PORT} did not answer within ${waitMs / 1000} s`)

  return found
}

/** The page of a NEW app process: the old page carries the marker the test put in it, a new one cannot. */
export async function attachToNewApp(waitMs: number): Promise<Attached> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const found = await connect(2_000)
    if (found !== null) {
      const old = await found.page.evaluate(() => (window as unknown as { __oldApp?: boolean }).__oldApp === true).catch(() => true)
      if (!old) return found
      await found.browser.close().catch(() => undefined)
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`no new app came up within ${waitMs / 1000} s`)
}

/** Ends the programs that run from the TEST app's install folder, by their path: a real Listulator may share the file name. (`desktopUpdateTestRun.ts` has the same two lines.) */
export function stopApp(): void {
  const script = "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:DESKTOP_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') } | Stop-Process -Force"
  const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, DESKTOP_INSTALL_DIR: INSTALL_DIR } })
}

export async function portIsClosed(): Promise<boolean> {
  return fetch(`http://127.0.0.1:${PORT}/json/version`).then(
    () => false,
    () => true,
  )
}

/**
 * What the machine looks like when the new app did not come up: the programs of the test app, any installer and WebView2, and what the
 * updater left in the temp folder. Printed only on a failure, to read in the log (paths and times, nothing secret).
 */
export function describeMachine(): string {
  const script = [
    "Get-Process | Where-Object { $_.Path -and ($_.Path.StartsWith($env:DESKTOP_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') -or $_.Name -match 'setup|ListulatorUpdaterTest|msedgewebview2') } | Select-Object Id, Name, @{n='Start';e={$_.StartTime.ToString('HH:mm:ss')}}, Path | Format-Table -AutoSize | Out-String -Width 300",
    "Get-ChildItem $env:TEMP -Recurse -Depth 2 -Filter '*Listulator*' -ErrorAction SilentlyContinue | Select-Object FullName, Length, @{n='Written';e={$_.LastWriteTime.ToString('HH:mm:ss')}} | Format-Table -AutoSize | Out-String -Width 300",
  ].join('; ')
  const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const done = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, DESKTOP_INSTALL_DIR: INSTALL_DIR } })

  return `${done.stdout}${done.stderr}`.trim() + '\n\n' + describeHang(powershell)
}

/**
 * What Windows knows about the stuck machine (BL-116, Phase 41.2): the app's threads, windows, new programs, recent events and, where the
 * image has `cdb.exe`, the app's stacks. `server/src/tools/hangDump.ts` is the read-only script (`hangDump.guard.test.ts` pins that). It goes in
 * encoded so no quoting of the Windows command line can change it, and it is cut off after 150 s so a debugger that does not return cannot hold the run.
 */
function describeHang(powershell: string): string {
  const encoded = Buffer.from(hangDumpScript(), 'utf16le').toString('base64')
  const done = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: 150_000,
    env: { ...process.env, DESKTOP_INSTALL_DIR: INSTALL_DIR },
  })
  const cutOff = done.error === undefined ? '' : `\n(the dump was cut off: ${done.error.message.slice(0, 120)})`

  return `HANG DUMP\n${done.stdout ?? ''}${done.stderr ?? ''}`.trim() + cutOff
}
