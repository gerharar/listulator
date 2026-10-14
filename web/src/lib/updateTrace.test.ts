import { describe, expect, it } from 'vitest'
import type { PreferencesStore } from './preferences/store.js'
import { addEntry, createUpdateTrace, summarize, traceStartAfterUpdate, type TraceEntry } from './updateTrace.js'

/** A store in memory that remembers how often it was flushed (the desktop store writes to disk on a flush). */
function fakeStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const store: PreferencesStore & { flushes: number; failWith?: Error } = {
    flushes: 0,
    async get(key) {
      if (store.failWith) throw store.failWith
      return values.get(key)
    },
    async set(key, value) {
      if (store.failWith) throw store.failWith
      values.set(key, value)
    },
    async flush() {
      store.flushes += 1
    },
  }

  return { store, values }
}

const entries = (raw: string | undefined): TraceEntry[] => (JSON.parse(raw ?? '{"entries":[]}') as { entries: TraceEntry[] }).entries

describe('addEntry', () => {
  it('appends to what is there', () => {
    const first = addEntry(undefined, { t: 1, step: 'pressed' })
    const second = addEntry(first, { t: 2, step: 'download-started' })

    expect(entries(second).map((entry) => entry.step)).toEqual(['pressed', 'download-started'])
  })

  it('keeps only the last 30 entries', () => {
    let raw: string | undefined
    for (let i = 0; i < 45; i += 1) raw = addEntry(raw, { t: i, step: `s${i}` })

    expect(entries(raw)).toHaveLength(30)
    expect(entries(raw)[0]?.step).toBe('s15')
    expect(entries(raw).at(-1)?.step).toBe('s44')
  })

  it.each([['not json'], ['{"entries":"nope"}'], ['[1,2,3]'], ['null'], ['']])('starts over from damaged text (%j)', (damaged) => {
    expect(entries(addEntry(damaged, { t: 1, step: 'pressed' })).map((entry) => entry.step)).toEqual(['pressed'])
  })
})

describe('summarize', () => {
  const run: TraceEntry[] = [
    { t: 1_000, step: 'pressed', version: '1.0.2', detail: '1.0.3' },
    { t: 1_100, step: 'download-started', version: '1.0.2' },
    { t: 3_100, step: 'download-finished', version: '1.0.2' },
    { t: 7_300, step: 'new-app-start', version: '1.0.3', detail: 'from 1.0.2' },
    { t: 7_440, step: 'new-app-first-paint', version: '1.0.3' },
    { t: 8_100, step: 'new-app-lists-drawn', version: '1.0.3' },
  ]

  it('says how long each part took, from the last mark of the old app to the lists in the new one', () => {
    expect(summarize(run)).toBe(
      '1.0.2 to 1.0.3: download 2.0 s; last mark in the old app to the new page 4.2 s; new page to first paint 0.14 s; to lists drawn 0.80 s',
    )
  })

  it('uses n/a for a part it has no marks for (the first update, made by an app without the log)', () => {
    const start: TraceEntry = { t: 7_300, step: 'new-app-start', version: '1.0.3', detail: 'from unknown' }

    expect(summarize([start, ...run.slice(4)])).toBe(
      'unknown to 1.0.3: download n/a; last mark in the old app to the new page n/a; new page to first paint 0.14 s; to lists drawn 0.80 s',
    )
  })

  it('says nothing when there is no start of a new app', () => {
    expect(summarize(run.slice(0, 3))).toBe('')
    expect(summarize([])).toBe('')
  })

  it('reads the latest update only', () => {
    const older: TraceEntry[] = [
      { t: 10, step: 'download-started', version: '1.0.0' },
      { t: 20, step: 'download-finished', version: '1.0.0' },
      { t: 30, step: 'new-app-start', version: '1.0.1', detail: 'from 1.0.0' },
    ]

    expect(summarize([...older, ...run])).toContain('1.0.2 to 1.0.3: download 2.0 s')
  })
})

