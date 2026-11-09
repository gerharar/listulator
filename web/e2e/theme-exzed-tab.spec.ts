import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * eX-Zed's covered-layer tab (Phase 49.4, design's answer 10; BL-166), in both engines: with a list opened over Home and Settings over the list, each
 * covered layer shows a tab that is the skin's `paper`, solid (the covered layer's own heading and kicker do not show through it), its label `ink2`, a
 * 4px `frame` border and no ring. Read as computed styles and as pixels of a screenshot of the tab's visible strip: the first four rows are the frame, then
 * the inside is one flat paper colour apart from the label. Quantum's tab is not touched (the identity tool). Real writes on the dev server, removed in a `finally`.
 */
const SKINS = {
  'exzed-1d': { paper: [0, 0, 0], frame: [215, 215, 0], ink2: 'rgb(215, 215, 215)' },
  'exzed-1l': { paper: [215, 215, 215], frame: [0, 0, 0], ink2: 'rgb(0, 0, 215)' },
} as const

async function makeList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three'].map((name) => `  - { title: "Item ${name}", minutes: 30, group: "Season 1" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function stack(page: Page, title: string, exzedSkin: string) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme: 'exzed', exzedSkin, skin: 'dark-orange', reducedMotion: 'true' }))
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.q-layer:not(.covered)').first().waitFor()
  await expect(page.locator('.q-layer-tab')).toHaveCount(2)
}

/** The tab's box and its label's box, in page coordinates. */
const boxes = (page: Page, at: number) =>
  page.locator('.q-layer-tab').nth(at).evaluate((tab) => {
    const rect = tab.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(tab)
    const label = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, label: { x: label.x, y: label.y, width: label.width, height: label.height } }
  })

/** Decodes a PNG in the page and returns its pixels as [r, g, b, a] rows, so the test needs no image library. */
const pixels = (page: Page, png: Buffer) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    return { width: bitmap.width, height: bitmap.height, data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) }
  }, png.toString('base64'))

for (const [skin, want] of Object.entries(SKINS)) {
  test.describe(`with the theme exzed, skin ${skin}`, () => {
    let title = ''
    let id = ''

    test.beforeEach(async ({ page }) => {
      title = `e2e tab ${skin} ${test.info().project.name} ${Date.now()}`
      id = await makeList(page.request, title)
      await stack(page, title, skin)
    })

    test.afterEach(async ({ page }) => {
      await page.request.delete(`/api/lists/${id}`)
    })

    test('each covered tab is paper, its label ink2, its border 4px frame, with no ring', async ({ page }) => {
      const paper = `rgb(${want.paper.join(', ')})`
      const frame = `rgb(${want.frame.join(', ')})`

      for (const at of [0, 1]) {
        const style = await page.locator('.q-layer-tab').nth(at).evaluate((tab) => {
          const s = getComputedStyle(tab)
          const side = (name: 'Top' | 'Right' | 'Bottom' | 'Left') => [s[`border${name}Width`], s[`border${name}Style`], s[`border${name}Color`]].join(' ')
          return { background: s.backgroundColor, color: s.color, top: side('Top'), right: side('Right'), bottom: side('Bottom'), left: side('Left'), shadow: s.boxShadow }
        })

        expect(style, `tab ${at}`).toEqual({
          background: paper,
          color: want.ink2,
          top: `4px solid ${frame}`,
          right: `4px solid ${frame}`,
          bottom: `4px solid ${frame}`,
          left: `4px solid ${frame}`,
          shadow: 'none',
        })
      }
    })

    test('the visible strip of each covered tab is a frame of 4px, then flat paper with only the label on it', async ({ page }) => {
      for (const at of [0, 1]) {
        const box = await boxes(page, at)
        // The window in front covers the tab from 28px down (its 12px of rings start there), so only the strip above is read.
        const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: 24 }
        const shot = await pixels(page, await page.screenshot({ clip }))
        // WebKit’s device has a pixel ratio of 2: every length below is in CSS pixels times this, so a 4px border is 4 x scale rows.
        const scale = shot.width / clip.width
        const at4 = (x: number, y: number) => shot.data.slice((y * shot.width + x) * 4, (y * shot.width + x) * 4 + 4)
        const middle = Math.floor(shot.width / 2)
        const border = 4 * scale

        // The first 4 CSS pixels are the frame; the next row is the first row of paper.
        for (let y = 0; y < border; y++) expect([...at4(middle, y)], `tab ${at} row ${y}`).toEqual([...want.frame, 255])
        expect([...at4(middle, border)], `tab ${at} first row inside the border`).toEqual([...want.paper, 255])

        // Inside the border every pixel outside the label is paper: nothing of the layer beneath shows through.
        const label = {
          left: (box.label.x - box.x - 2) * scale,
          right: (box.label.x - box.x + box.label.width + 2) * scale,
          top: (box.label.y - box.y - 2) * scale,
          bottom: (box.label.y - box.y + box.label.height + 2) * scale,
        }
        const stray: string[] = []
        for (let y = border; y < shot.height; y++) {
          for (let x = border; x < shot.width - border; x++) {
            if (x >= label.left && x <= label.right && y >= label.top && y <= label.bottom) continue
            const [r, g, b, a] = at4(x, y)
            if (r !== want.paper[0] || g !== want.paper[1] || b !== want.paper[2] || a !== 255) stray.push(`(${x},${y}) ${r},${g},${b},${a}`)
          }
        }
        expect(stray.slice(0, 5), `tab ${at}: ${stray.length} pixels that are not paper`).toEqual([])
      }
    })
  })
}
