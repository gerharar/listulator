import { expect, test, type Page } from '@playwright/test'
import { de } from '../src/locale/de.js'
import { en } from '../src/locale/en.js'
import { ru } from '../src/locale/ru.js'

/**
 * About's identity section under eX-Zed, as design's About board draws it (57.6, D35): the status box spans the window's body (the board's column stops at 1200px), a 2px `frame`
 * border with 16px of padding (24 on the left) and no fill; the two lines on the left (24px leading, 8px apart, the version line `ink2`), Check for Updates (40px high, 320px at least)
 * on the right, centred on them; when both do not fit the button wraps under the lines, left-aligned, 16px below them; the notice row (an update to install) is the box's full inner
 * width, 16px type, `ink2`, 8px after its icon. The copyright line spans the body (8px between lines, 16px between its parts), wraps only at a `·`, and "Licensing and notices" stays
 * whole. 24px between the wordmark, the box and the credits, 40px to the data sources, 24px of padding round the body. The development build's checker (`?aboutUpdate=available`)
 * stands in for the desktop updater. In both engines.
 */
const LOCALES = { en, ru, de } as const
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function openAbout(page: Page, skin: string, language: keyof typeof LOCALES, width: number, mode = 'available') {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin, language }))
  await page.goto(`/?aboutUpdate=${mode}`)
  await page.locator('.q-home-row').first().waitFor()
  await page.getByRole('button', { name: LOCALES[language].quantum.appHeader.about, exact: true }).click()
  await page.locator('.q-about-update-block').waitFor()
  // The Spectrum font decides every width here: measure after it has loaded, and after the layer has settled.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