describe('createUpdateTrace', () => {
  it('records each step in order with the time, the running version, and writes it out at once', async () => {
    const { store, values } = fakeStore()
    let now = 100
    const trace = createUpdateTrace(store, () => (now += 10), '1.0.2')

    await trace.record('pressed', '1.0.3')
    await trace.record('download-started')

    expect(entries(values.get('updateTrace'))).toEqual([
      { t: 110, step: 'pressed', version: '1.0.2', detail: '1.0.3' },
      { t: 120, step: 'download-started', version: '1.0.2' },
    ])
    expect(store.flushes).toBe(2)
  })

  it('keeps the order of steps asked for without waiting for each other', async () => {
    const { store, values } = fakeStore()
    const trace = createUpdateTrace(store, () => 1, '1.0.2')

    void trace.record('a')
    void trace.record('b')
    await trace.record('c')

    expect(entries(values.get('updateTrace')).map((entry) => entry.step)).toEqual(['a', 'b', 'c'])
  })

  it('takes a time given by the caller', async () => {
    const { store, values } = fakeStore()

    await createUpdateTrace(store, () => 5, '1.0.2').record('new-app-first-paint', undefined, 999)

    expect(entries(values.get('updateTrace'))[0]?.t).toBe(999)
  })

  it('never throws, and never blocks a later step, when the store fails', async () => {
    const { store, values } = fakeStore()
    const trace = createUpdateTrace(store, () => 1, '1.0.2')
    store.failWith = new Error('disk full')

    await expect(trace.record('pressed')).resolves.toBeUndefined()
    store.failWith = undefined
    await trace.record('download-started')

    expect(entries(values.get('updateTrace')).map((entry) => entry.step)).toEqual(['download-started'])
  })
})

describe('traceStartAfterUpdate', () => {
  const paint = async () => ({ firstPaint: 140, lastPaint: 660 })
  const instant = async () => undefined

  it('does nothing on a start of the same version as the last one', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.0.3' })

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait: instant, version: '1.0.3' })

    expect(values.get('updateTrace')).toBeUndefined()
    expect(store.flushes).toBe(0)
  })

  it('records the new app\'s start, first paint and lists, from the page\'s own clock, and says which version it came from', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.0.2' })

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait: instant, version: '1.0.3' })

    expect(entries(values.get('updateTrace'))).toEqual([
      { t: 5_000, step: 'new-app-start', version: '1.0.3', detail: 'from 1.0.2' },
      { t: 5_140, step: 'new-app-first-paint', version: '1.0.3' },
      { t: 5_660, step: 'new-app-lists-drawn', version: '1.0.3' },
    ])
    expect(values.get('lastRunVersion')).toBe('1.0.3')
  })

  it('writes the summary next to the entries', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.0.2' })

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait: instant, version: '1.0.3' })

    expect(values.get('updateTraceSummary')).toBe(
      '1.0.2 to 1.0.3: download n/a; last mark in the old app to the new page n/a; new page to first paint 0.14 s; to lists drawn 0.66 s',
    )
  })

  it('counts a store that has never recorded a version as "from unknown"', async () => {
    const { store, values } = fakeStore()

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait: instant, version: '1.0.3' })

    expect(entries(values.get('updateTrace'))[0]?.detail).toBe('from unknown')
  })

  it('remembers the version before it waits, so a start that is cut short is not recorded twice', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.0.2' })
    let remembered: string | undefined
    const wait = async () => {
      remembered = values.get('lastRunVersion')
    }

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait, version: '1.0.3' })

    expect(remembered).toBe('1.0.3')
  })

  it('keeps the start when the paint times cannot be read', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.0.2' })

    await traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: async () => ({}), wait: instant, version: '1.0.3' })

    expect(entries(values.get('updateTrace')).map((entry) => entry.step)).toEqual(['new-app-start'])
  })

  it('never throws when the store fails', async () => {
    const { store } = fakeStore({ lastRunVersion: '1.0.2' })
    store.failWith = new Error('disk full')

    await expect(
      traceStartAfterUpdate({ store, now: () => 9, timeOrigin: 5_000, readPaint: paint, wait: instant, version: '1.0.3' }),
    ).resolves.toBeUndefined()
  })
})
