import { expect, test, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * Use Hands under eX-Zed (57.7, design's D37, the owner's call): the fields (Title, Description, Items) and their help text stop at 980px, neither the window's full width nor a narrow
 * column: a line of the Items box (the title and its " (year)") fits 60 ZX characters for 99.1% of the List Vault's 9,570 items, 60 x 16px is 960px of text, plus 8px of padding and the
 * 2px border on each side, so 980. Below a 1028px body they fill it: design's D57 (2026-11-23, answering our 1028 against 1032 question) makes the Create layer's body 24px on each side in eX-Zed (`space-3`, the window's gutter; Quantum's 26px is not on the theme's 8px steps), as the head's. The status chips and Create List keep their own widths.
 * In both engines, in all six skins at 1440, and at the narrowest window.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function openHands(page: Page, skin: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile').first().click()
  await page.getByRole('tab', { name: q.createList.handTab }).click()
  await page.getByLabel(q.addByHand.titleLabel, { exact: true }).waitFor()
  // The Spectrum font decides every width here: measure after it has loaded, and after the layer has settled.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

/** The widths the form has: the room its container gives, each field, the help text, and the parts that keep their own widths. */
const measure = (page: Page) =>
  page.evaluate(
    ({ title, description, items }) => {
      const width = (element: Element | null) => (element ? element.getBoundingClientRect().width : -1)
      const body = document.querySelector('.q-create-body')!
      const bodyStyle = getComputedStyle(body)
      const room = body.clientWidth - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight)
      const form = document.querySelector('.q-hand')!
      const byLabel = (text: string) => [...document.querySelectorAll('.q-hand label, .q-hand .q-field')].find((el) => el.textContent?.startsWith(text))?.querySelector('input, textarea') ?? null
      const status = [...document.querySelectorAll('.q-hand > .q-field')].at(-1)!
      const chips = [...status.querySelectorAll('button, [role="radio"]')].map((chip) => width(chip))
      const left = (element: Element) => element.getBoundingClientRect().left

      return {
        room,
        form: width(form),
        formLeft: left(form),
        fieldLeft: left(byLabel(title)!),
        title: width(byLabel(title)),
        description: width(byLabel(description)),
        items: width(byLabel(items)),
        hint: width(document.querySelector('.q-hand-hint')),
        chips,
        create: width(document.querySelector('.q-hand-actions .q-btn')),
      }
    },
    { title: q.addByHand.titleLabel, description: q.addByHand.descriptionLabel, items: q.addByHand.itemsLabel },
  )

const near = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(0.75)

for (const skin of SKINS) {
  test(`${skin} at 1440: Title, Description, Items and their help text are 980px wide; the status chips and Create List keep their own widths`, async ({ page }) => {
    await openHands(page, skin, 1440)
    const at = await measure(page)

    expect(at.room, 'the room is more than the fields take').toBeGreaterThan(980)
    near(at.title, 980, 'Title')
    near(at.description, 980, 'Description')
    near(at.items, 980, 'Items')
    near(at.hint, 980, 'the help text')
    expect(Math.max(...at.chips), 'a status chip is its own width, nowhere near the fields’').toBeLessThan(400)
    expect(at.create, 'Create List is its own width').toBeLessThan(400)
    near(at.fieldLeft, at.formLeft, 'the fields start at the form’s left edge')
  })
}

test('at the narrowest window the fields take what the body has when it is less than 980px, and 980px when it has more', async ({ page }) => {
  await openHands(page, 'exzed-1d', 1128)
  const at = await measure(page)
  const expected = Math.min(980, at.room)

  near(at.title, expected, 'Title')
  near(at.description, expected, 'Description')
  near(at.items, expected, 'Items')
  near(at.hint, expected, 'the help text')
})

test('below a 1028px body the fields fill it: a body squeezed to 700px gives 700px fields, with the chips and Create List as wide as before', async ({ page }) => {
  await openHands(page, 'exzed-1d', 1440)
  const before = await measure(page)
  await page.addStyleTag({ content: '.q-create-body { padding-inline: 24px 520px !important; }' })
  const at = await measure(page)

  expect(at.room, 'the body now has less than 980px').toBeLessThan(980)
  near(at.title, at.room, 'Title')
  near(at.description, at.room, 'Description')
  near(at.items, at.room, 'Items')
  near(at.hint, at.room, 'the help text')
  expect(at.chips, 'the chips are as wide as they were').toEqual(before.chips)
  near(at.create, before.create, 'Create List is as wide as it was')
})

for (const tab of [q.createList.searchTab('TMDB'), q.createList.handTab, q.createList.importTab]) {
  test(`the Create layer's body has 24px round it on the ${tab} tab, as the head has (D57)`, async ({ page }) => {
    await openHands(page, 'exzed-1d', 1440)
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(300)
    const paddings = await page.evaluate(() => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!)

        return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
      }

      return { body: read('.q-create-body'), head: read('.q-create-head') }
    })

    expect(paddings.body, 'the body: 24px on every side').toEqual(['24px', '24px', '24px', '24px'])
    expect(paddings.head.slice(1), 'the head: 24px on each side already (51.1b)').toEqual(['24px', '0px', '24px'])
  })
}
