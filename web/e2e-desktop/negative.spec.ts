import { expect, test } from '@playwright/test'
import { attach, FROM, ITEMS, TITLE, TO } from './app.js'
import { closeAbout, openAbout, t, visibleStatus, visibleVersion } from './steps.js'

/**
 * One negative case of the update test (Phase 31, task 31.8; docs/updater-test.md Part 3), against the installed OLDER app: the runner serves
 * the folder of the case (`DESKTOP_CASE`), and the app must say exactly what the manual test expects and stay what it was. About is closed and
 * opened again for each case, which is what asks the server again.
 *
 * `offer`: the update is offered (with the version it announces) and Download Update fails with "couldn't install". Otherwise the status line
 * is one of the sentences listed. After every case the installed version is still the old one (the version line starts with it) and the list
 * and its items are still there; the runner also compares the install folder before and after all the cases.
 */
interface Expectation {
  /** The version line of an offer, or undefined when nothing is offered. */
  offers?: string
  /** What the status line may say when nothing is offered. */
  says?: string[]
}

const EXPECTED: Record<string, Expectation> = {
  'same-version': { says: [t.about.upToDate] },
  'lower-version': { says: [t.about.upToDate] },
  // The manual test says "an error or up to date" and asks which. The first run on a runner (2026-10-21) said the check failed: that is the sentence.
  'other-os-windows': { says: [t.about.failed] },
  'wrong-version': { offers: '99.0.0' },
  tampered: { offers: TO },
  'wrong-key': { offers: TO },
  'cut-download': { offers: TO },
}

const name = process.env['DESKTOP_CASE'] ?? ''

test(`negative case ${name}`, async () => {
  const expected = EXPECTED[name]
  expect(expected, `DESKTOP_CASE ${JSON.stringify(name)} is not a case this spec knows`).toBeDefined()

  const { browser, page } = await attach()
  try {
    // A case that failed before may have left About open; each case starts from the list screen.
    if ((await page.locator('.q-about').count()) > 0) await closeAbout(page)
    await openAbout(page)
    if (expected!.offers !== undefined) {
      await expect(visibleStatus(page)).toHaveText(t.about.available, { timeout: 60_000 })
      await expect(visibleVersion(page)).toHaveText(`${t.about.version} ${FROM} → ${expected!.offers}`)
      await page.locator('.q-about-update-block').getByRole('button', { name: t.about.download, exact: true }).click()
      await expect(visibleStatus(page)).toHaveText(t.about.installFailed, { timeout: 60_000 })
      await expect(visibleVersion(page)).toHaveText(`${t.about.version} ${FROM} → ${expected!.offers}`)
    } else {
      await expect.poll(async () => (await visibleStatus(page).textContent()) ?? '', { timeout: 60_000, message: 'the status line' }).not.toBe(t.about.checking)
      const said = (await visibleStatus(page).textContent()) ?? ''
      console.log(`case ${name}: the app says ${JSON.stringify(said)}`)
      expect(expected!.says, `the app said ${JSON.stringify(said)}`).toContain(said)
      await expect(visibleVersion(page)).toHaveText(`${t.about.version} ${FROM}`)
    }

    // Nothing was lost: the list and its items are on screen again once About is closed.
    await closeAbout(page)
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
    for (const item of ITEMS) await expect(page.getByText(item, { exact: true })).toBeVisible()
  } catch (error) {
    console.log('page text:', (await page.locator('body').innerText().catch(() => '(unreadable)')).slice(0, 600))
    throw error
  } finally {
    await browser.close().catch(() => undefined)
  }
})
