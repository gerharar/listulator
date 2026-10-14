import { APP_VERSION } from './appVersion.js'
import { getPreferencesStore, type PreferencesStore } from './preferences/store.js'

/**
 * A temporary diagnostic (BL-092, 1.0.2): how long an app update takes and where the time goes, written where the owner can read
 * it. Remove it in the release after the one that measures an update with it (BACKLOG BL-093 lists the files).
 *
 * It lives in the app's own `preferences.json` (the data folder, `%APPDATA%\com.listulator.desktop` on Windows), under three keys:
 * `updateTrace` (the marks, as JSON), `updateTraceSummary` (one line a person can read) and `lastRunVersion`. It uses the store
 * the app already writes, so it adds no native command, hook rule or capability. A trace never changes what an update does: every
 * failure is swallowed.
 *
 * The old app writes the marks of the download (`pressed`, `download-started`, `download-90%`, `download-finished`, and on macOS
 * `install-returned`, `relaunch-called`); the new app, at its first start of a new version, writes `new-app-start`,
 * `new-app-first-paint` and `new-app-lists-drawn` from the page's own clock. A version only marks the update it performs, so the
 * first update to a version that has this (made by one that has not) shows the new app's side only.
 */
const TRACE_KEY = 'updateTrace'
const SUMMARY_KEY = 'updateTraceSummary'
const LAST_RUN_KEY = 'lastRunVersion'
const MAX_ENTRIES = 30
/** How long after the start the paint times are read: the lists are on screen well before. */
const SETTLE_MS = 4000

export interface TraceEntry {
  /** Epoch milliseconds (`Date.now()`), so marks of two processes can be set against each other. */
  t: number
  step: string
  /** The version of the app that wrote the mark. */
  version?: string
  detail?: string
}

function parseEntries(raw: string | undefined): TraceEntry[] {
  try {
    const parsed = JSON.parse(raw ?? '') as { entries?: unknown } | null
    return Array.isArray(parsed?.entries) ? (parsed.entries as TraceEntry[]) : []
  } catch {
    return []
  }
}

/** The stored text with one more entry; the last 30 are kept, and damaged text starts a new trace. */
export function addEntry(raw: string | undefined, entry: TraceEntry): string {
  return JSON.stringify({ entries: [...parseEntries(raw), entry].slice(-MAX_ENTRIES) })
}

const seconds = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(2))
const span = (from: TraceEntry | undefined, to: TraceEntry | undefined): string => (from && to ? `${seconds(to.t - from.t)} s` : 'n/a')

/** One line about the latest update: what the old app marked, then what the new one did. Empty before a new app has started. */
export function summarize(entries: TraceEntry[]): string {
  const startAt = entries.map((entry) => entry.step).lastIndexOf('new-app-start')
  if (startAt < 0) return ''

  const start = entries[startAt]!
  const before: TraceEntry[] = []
  for (let i = startAt - 1; i >= 0 && !entries[i]!.step.startsWith('new-app-'); i -= 1) before.unshift(entries[i]!)
  const after = entries.slice(startAt + 1)
  const find = (list: TraceEntry[], step: string) => list.find((entry) => entry.step === step)
  const from = start.detail?.replace(/^from /, '') ?? 'unknown'

  return [
    `${from} to ${start.version ?? 'unknown'}:`,
    `download ${span(find(before, 'download-started'), find(before, 'download-finished'))};`,
    `last mark in the old app to the new page ${span(before.at(-1), start)};`,
    `new page to first paint ${span(start, find(after, 'new-app-first-paint'))};`,
    `to lists drawn ${span(start, find(after, 'new-app-lists-drawn'))}`,
  ].join(' ')
}

export interface UpdateTrace {
  /** Records one step. Resolves when it is written (or has failed); never rejects. Steps are written in the order asked for. */
  record(step: string, detail?: string, at?: number): Promise<void>
}

export function createUpdateTrace(store: PreferencesStore = getPreferencesStore(), now: () => number = Date.now, version: string = APP_VERSION): UpdateTrace {
  let queue: Promise<void> = Promise.resolve()

  return {
    record(step, detail, at) {
      const entry: TraceEntry = { t: at ?? now(), step, version, ...(detail === undefined ? {} : { detail }) }
      queue = queue.then(async () => {
        try {
          await store.set(TRACE_KEY, addEntry(await store.get(TRACE_KEY), entry))
          // The Windows installer ends the app a moment after the download: autosave alone could lose the mark.
          await store.flush?.()
        } catch {
          // A diagnostic must never get in the way of an update.
        }
      })

      return queue
    },
  }
}

interface PaintTimes {
  firstPaint?: number
  lastPaint?: number
}

/** The page's first contentful paint and its last (largest) one, which on this app is the lists. */
async function readPaintTimes(): Promise<PaintTimes> {
  const firstPaint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')?.startTime
  const lastPaint = await new Promise<number | undefined>((resolve) => {
    try {
      const observer = new PerformanceObserver((list) => {
        resolve(list.getEntries().at(-1)?.startTime)
        observer.disconnect()
      })
      observer.observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => resolve(undefined), 300)
    } catch {
      resolve(undefined)
    }
  })

  return { ...(firstPaint === undefined ? {} : { firstPaint }), ...(lastPaint === undefined ? {} : { lastPaint }) }
}

export interface StartAfterUpdateOptions {
  store?: PreferencesStore
  now?: () => number
  /** When this page started (`performance.timeOrigin`), epoch milliseconds. */
  timeOrigin?: number
  readPaint?: () => Promise<PaintTimes>
  wait?: (ms: number) => Promise<void>
  version?: string
}

/**
 * At the first start of a version (the version differs from the one the last run recorded): marks the page's start, then, once the
 * lists are on screen, its first paint and the lists, and writes the summary line. Does nothing on every later start.
 */
export async function traceStartAfterUpdate({
  store = getPreferencesStore(),
  now = Date.now,
  timeOrigin = performance.timeOrigin,
  readPaint = readPaintTimes,
  wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  version = APP_VERSION,
}: StartAfterUpdateOptions = {}): Promise<void> {
  try {
    const last = await store.get(LAST_RUN_KEY)
    if (last === version) return

    // Remembered first, so a start that is closed before the wait ends is not marked again at the next start.
    await store.set(LAST_RUN_KEY, version)
    const trace = createUpdateTrace(store, now, version)
    await trace.record('new-app-start', `from ${last ?? 'unknown'}`, Math.round(timeOrigin))

    await wait(SETTLE_MS)
    const { firstPaint, lastPaint } = await readPaint()
    if (firstPaint !== undefined) await trace.record('new-app-first-paint', undefined, Math.round(timeOrigin + firstPaint))
    if (lastPaint !== undefined) await trace.record('new-app-lists-drawn', undefined, Math.round(timeOrigin + lastPaint))

    await store.set(SUMMARY_KEY, summarize(parseEntries(await store.get(TRACE_KEY))))
    await store.flush?.()
  } catch {
    // Not recording is the only thing that can go wrong here.
  }
}
