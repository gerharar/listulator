import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * I'm Tired, Boss (task 10.26) in a real browser: the sheet hangs off the help
 * row, starts on the list you opened last, never offers that list's medium, and
 * its picker and toggle button do not count as "outside" presses. Real writes,
 * removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, mediaType: string, done: number, total = 4) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: Array.from({ length: total }, (_, i) => ({ title: `${title} #${i + 1}`, timeToConsumeMinutes: 30 })) },
  })
  const items = (await (await request.get(`/api/lists/${list.id}`)).json()).items as { id: string }[]
  for (const item of items.slice(0, done)) {
    await request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })
  }

  return list.id as string
}

const stamp = Date.now()
const TITLES = {
  openedTv: `e2e tired tv-open ${stamp}`,
  otherTv: `e2e tired tv-other ${stamp}`,
  game: `e2e tired game ${stamp}`,
  book: `e2e tired book ${stamp}`,
}

async function setup(request: APIRequestContext) {
  return [
    await makeList(request, TITLES.openedTv, 'tv', 1),
    await makeList(request, TITLES.otherTv, 'tv', 3),
    await makeList(request, TITLES.game, 'game', 2),
    await makeList(request, TITLES.book, 'book', 0),
  ]
}

const tiredButton = (page: Page) => page.getByRole('button', { name: "I'm Tired, Boss" })
const sheet = (page: Page) => page.locator('.q-sheet')

async function openAndCloseList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await expect(page.locator('.q-item').first()).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.q-home-row', { hasText: title })).toBeVisible()
}

test('opens on the list opened last, never offers its medium, and Open The List opens the list', async ({ page }) => {
  const ids = await setup(page.request)

  try {
    await openAndCloseList(page, TITLES.openedTv)
    await tiredButton(page).click()

    await expect(sheet(page)).toContainText('And Now For Something Completely Different')
    await expect(sheet(page).locator('.q-tired-target')).toContainText(TITLES.openedTv)
    await expect(tiredButton(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet(page).locator('.q-pick')).toBeVisible()

    // No TV list is ever offered, from this run or a parallel one (the named list and its medium are
    // out). Turn picks down until one of this run's own lists is on top, then open it: parallel runs
    // create and delete their own lists, so opening an arbitrary pick could open one that just went.
    let mine: string | undefined
    for (let i = 0; i < 40 && !mine; i += 1) {
      const offered = (await sheet(page).locator('.q-pick-list').allTextContents()).join(' | ')
      expect(offered).not.toContain('e2e tired tv')
      const top = await sheet(page).locator('.q-pick-list').textContent()
      mine = [TITLES.game, TITLES.book].find((title) => top?.includes(title))
      if (!mine) await sheet(page).getByRole('button', { name: 'Not That' }).click()
    }
    expect(mine, 'one of this run’s own lists came up').toBeTruthy()
    await page.screenshot({ path: 'test-results/tired-boss.png' })

    await sheet(page).getByRole('button', { name: 'Open List' }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.locator('.q-list-title')).toContainText(mine!)
    await expect(page.locator('.q-item').first()).toBeVisible()
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})

test('the button toggles it, the picker does not close it, and Esc closes only the sheet', async ({ page }) => {
  const ids = await setup(page.request)

  try {
    await openAndCloseList(page, TITLES.openedTv)
    await tiredButton(page).click()
    await expect(sheet(page)).toBeVisible()

    // Picking from the popover (outside the sheet in the DOM) keeps the sheet open and re-asks.
    await sheet(page).locator('.q-tired-target').click()
    await expect(page.locator('.q-tired-picker')).toBeVisible()
    await page.locator('.q-tired-picker .option', { hasText: TITLES.game }).click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).locator('.q-tired-target')).toContainText(TITLES.game)
    // Now the game's medium is out, whichever run's game lists exist.
    const offered = (await sheet(page).locator('.q-pick-list').allTextContents()).join(' | ')
    expect(offered).not.toContain('e2e tired game')

    // Not That moves on.
    const first = await sheet(page).locator('.q-pick-item').textContent()
    await sheet(page).getByRole('button', { name: 'Not That' }).click()
    await expect(sheet(page).locator('.q-pick-item')).not.toHaveText(first!)

    // The lit button closes it (and a press on it does not close-then-reopen it).
    await tiredButton(page).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(tiredButton(page)).toHaveAttribute('aria-pressed', 'false')

    await tiredButton(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.locator('.q-home-row').first()).toBeVisible()
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})

test('a press outside the sheet closes it', async ({ page }) => {
  const ids = await setup(page.request)

  try {
    await page.goto('/')
    await tiredButton(page).click()
    await expect(sheet(page)).toBeVisible()

    await page.locator('.q-home-head').click({ position: { x: 5, y: 5 } })
    await expect(sheet(page)).toHaveCount(0)
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})

test('the sheet stays inside the home card, and its buttons can be reached', async ({ page }) => {
  const ids = [
    await makeList(page.request, `e2e tired fit tv ${stamp}`, 'tv', 1),
    await makeList(page.request, `e2e tired fit game ${stamp}`, 'game', 1),
    await makeList(page.request, `e2e tired fit book ${stamp}`, 'book', 1),
    await makeList(page.request, `e2e tired fit comic ${stamp}`, 'comic', 1),
    await makeList(page.request, `e2e tired fit music ${stamp}`, 'music', 1),
  ]

  try {
    await openAndCloseList(page, `e2e tired fit tv ${stamp}`)
    await tiredButton(page).click()
    await expect(sheet(page).locator('.q-pick')).toBeVisible()
    await expect(sheet(page).locator('.q-alt')).toHaveCount(0)

    // The card clips whatever sticks out of it: the sheet must end inside it, with its own bottom border.
    const card = (await page.locator('.q-home').boundingBox())!
    const box = (await sheet(page).boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(card.y + card.height + 0.5)

    // The last button can be scrolled to and seen inside the card.
    const last = sheet(page).getByRole('button', { name: 'Not That' })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeVisible()
    const lastBox = (await last.boundingBox())!
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(card.y + card.height + 0.5)
    await page.screenshot({ path: 'test-results/tired-boss-fit.png' })
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})
