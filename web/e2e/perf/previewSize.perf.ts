import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 26.0 (BACKLOG BL-098): what the Preview layer costs at 2,161 to 50,000 rows, and what the Create layer's search results cost after many "Show more"
 * presses, in a real browser against the PRODUCTION build. The network is stubbed at the browser boundary (a generated source answer), so the numbers are the
 * page's own: parsing, drawing, scrolling, folding. The server's cost of the same answer is in `previewAnswer.perf.test.ts` (vitest). Prints one `PERF-PREVIEW|`
 * or `PERF-SEARCH|` line per case; the table in DECISIONS is made from them. By hand: `cd web && npx playwright test -c playwright.perf.config.ts previewSize`.
 */
const SIZES = [2_161, 10_000, 30_000, 50_000]
const LAYOUTS = [
  { name: 'flat', per: 0 },
  { name: 'groups of 25', per: 25 },
  { name: 'groups of 100', per: 100 },
] as const
const PRESSES = [5, 20, 100]

function previewItems(count: number, per: number) {
  return Array.from({ length: count }, (_, n) => ({
    title: `Episode ${n}: a title of ordinary length`,
    externalRef: `perf:${n}`,
    year: 1960 + (n % 60),
    timeToConsumeMinutes: 20 + (n % 90),
    // A third of the rows carry the type chip the music Preview shows.
    ...(n % 3 === 0 ? { tags: ['Album'] } : {}),
    ...(per > 0 ? { group: `Volume ${Math.floor(n / per)}` } : {}),
  }))
}

/** Two animation frames: what has been changed is painted. */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

async function openMusicSearch(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
}

async function search(page: Page) {
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('perf')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
}

/** Scrolls an element 900px a frame for two seconds and says how the frames went. */
const scrollProbe = (page: Page, selector: string) =>
  page.evaluate(async (sel) => {
    const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    let scroller = document.querySelector(sel) as HTMLElement | null
    // The results' scroller is whichever ancestor scrolls.
    for (let node: HTMLElement | null = scroller; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
        scroller = node
        break
      }
    }
    if (!scroller) return null
    const frames: number[] = []
    let last = performance.now()
    const end = last + 2000
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        frames.push(now - last)
        last = now
        scroller!.scrollTop += 900
        if (now < end) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    frames.sort((a, b) => a - b)
    scroller.scrollTop = 0
    await painted()

    return {
      p50: Math.round(frames[Math.floor(frames.length / 2)]! * 10) / 10,
      p95: Math.round(frames[Math.floor(frames.length * 0.95)]! * 10) / 10,
      max: Math.round(frames[frames.length - 1]!),
      frames: frames.length,
    }
  }, selector)

const state = (page: Page, rowSelector: string) =>
  page.evaluate((sel) => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory

    return {
      elements: document.querySelectorAll('*').length,
      rows: document.querySelectorAll(sel).length,
      heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    }
  }, rowSelector)

