import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 25.0: open, scroll, tick and filter lists of 2,500 to 50,000 items (BL-074). Prints one `PERF|` line per case; the table
 * in DECISIONS is made from them. Chromium measures memory too; WebKit (the macOS webview's engine) is only run up to 10,000
 * items, where its answers already say what it says. By hand: see `playwright.perf.config.ts`.
 */
const SIZES = [2_500, 10_000, 30_000, 50_000]
const LAYOUTS = [
  { name: 'no groups', groups: 0 },
  { name: 'one group', groups: 1 },
  { name: '100 groups', groups: 100 },
] as const

function yamlFor(count: number, groups: number): string {
  const rows = Array.from({ length: count }, (_, n) => {
    const group = groups === 0 ? '' : `, group: "Volume ${Math.floor((n * groups) / count)}"`
    return `  - { title: "Issue ${n}: a title of ordinary length", year: ${1960 + (n % 60)}, minutes: ${20 + (n % 90)}${group} }`
  })

  return `title: Perf ${count}\ncategory: movie\nitems:\n${rows.join('\n')}\n`
}

/** Two animation frames: what has been changed is painted. */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

async function measure(page: Page) {
  return page.evaluate(async () => {
    const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const body = document.querySelector('.q-list-body') as HTMLElement
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    // What is there once the list is open, before anything is done to it (the filter below removes rows).
    const elements = document.querySelectorAll('*').length
    const rowCount = document.querySelectorAll('.q-item').length
    const heapMB = memory ? Math.round(memory.usedJSHeapSize / 1048576) : null

    // Scrolling: eight frames' worth of scrolling per 100 ms for two seconds, with the frame times and long tasks recorded.
    const frames: number[] = []
    let longTasks = 0
    const observer = typeof PerformanceObserver !== 'undefined' ? new PerformanceObserver((list) => (longTasks += list.getEntries().length)) : null
    try {
      observer?.observe({ entryTypes: ['longtask'] })
    } catch {
      /* WebKit has no longtask entries */
    }
    let last = performance.now()
    const end = last + 2000
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        frames.push(now - last)
        last = now
        body.scrollTop += 900
        if (now < end) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    observer?.disconnect()
    frames.sort((a, b) => a - b)
    body.scrollTop = 0
    await painted()

    // A tick: the row's own click, until the change is painted.
    const row = document.querySelector('.q-item') as HTMLElement
    const tickStart = performance.now()
    row.click()
    await painted()
    const tick = performance.now() - tickStart

    // A keystroke in the filter, until the narrowed list is painted.
    const input = document.querySelector('.q-filter-input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const filterStart = performance.now()
    setter.call(input, 'issue 4')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await painted()
    const filter = performance.now() - filterStart

    return {
      elements,
      rows: rowCount,
      heapMB,
      frameP50: Math.round(frames[Math.floor(frames.length / 2)]! * 10) / 10,
      frameP95: Math.round(frames[Math.floor(frames.length * 0.95)]! * 10) / 10,
      frameMax: Math.round(frames[frames.length - 1]!),
      frames: frames.length,
      longTasks,
      tick: Math.round(tick),
      filter: Math.round(filter),
    }
  })
}

for (const count of SIZES) {
  for (const layout of LAYOUTS) {
    test(`${count.toLocaleString('en-US')} items, ${layout.name}`, async ({ page, request }, testInfo) => {
      test.skip(testInfo.project.name === 'webkit' && count > 10_000, 'WebKit is measured up to 10,000 items')
      const made = await request.post('/api/lists/from-file', { data: { yaml: yamlFor(count, layout.groups) } })
      expect(made.status()).toBe(201)
      const id = (await made.json()).id as string

      try {
        // The data's own cost: what the screen has to download and parse.
        const fetchStart = Date.now()
        const detail = await request.get(`/api/lists/${id}`)
        const body = await detail.body()
        const fetchMs = Date.now() - fetchStart
        const megabytes = Math.round((body.length / 1048576) * 10) / 10

        await page.goto('/')
        const homeRow = page.locator('.q-home-row', { hasText: `Perf ${count}` })
        await homeRow.waitFor()

        const start = Date.now()
        await homeRow.click()
        await page.locator('.q-item').first().waitFor({ timeout: 10 * 60_000 })
        await page.evaluate(painted)
        const openMs = Date.now() - start

        const result = await measure(page)
        console.log(
          `PERF|${testInfo.project.name}|${count}|${layout.name}|api ${fetchMs} ms / ${megabytes} MB|open ${openMs} ms|elements ${result.elements}|rows ${result.rows}|heap ${result.heapMB ?? '-'} MB|` +
            `frame p50 ${result.frameP50} p95 ${result.frameP95} max ${result.frameMax} (${result.frames} frames, ${result.longTasks} long tasks)|tick ${result.tick} ms|filter ${result.filter} ms`,
        )
      } finally {
        await request.delete(`/api/lists/${id}`)
      }
    })
  }
}