/** Every place the section stands, as the page has it. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)
      if (!found) throw new Error(`no ${selector}`)
      const { left, right, top, bottom, width, height } = found.getBoundingClientRect()

      return { left, right, top, bottom, width, height }
    }
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const body = document.querySelector('.q-about-body')!
    const bodyStyle = getComputedStyle(body)
    const bodyRect = body.getBoundingClientRect()
    const padding = [bodyStyle.paddingTop, bodyStyle.paddingRight, bodyStyle.paddingBottom, bodyStyle.paddingLeft].map(parseFloat)
    const content = { left: bodyRect.left + padding[3]!, width: body.clientWidth - padding[1]! - padding[3]! }
    // The width the two lines want on their own: the box grows or wraps by it, so it decides which side of the line a language falls.
    const text = document.querySelector<HTMLElement>('.q-about-update-text')!
    const was = [text.style.flex, text.style.width]
    text.style.flex = 'none'
    text.style.width = 'max-content'
    const natural = text.getBoundingClientRect().width
    text.style.flex = was[0]!
    text.style.width = was[1]!
    const sections = [...document.querySelectorAll('.q-about-column > *')].map((section) => section.getBoundingClientRect())
    const probe = document.createElement('i')
    probe.style.cssText = 'position:fixed;border:2px solid var(--zx-frame);background:var(--zx-paper);color:var(--zx-ink2)'
    document.body.append(probe)
    const probed = getComputedStyle(probe)
    const colours = { frame: probed.borderTopColor, ink2: probed.color }
    probe.remove()

    return {
      padding,
      content,
      natural,
      colours,
      sections: sections.map((section) => ({ top: section.top, bottom: section.bottom })),
      box: rect('.q-about-update-block'),
      boxStyle: (({ borderTopWidth, borderTopStyle, borderTopColor, paddingTop, paddingRight, paddingBottom, paddingLeft, rowGap, columnGap, backgroundColor }) => ({
        borderTopWidth,
        borderTopStyle,
        borderTopColor,
        padding: [paddingTop, paddingRight, paddingBottom, paddingLeft],
        gap: [rowGap, columnGap],
        backgroundColor,
      }))(style('.q-about-update-block')),
      text: rect('.q-about-update-text'),
      textGap: style('.q-about-update-text').rowGap,
      status: rect('.q-about-update-text > .q-about-stack'),
      version: rect('.q-about-version-line'),
      versionStyle: (({ fontSize, lineHeight, color, fontFamily }) => ({ fontSize, lineHeight, color, fontFamily }))(style('.q-about-version-line')),
      statusFont: style('.q-about-update-text > .q-about-stack > span').fontFamily,
      versionSep: style('.q-about-version-line .q-about-sep').display,
      button: rect('.q-about-update-block .q-btn'),
      name: rect('.q-about-nameline'),
      credits: rect('.q-about-credits'),
      creditsGap: [style('.q-about-credits').rowGap, style('.q-about-credits').columnGap],
      licensing: [...document.querySelectorAll('.q-about-credits .q-about-credit-link')].map((link) => ({ lines: link.getClientRects().length, height: link.getBoundingClientRect().height })),
    }
  })

const close = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(0.75)

for (const language of ['en', 'ru', 'de'] as const) {
  for (const width of [1440, 1128] as const) {
    test(`${language} at ${width}: the status box spans the body, the lines on the left and the button on the right centred on them, or under them when both do not fit`, async ({ page }) => {
      await openAbout(page, 'exzed-1d', language, width)
      const at = await geometry(page)
      const column = Math.min(at.content.width, 1200)
      const inner = at.box.width - 4 - 40

      expect(at.padding, 'the body has 24px round it').toEqual([24, 24, 24, 24])
      close(at.box.left, at.content.left, 'the box starts at the body’s left')
      close(at.box.width, column, 'the box is as wide as the column (the body, to 1200px)')
      expect([at.boxStyle.borderTopWidth, at.boxStyle.borderTopStyle, at.boxStyle.borderTopColor], 'a 2px solid frame').toEqual(['2px', 'solid', at.colours.frame])
      expect(at.boxStyle.padding, '16px, 24px on the left').toEqual(['16px', '16px', '16px', '24px'])
      expect(at.boxStyle.gap, '16px between lines, 32px between the lines and the button').toEqual(['16px', '32px'])
      expect(at.boxStyle.backgroundColor, 'no fill: the window’s paper shows').toBe('rgba(0, 0, 0, 0)')

      // The two lines: 24px leading each, 8px apart, the version line `ink2` in the font of the rest, and no `·` before Changelog (the board has none).
      expect(at.textGap).toBe('8px')
      // A link is its 24px line and the Link card's 2px above and 4px below it (the dotted underline; the shared look of every link, Checkpoint G2), so the version line is 30.
      close(at.text.height, 62, 'the two lines are 24 + 8 + 30 high')
      expect([at.versionStyle.fontSize, at.versionStyle.lineHeight, at.versionStyle.color]).toEqual(['16px', '24px', at.colours.ink2])
      expect(at.versionStyle.fontFamily, 'the version line is in the status line’s font, not Quantum’s mono').toBe(at.statusFont)
      expect(at.versionSep, 'no dot between the version and its Changelog').toBe('none')
      close(at.text.left, at.box.left + 2 + 24, 'the lines start inside the padding')

      expect(at.button.height, 'the button is 40px high').toBe(40)
      expect(at.button.width, 'and 320px at least').toBeGreaterThanOrEqual(320)

      const fits = at.natural + 32 + at.button.width <= inner + 0.5
      if (fits) {
        close(at.button.right, at.box.right - 2 - 16, 'the button stands at the right, inside the padding')
        close(at.button.top + at.button.height / 2, at.text.top + at.text.height / 2, 'and is centred on the two lines')
      } else {
        close(at.button.left, at.box.left + 2 + 24, 'the button wrapped under the lines is left-aligned')
        close(at.button.top, at.text.bottom + 16, 'and 16px below them')
      }
    })
  }

  test(`${language}: when the lines and the button do not fit, the button wraps under the lines, left-aligned, 16px below`, async ({ page }) => {
    await openAbout(page, 'exzed-1d', language, 1440)
    // A column too narrow for the lines and a 320px button side by side (a 125% or 150% screen, or a language that runs long, does the same): the one rule is the box's own.
    await page.addStyleTag({ content: '.q-about-column { max-width: 700px !important; }' })
    const at = await geometry(page)

    expect(at.box.width).toBeLessThanOrEqual(700.5)
    close(at.button.left, at.box.left + 2 + 24, 'left-aligned')
    close(at.button.top, at.text.bottom + 16, '16px under the lines')
    expect(at.button.top, 'on a row of its own').toBeGreaterThan(at.text.bottom)
  })
}

test('the section’s gaps: 24px between the wordmark, the box and the credits, 40px to the data sources', async ({ page }) => {
  await openAbout(page, 'exzed-1d', 'en', 1440)
  const at = await geometry(page)

  close(at.box.top - at.name.bottom, 24, 'wordmark to box')
  close(at.credits.top - at.box.bottom, 24, 'box to credits')
  close(at.sections[1]!.top - at.sections[0]!.bottom, 40, 'identity to data sources')
})

for (const language of ['en', 'ru', 'de'] as const) {
  test(`${language}: the copyright line spans the body, 8px between lines and 16px between parts; every link is one line`, async ({ page }) => {
    await openAbout(page, 'exzed-1d', language, 1440)
    const at = await geometry(page)

    close(at.credits.left, at.content.left, 'starts at the body’s left')
    close(at.credits.width, Math.min(at.content.width, 1200), 'spans the column')
    expect(at.creditsGap).toEqual(['8px', '16px'])
    for (const link of at.licensing) {
      expect(link.lines, 'a link is never broken over two lines').toBe(1)
      expect(link.height, 'and is one 24px line and the Link card’s 6px').toBeLessThanOrEqual(30.5)
    }
  })

  test(`${language}: a narrow column wraps the copyright line at a dot, never inside a link`, async ({ page }) => {
    await openAbout(page, 'exzed-1d', language, 1440)
    await page.addStyleTag({ content: '.q-about-column { max-width: 460px !important; }' })
    const at = await geometry(page)

    expect(at.credits.height, 'it wraps (more than one line)').toBeGreaterThan(30)
    for (const link of at.licensing) expect(link.lines, 'a link is never broken over two lines').toBe(1)
  })
}

test('the notice row (an update to install) is the box’s whole inner width on a row of its own, 16px type in ink2, 8px after its icon', async ({ page }) => {
  await openAbout(page, 'exzed-1d', 'en', 1440)
  const notice = await page.locator('.q-about-update-notice').evaluate((element) => {
    const { left, width, top } = element.getBoundingClientRect()
    const style = getComputedStyle(element)

    return { left, width, top, fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, gap: style.columnGap, alignItems: style.alignItems, marginRight: style.marginRight }
  })
  const at = await geometry(page)

  close(notice.left, at.box.left + 2 + 24, 'the notice starts inside the padding')
  close(notice.width, at.box.width - 4 - 40, 'and is as wide as the inner box')
  expect(notice.top, 'on a row under the lines and the button').toBeGreaterThanOrEqual(Math.max(at.text.bottom, at.button.bottom) + 15.5)
  expect([notice.fontSize, notice.lineHeight, notice.color, notice.gap, notice.alignItems, notice.marginRight]).toEqual(['16px', '24px', at.colours.ink2, '8px', 'center', '0px'])
})

for (const skin of SKINS) {
  test(`${skin}: the box’s border is the skin’s frame and the version line its ink2`, async ({ page }) => {
    await openAbout(page, skin, 'en', 1440)
    const at = await geometry(page)

    expect(at.boxStyle.borderTopColor).toBe(at.colours.frame)
    expect(at.versionStyle.color).toBe(at.colours.ink2)
  })
}
