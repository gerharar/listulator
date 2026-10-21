import { test } from '@playwright/test'
import { attach, ITEMS, TITLE } from './app.js'
import { chooseGerman, createFirstList } from './steps.js'

/**
 * The first thing the update test does in the installed app (Phase 31, tasks 31.7 and 31.8): a fresh install gets something worth keeping, in a
 * language that is not the default. Every later spec is judged against it.
 */
test('a fresh install gets a list with three items and the German interface', async () => {
  const { browser, page } = await attach()
  try {
    await createFirstList(page, TITLE, ITEMS)
    await chooseGerman(page)
  } finally {
    await browser.close().catch(() => undefined)
  }
})
