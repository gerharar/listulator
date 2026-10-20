// SPIKE (Phase 31, task 31.2), throwaway: can a script on a GitHub Windows runner reach and drive the real Tauri app through WebView2's
// debugging port? Prints one JSON line with what it found. Usage: node scripts/spike/cdp-probe.mjs <label> [port] [seconds]
import { chromium } from '@playwright/test'

const [label = 'probe', port = '9222', waitSeconds = '90'] = process.argv.slice(2)
const base = `http://127.0.0.1:${port}`
const started = Date.now()
const out = { label, port, reachedAfterMs: null, pages: [], title: null, bodyStart: null, buttons: [], aboutClicked: false, aboutStart: null, error: null }

async function reachable() {
  const deadline = started + Number(waitSeconds) * 1000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

try {
  const version = await reachable()
  if (version === null) throw new Error(`nothing answered on ${base} within ${waitSeconds}s`)
  out.reachedAfterMs = Date.now() - started
  out.browser = version.Browser
  const browser = await chromium.connectOverCDP(base)
  const pages = browser.contexts().flatMap((context) => context.pages())
  out.pages = pages.map((page) => page.url())
  const page = pages.find((candidate) => !candidate.url().startsWith('devtools:')) ?? pages[0]
  if (page === undefined) throw new Error('connected, but the app has no page')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)
  out.title = await page.title()
  out.bodyStart = (await page.locator('body').innerText()).slice(0, 300)
  out.buttons = (await page.getByRole('button').allInnerTexts()).slice(0, 12)
  out.buttonLabels = await page.getByRole('button').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')).filter(Boolean).slice(0, 12))
  const about = page.getByRole('button', { name: 'About', exact: true })
  if ((await about.count()) > 0) {
    await about.first().click()
    out.aboutClicked = true
    await page.waitForTimeout(1500)
    out.aboutStart = (await page.locator('.q-about').first().innerText()).slice(0, 400)
  }
  await browser.close()
} catch (error) {
  out.error = String(error)
}
console.log(JSON.stringify(out))
process.exit(out.error === null ? 0 : 1)
