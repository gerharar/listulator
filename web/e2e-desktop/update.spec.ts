import { spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { APP_EXE, attach, attachToNewApp, FROM, INSTALL_DIR, ITEMS, portIsClosed, stopApp, TITLE, TO } from './app.js'
import { closeAbout, openAbout, t, visibleStatus, visibleVersion } from './steps.js'

/**
 * The Windows update test, positive path (Phase 31, task 31.7; docs/DECISIONS.md "Phase 31"): the installed test app is offered the next
 * version by `updater:serve`, takes it the way a person does (About, Download Update), comes back by itself as the new version, and has
 * lost nothing. It is started by `npm run test:desktop-update`, which has installed the older app, started it with the debugging port
 * (the test build's window config opens it), and is serving the newer one. It reads the two traces and uninstalls afterwards.
 *
 * Not asserted: how long the window is gone, and whether the installer comes to the front. A runner has no user; those stay the owner's
 * rounds on a real desktop.
 */
test('the app takes the offered update, comes back as the new version, and loses nothing', async () => {
  expect(APP_EXE, 'DESKTOP_APP_EXE').not.toBe('')
  expect(INSTALL_DIR, 'DESKTOP_INSTALL_DIR').not.toBe('')
  expect(FROM, 'DESKTOP_FROM').not.toBe('')
  expect(TO, 'DESKTOP_TO').not.toBe('')

  const { page } = await attach()
  try {
    // The app is as the earlier specs left it: the list from `prepare.spec.ts` on screen, the interface in German, the old version installed.
    // The offer: the next version, and with it the row that says the window will close for the installer.
    await openAbout(page)
    await expect(visibleStatus(page)).toHaveText(t.about.available, { timeout: 60_000 })
    await expect(visibleVersion(page)).toHaveText(`${t.about.version} ${FROM} → ${TO}`)
    await expect(page.locator('.q-about-update-notice')).toHaveText(t.about.updateNoticeWindows)

    // From here the page is the old app's: mark it, and keep every sentence the live region is given.
    await page.evaluate(() => {
      const mark = window as unknown as { __oldApp: boolean; __announced: string[] }
      mark.__oldApp = true
      mark.__announced = []
      const live = document.querySelector('.q-live')
      if (live !== null) new MutationObserver(() => mark.__announced.push(live.textContent ?? '')).observe(live, { childList: true, subtree: true, characterData: true })
    })
    await page.locator('.q-about-update-block').getByRole('button', { name: t.about.download, exact: true }).click()

    // The row stays, and the live region says it once the download starts, before the window goes. The region sets its text a frame after
    // the press, so this waits for it (the row was on screen already; it proves nothing about the press).
    await expect(page.locator('.q-about-update-notice')).toHaveText(t.about.updateNoticeWindows)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __announced: string[] }).__announced.join(' | ')), { timeout: 15_000, message: 'what the live region said' })
      .toContain(t.about.updateNoticeWindows)
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
    await expect(visibleStatus(after)).toHaveText(t.about.upToDate, { timeout: 60_000 })
    await expect(visibleVersion(after)).toHaveText(`${t.about.version} ${TO}`)
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