for (const count of SIZES) {
  for (const layout of LAYOUTS) {
    test(`Preview of ${count.toLocaleString('en-US')} rows, ${layout.name}`, async ({ page }, testInfo) => {
      const items = previewItems(count, layout.per)
      let addRequestAt = 0
      await page.route('**/api/media-types/music/search**', (route) =>
        route.fulfill({ json: { sources: [{ externalRef: 'perf-1', title: 'Perf source', detail: 'Group · XX', itemCount: count }] } }),
      )
      await page.route('**/api/media-types/music/expansion**', (route) =>
        route.fulfill({
          json: route.request().url().includes('items=true') ? { itemCount: count, status: 'complete', items } : { itemCount: count },
        }),
      )
      await page.route('**/api/lists/from-source', (route) => {
        addRequestAt = Date.now()
        return route.fulfill({ status: 500, json: { message: 'perf: not created' } })
      })

      await openMusicSearch(page)
      await search(page)
      await page.locator('.q-result').first().waitFor()
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
      })

      // The row opens to show its Preview button.
      await page.locator('.q-result').first().click()

      // Open: from the click on Preview to the first rows painted (the answer is in the page already, stubbed: this is parse + draw).
      const preview = page.getByRole('button', { name: 'Preview', exact: true }).first()
      const start = Date.now()
      await preview.click()
      await page.locator('.q-preview-row').first().waitFor({ timeout: 10 * 60_000 })
      await page.evaluate(painted)
      const openMs = Date.now() - start
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
      })

      const after = await state(page, '.q-preview-row')
      const scroll = await scrollProbe(page, '.q-preview-body')

      // A fold of the first group, and unfolding it again, until painted (groups only).
      let fold = '-'
      if (layout.per > 0) {
        const head = page.locator('.q-preview-group').first()
        const t1 = Date.now()
        await head.click()
        await page.evaluate(painted)
        const foldMs = Date.now() - t1
        const t2 = Date.now()
        await head.click()
        await page.evaluate(painted)
        fold = `fold ${foldMs} ms, unfold ${Date.now() - t2} ms`
      }

      // The Add list press to the request leaving: the page's own work around the click.
      const t3 = Date.now()
      await page.locator('.q-preview').getByRole('button', { name: 'Add This List', exact: true }).click()
      await expect.poll(() => addRequestAt, { timeout: 60_000 }).toBeGreaterThan(0)
      const addMs = addRequestAt - t3

      console.log(
        `PERF-PREVIEW|${testInfo.project.name}|${count}|${layout.name}|open ${openMs} ms|elements ${after.elements}|rows ${after.rows}|heap ${after.heapMB ?? '-'} MB|` +
          `frame ${scroll ? `p50 ${scroll.p50} p95 ${scroll.p95} max ${scroll.max} (${scroll.frames} frames)` : 'no scroll'}|${fold}|add ${addMs} ms`,
      )
    })
  }
}

for (const presses of PRESSES) {
  test(`Search results after ${presses} Show more presses`, async ({ page }, testInfo) => {
    const PAGE = 20
    await page.route('**/api/media-types/music/search**', (route) => {
      const wanted = Number(new URL(route.request().url()).searchParams.get('page') ?? '1')
      const sources = Array.from({ length: PAGE }, (_, n) => {
        const index = (wanted - 1) * PAGE + n

        // `itemCount` is given, so no row asks for a count of its own.
        return { externalRef: `perf-${index}`, title: `Result ${index}: a title of ordinary length`, detail: 'Group · XX', itemCount: 10 + (index % 50) }
      })

      return route.fulfill({ json: { sources, hasMore: true, total: 100_000 } })
    })

    await openMusicSearch(page)
    await search(page)
    await page.locator('.q-result').first().waitFor()
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
    })

    const times: number[] = []
    for (let press = 1; press <= presses; press += 1) {
      const rowsBefore = await page.locator('.q-result').count()
      const button = page.getByRole('button', { name: 'Show More', exact: true })
      const t0 = Date.now()
      await button.click()
      await expect.poll(() => page.locator('.q-result').count(), { timeout: 60_000 }).toBeGreaterThan(rowsBefore)
      await page.evaluate(painted)
      times.push(Date.now() - t0)
    }
    times.sort((a, b) => a - b)
    const last = await state(page, '.q-result')
    const scroll = await scrollProbe(page, '.q-result')
    console.log(
      `PERF-SEARCH|${testInfo.project.name}|${presses} presses|rows ${last.rows}|elements ${last.elements}|heap ${last.heapMB ?? '-'} MB|` +
        `press p50 ${times[Math.floor(times.length / 2)]} max ${times[times.length - 1]} ms|` +
        `frame ${scroll ? `p50 ${scroll.p50} p95 ${scroll.p95} max ${scroll.max} (${scroll.frames} frames)` : 'no scroll'}`,
    )
  })
}
