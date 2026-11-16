import { describe, expect, it } from 'vitest'
import { AtomicBatchError } from './atomic.js'
import { isDatabaseBusy, retryWhenBusy } from './busy.js'

/**
 * Phase 53, the background writers: a write that finds the file locked by a long rewrite (a Reset or an import holds the write lock for about
 * 4 s per 50,000 inserts, the plugin's connections wait 5 s) is asked again a few times before it gives up. A write the database refused for
 * the lock changed nothing, so asking again is safe; one it refused for any other reason is never asked again.
 */
const locked = () => new Error('error returned from database: (code: 5) database is locked')

describe('isDatabaseBusy', () => {
  it('knows the lock in the words the desktop, the server and the batch give it', () => {
    expect(isDatabaseBusy(locked())).toBe(true)
    // The plugin rejects with a bare string.
    expect(isDatabaseBusy('error returned from database: (code: 5) database is locked')).toBe(true)
    // better-sqlite3 on the server.
    expect(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })).toSatisfy(isDatabaseBusy)
    // Drizzle wraps the driver's error and keeps it as the cause.
    expect(isDatabaseBusy(new Error('Failed query: update ...', { cause: locked() }))).toBe(true)
    // The native batch: the command's own message, carried by an AtomicBatchError.
    expect(isDatabaseBusy(new AtomicBatchError(undefined, 'database is locked'))).toBe(true)
    expect(isDatabaseBusy(new AtomicBatchError(3, '(code: 5) database is locked'))).toBe(true)
  })

  it('does not take any other failure for the lock', () => {
    expect(isDatabaseBusy(new Error('UNIQUE constraint failed: lists.id'))).toBe(false)
    expect(isDatabaseBusy(new Error('database disk image is malformed'))).toBe(false)
    expect(isDatabaseBusy(new Error('table is locked by another connection'))).toBe(false)
    expect(isDatabaseBusy(undefined)).toBe(false)
    expect(isDatabaseBusy({ message: 'database is locked' })).toBe(false)
  })
})

describe('retryWhenBusy', () => {
  it('asks again after the lock and gives the answer of the attempt that worked', async () => {
    const waits: number[] = []
    let attempts = 0

    const answer = await retryWhenBusy(
      async () => {
        attempts += 1
        if (attempts < 3) throw locked()

        return 'done'
      },
      { waitMs: 250, sleep: async (ms) => void waits.push(ms) },
    )

    expect(answer).toBe('done')
    expect(attempts).toBe(3)
    expect(waits).toEqual([250, 250])
  })

  it('gives up after its retries with the last lock error, unchanged', async () => {
    let attempts = 0
    const error = locked()

    await expect(
      retryWhenBusy(async () => {
        attempts += 1
        throw error
      }, { retries: 3, sleep: async () => {} }),
    ).rejects.toBe(error)

    expect(attempts).toBe(4)
  })

  it('does not ask again after any other failure', async () => {
    let attempts = 0
    const error = new Error('UNIQUE constraint failed: lists.id')

    await expect(
      retryWhenBusy(async () => {
        attempts += 1
        throw error
      }, { sleep: async () => {} }),
    ).rejects.toBe(error)

    expect(attempts).toBe(1)
  })

  it('does not wait at all when the first attempt works', async () => {
    const waits: number[] = []

    expect(await retryWhenBusy(async () => 7, { sleep: async (ms) => void waits.push(ms) })).toBe(7)
    expect(waits).toEqual([])
  })
})
