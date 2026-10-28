import { expect, type Page } from '@playwright/test'

/**
 * What the group triangle's line looks like in a real browser (canvas H-022), shared by `group-line.spec.ts` (the key set before load) and
 * `group-line-setting.spec.ts` (the Settings checkbox): one definition of "exactly 6px from the ink".
 */
export async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

export interface Mark {
  open: boolean
  tri: { left: number; right: number; top: number; bottom: number }
  rule: { left: number; right: number; top: number; bottom: number; width: number; height: number }
}

/** Every head's drawing and line, read in one evaluation so they belong to the same frame. */
export const marks = (page: Page, head: string): Promise<Mark[]> =>
  page.evaluate((selector) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }

    return [...document.querySelectorAll(selector)].map((node) => ({
      open: node.getAttribute('aria-expanded') === 'true',
      tri: box(node.querySelector('.q-chev-tri')!),
      rule: box(node.querySelector('.q-chev-rule')!),
    }))
  }, head)

/** Open: the line stands left of the triangle's ink, 1 x 14. Shut: it lies under it, 14 x 1. Both 6px off the ink, centred on it. */
export function expectSixPixels(found: Mark[], opens: boolean[]) {
  expect(found.map((mark) => mark.open)).toEqual(opens)
  for (const { open, tri, rule } of found) {
    if (open) {
      expect(tri.left - rule.right, 'open: line to ink').toBeCloseTo(6, 1)
      expect([rule.width, rule.height]).toEqual([1, 14])
      expect((rule.top + rule.bottom) / 2).toBeCloseTo((tri.top + tri.bottom) / 2, 1)
    } else {
      expect(rule.top - tri.bottom, 'shut: line to ink').toBeCloseTo(6, 1)
      expect([rule.width, rule.height]).toEqual([14, 1])
      expect((rule.left + rule.right) / 2).toBeCloseTo((tri.left + tri.right) / 2, 1)
    }
  }
}

/**
 * How many pixel rows of the screen each shut group head's line covers, read from the rendered pixels (a screenshot at the page's own scale), not from
 * the layout: the layout says "1px" at every scale, the screen says 1 or 2 rows (BL-153, Windows at 125%). A row counts when it is at least half as
 * bright as the line's brightest row, so a faint edge of anti-aliasing is not mistaken for thickness. Heads are the first `count` `.q-group` in view.
 */
export async function lineRowsPerHead(page: Page, count: number): Promise<number[]> {
  const heads = await page.evaluate(
    (n) => [...document.querySelectorAll('.q-group')].slice(0, n).map((group) => {
      const r = group.querySelector('.q-chev-rule')!.getBoundingClientRect()

      return { x: r.left, y: r.top, w: r.width }
    }),
    count,
  )
  const shot = (await page.screenshot()).toString('base64')
  const scale = await page.evaluate(() => window.devicePixelRatio)
  const probe = await page.context().newPage()
  try {
    return await probe.evaluate(
      async ({ shot, heads, scale }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${shot}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)

        return heads.map((head) => {
          const x0 = Math.round((head.x + 3) * scale)
          const x1 = Math.round((head.x + head.w - 3) * scale)
          const yMid = Math.round(head.y * scale)
          const luminance: number[] = []
          for (let y = yMid - 4; y <= yMid + 5; y += 1) {
            let sum = 0
            for (let x = x0; x <= x1; x += 1) {
              const data = ctx.getImageData(x, y, 1, 1).data
              sum += ((data[0] ?? 0) + (data[1] ?? 0) + (data[2] ?? 0)) / 3
            }
            luminance.push(sum / (x1 - x0 + 1))
          }
          const floor = Math.min(...luminance)
          const peak = Math.max(...luminance)

          return luminance.filter((value) => (value - floor) / Math.max(1, peak - floor) >= 0.5).length
        })
      },
      { shot, heads, scale },
    )
  } finally {
    await probe.close()
  }
}
