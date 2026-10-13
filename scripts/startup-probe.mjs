// A diagnostic for the desktop app's start-up (Phase 20, 1.0.1, item 5). It is not part of the app and nothing in the
// build reads it. Start the installed app with WebView2's debug port open, then run this against it:
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
//   & '<install folder>\listulator-desktop.exe'
//   node scripts/startup-probe.mjs            (from the repo root; `--port 9222 --reloads 3`)
//
// It reloads the app's page a few times and prints, for each reload, when the page's own marks happened (DOMContentLoaded, the
// isolation frame added, loaded and ready, the first call to the backend) and what the browser reported about every frame
// (Page lifecycle events, and the separate processes it attached). The question it answers: Tauri's isolation pattern holds
// every backend call until the isolation frame says it is ready, and on Windows the first call goes out 0.5 to 0.8 s after the
// page starts. What is the frame doing in that time?
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)

  return at >= 0 && args[at + 1] ? Number(args[at + 1]) : fallback
}
const port = option('port', 9222)
const reloads = option('reloads', 3)

// Runs in the page before its own scripts, on every load.
function pageMarks() {
  const marks = []
  window.__startupMarks = marks
  const mark = (name, extra) => marks.push([name, Math.round(performance.now()), ...(extra === undefined ? [] : [extra])])
  mark('visibility', document.visibilityState)
  document.addEventListener('visibilitychange', () => mark('visibility', document.visibilityState))
  document.addEventListener('DOMContentLoaded', () => mark('dcl'))
  window.addEventListener('message', (event) => {
    if (event.data === '__TAURI_ISOLATION_READY__') mark('isolation-ready')
  })
  new MutationObserver((_records, observer) => {
    const frame = document.getElementById('__tauri_isolation__')
    if (!frame) return
    mark('isolation-frame-added')
    frame.addEventListener('load', () => mark('isolation-frame-load'))
    observer.disconnect()
  }).observe(document, { childList: true, subtree: true })
  const realFetch = window.fetch
  let first = true
  window.fetch = function (input, ...rest) {
    if (first && String(input instanceof Request ? input.url : input).includes('ipc')) {
      first = false
      mark('first-backend-call')
    }

    return realFetch.call(this, input, ...rest)
  }
  // How late a 50 ms timer runs in the main frame: a page whose timers are held back shows it here.
  let last = performance.now()
  let ticks = 0
  const tick = () => {
    const now = performance.now()
    if (now - last > 90) mark('late-timer', Math.round(now - last))
    last = now
    if (++ticks < 40) setTimeout(tick, 50)
  }
  setTimeout(tick, 50)
}

const browser = await chromium.connectOverCDP(`http://localhost:${port}`)
const page = browser.contexts()[0]?.pages()[0]
if (!page) {
  console.error(`No page found on port ${port}. Is the app running with the debug port open?`)
  process.exit(1)
}
await page.addInitScript(pageMarks)

const session = await browser.contexts()[0].newCDPSession(page)
await session.send('Page.enable')
await session.send('Page.setLifecycleEventsEnabled', { enabled: true })
await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
let events = []
let zero = null
const at = (timestamp) => Math.round((timestamp - zero) * 1000)
session.on('Page.lifecycleEvent', ({ frameId, name, timestamp }) => {
  zero ??= timestamp
  events.push([at(timestamp), `frame ${frameId.slice(0, 4)}`, name])
})
session.on('Target.attachedToTarget', ({ targetInfo }) =>
  events.push(['', `process target ${targetInfo.type}`, targetInfo.url.slice(0, 60)]),
)

for (let run = 1; run <= reloads; run += 1) {
  events = []
  zero = null
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(3000)
  const marks = await page.evaluate(() => window.__startupMarks)
  console.log(`--- reload ${run}`)
  console.log('page marks (ms since the page started):', JSON.stringify(marks))
  console.log('browser lifecycle (ms since the first event):', JSON.stringify(events.filter((event) => event[2] !== 'networkAlmostIdle')))
}
await browser.close()
