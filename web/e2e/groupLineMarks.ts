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
