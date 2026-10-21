import { expect, type Page } from '@playwright/test'
import { de } from '../src/locale/de.js'
import { en } from '../src/locale/en.js'

/**
 * What the Windows update test does in the app's window, as functions (Phase 31, task 31.7). They are shared by the desktop spec
 * (`update.spec.ts`, which drives the real installed app) and by a rehearsal in the ordinary browser suite
 * (`e2e/desktop-update-steps.spec.ts`), so a changed label or flow fails in the normal run and not on a Windows runner.
 *
 * A fresh install boots into the first-run category picker (its database is empty), in English. The language is set after the first
 * list exists, to German: not the default, so "the language survived" says something, and the rest of the test reads German.
 */
export const t = de.quantum

/** First run: pick the first shelf, add a list by hand with these items, and wait until the list is open. */
export async function createFirstList(page: Page, title: string, items: readonly string[]): Promise<void> {
  const q = en.quantum
  await expect(page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })).toBeVisible({ timeout: 30_000 })
  await page.locator('.q-tile').first().click()
  await page.getByRole('tab', { name: q.createList.handTab }).click()
  await page.getByLabel(q.addByHand.titleLabel, { exact: true }).fill(title)
  await page.getByLabel(q.addByHand.itemsLabel, { exact: true }).fill(items.join('\n'))
  await page.getByRole('button', { name: q.addByHand.create }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

/** Switches the interface to German in Settings and closes it again. The page must be showing English. */
export async function chooseGerman(page: Page): Promise<void> {
  await page.getByRole('button', { name: en.quantum.appHeader.settings, exact: true }).click()
  await page.getByRole('button', { name: de.quantum.settings.languages.de, exact: true }).click()
  await expect(page.getByRole('heading', { name: t.settings.title })).toBeVisible()
  await page.locator('.q-settings').getByRole('button', { name: t.settings.closeLabel, exact: true }).click()
  await expect(page.getByRole('heading', { name: t.settings.title })).toHaveCount(0)
}

/** Opens About (German). */
export async function openAbout(page: Page): Promise<void> {
  await page.getByRole('button', { name: t.appHeader.about, exact: true }).click()
  await expect(page.locator('.q-about')).toBeVisible()
}

/** Closes About (German). */
export async function closeAbout(page: Page): Promise<void> {
  await page.locator('.q-about').getByRole('button', { name: t.about.closeLabel, exact: true }).click()
  await expect(page.locator('.q-about')).toHaveCount(0)
}

/** The status line the reader sees ("up to date", "an update is available", …): the stacked variants that are not hidden, the first of them. */
export const visibleStatus = (page: Page) => page.locator('.q-about-update-text .q-about-stack > :not(.off)').first()

/** The version line the reader sees ("Version 1.0.0-rc.1", or with an offer "Version 1.0.0-rc.1 → 1.0.0-rc.2"). */
export const visibleVersion = (page: Page) => page.locator('.q-about-version-text:visible')
