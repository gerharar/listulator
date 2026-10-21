import { spawn, spawnSync } from 'node:child_process'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { chooseGerman, closeAbout, createFirstList, openAbout, t } from './steps.js'

/**
 * The Windows update test, positive path (Phase 31, task 31.7; docs/DECISIONS.md "Phase 31"): the installed test app is offered the next
 * version by `updater:serve`, takes it the way a person does (About, Download Update), comes back by itself as the new version, and has
 * lost nothing. It is started by `npm run test:desktop-update`, which has installed the older app, started it with the debugging port
 * (the test build's window config opens it), and is serving the newer one. It reads the two traces and uninstalls afterwards.
 *
 * Not asserted: how long the window is gone, and whether the installer comes to the front. A runner has no user; those stay the owner's
 * rounds on a real desktop.
 */
const PORT = 9222
const APP_EXE = process.env['DESKTOP_APP_EXE'] ?? ''
const INSTALL_DIR = process.env['DESKTOP_INSTALL_DIR'] ?? ''
const FROM = process.env['DESKTOP_FROM'] ?? ''
const TO = process.env['DESKTOP_TO'] ?? ''
const TITLE = 'Update Test List'
const ITEMS = ['Eins', 'Zwei', 'Drei'] as const

/** The app's window, once its debugging port answers; null if nothing answers within the time. Each call connects afresh. */
async function connect(waitMs: number): Promise<{ browser: Browser; page: Page } | null> {
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

async function attach(waitMs = 90_000): Promise<{ browser: Browser; page: Page }> {
  const found = await connect(waitMs)
  if (found === null) throw new Error(`the app's debugging port ${PORT} did not answer within ${waitMs / 1000} s`)

  return found
}

/** The page of a NEW app process: the old page carries the marker the test put in it, a new one cannot. */
async function attachToNewApp(waitMs: number): Promise<{ browser: Browser; page: Page }> {
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
function stopApp(): void {
  const script = "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:DESKTOP_INSTALL_DIR + '\\') } | Stop-Process -Force"
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, DESKTOP_INSTALL_DIR: INSTALL_DIR } })
}

async function portIsClosed(): Promise<boolean> {
  return fetch(`http://127.0.0.1:${PORT}/json/version`).then(
    () => false,
    () => true,
  )
}

test('the app takes the offered update, comes back as the new version, and loses nothing', async () => {
  expect(APP_EXE, 'DESKTOP_APP_EXE').not.toBe('')
  expect(INSTALL_DIR, 'DESKTOP_INSTALL_DIR').not.toBe('')
  expect(FROM, 'DESKTOP_FROM').not.toBe('')
  expect(TO, 'DESKTOP_TO').not.toBe('')

  const { page } = await attach()
  try {
    // A fresh install: make something worth keeping, in a language that is not the default.
    await createFirstList(page, TITLE, ITEMS)
    await chooseGerman(page)

    // The offer: the next version, no notice row yet.
    await openAbout(page)
    const status = page.locator('.q-about-update-text')
    await expect(status).toContainText(t.about.available, { timeout: 30_000 })
    await expect(status).toContainText(`${t.about.version} ${FROM} → ${TO}`)
    await expect(page.locator('.q-about-update-notice')).toHaveCount(0)

    // From here the page is the old app's: mark it, and keep every sentence the live region is given.
    await page.evaluate(() => {
      const mark = window as unknown as { __oldApp: boolean; __announced: string[] }
      mark.__oldApp = true
      mark.__announced = []
      const live = document.querySelector('.q-live')
      if (live !== null) new MutationObserver(() => mark.__announced.push(live.textContent ?? '')).observe(live, { childList: true, subtree: true, characterData: true })
    })
    await page.locator('.q-about-update-block').getByRole('button', { name: t.about.download, exact: true }).click()

    // The notice is on screen and was said once, before the window goes.
    await expect(page.locator('.q-about-update-notice')).toHaveText(t.about.updateNoticeWindows)
    const said = await page.evaluate(() => (window as unknown as { __announced: string[] }).__announced)
    expect(said.some((line) => line.includes(t.about.updateNoticeWindows)), `the live region said: ${JSON.stringify(said)}`).toBe(true)
  } catch (error) {
    console.log('old app, page text:', (await page.locator('body').innerText().catch(() => '(unreadable)')).slice(0, 600))
    throw error
  }

  // The window goes and the new app comes back by itself.
  const { browser, page: after } = await attachToNewApp(240_000)
  try {
    await expect(after.getByText(t.about.updatedTo(TO))).toHaveCount(1, { timeout: 30_000 })
    await expect(after.getByRole('heading', { name: t.home.title })).toBeVisible({ timeout: 30_000 })

    await openAbout(after)
    await expect(after.locator('.q-about-update-text')).toContainText(t.about.upToDate, { timeout: 30_000 })
    await expect(after.locator('.q-about-update-text')).toContainText(`${t.about.version} ${TO}`)
    await closeAbout(after)

    // The list, its items and the language (the labels are German) are as they were.
    await after.getByText(TITLE, { exact: true }).click()
    await expect(after.getByRole('heading', { name: TITLE })).toBeVisible()
    for (const item of ITEMS) await expect(after.getByText(item, { exact: true })).toBeVisible()
  } catch (error) {
    console.log('new app, page text:', (await after.locator('body').innerText().catch(() => '(unreadable)')).slice(0, 600))
    throw error
  } finally {
    await browser.close().catch(() => undefined)
  }

  // A second start of the same version says nothing: the toast is for the first screen of a NEW version only.
  stopApp()
  await expect.poll(portIsClosed, { timeout: 30_000 }).toBe(true)
  spawn(APP_EXE, [], { detached: true, stdio: 'ignore' }).unref()
  const second = await attachToNewApp(90_000)
  try {
    await expect(second.page.getByRole('heading', { name: t.home.title })).toBeVisible({ timeout: 30_000 })
    await second.page.waitForTimeout(5_000)
    await expect(second.page.getByText(t.about.updatedTo(TO))).toHaveCount(0)
  } finally {
    await second.browser.close().catch(() => undefined)
  }
})
