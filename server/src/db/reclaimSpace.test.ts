import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_FREE_BYTES, MIN_FREE_SHARE, reclaimFreeSpace, worthVacuuming } from './reclaimSpace.js'

/**
 * BL-151: a deleted list's pages stay in the database file as free pages, so the file never shrinks and the old text stays readable in
 * it (the owner's Windows dev database: 31 MB for one list of 77 items, 99.6% free). On start, when the free space is worth it, the
 * file is vacuumed.
 */
describe('worthVacuuming', () => {
  const MIB = 1024 * 1024

  it('needs both a big enough free space and a big enough share of the file', () => {
    // 8 MiB free of 10 MiB: both.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 2560, freelistCount: 2048 })).toBe(true)
    // 8 MiB free but of 100 MiB: a small share, left alone.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 25600, freelistCount: 2048 })).toBe(false)
    // Most of the file free, but only 1 MiB of it: not worth the rewrite.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 300, freelistCount: 256 })).toBe(false)
  })

  it('has its edges where the constants say', () => {
    expect(MIN_FREE_BYTES).toBe(8 * MIB)
    expect(MIN_FREE_SHARE).toBe(0.25)
    const pages = MIN_FREE_BYTES / 4096
    expect(worthVacuuming({ pageSize: 4096, pageCount: pages * 4, freelistCount: pages })).toBe(true)
    expect(worthVacuuming({ pageSize: 4096, pageCount: pages * 4, freelistCount: pages - 1 })).toBe(false)
    expect(worthVacuuming({ pageSize: 4096, pageCount: pages * 4 + 4, freelistCount: pages })).toBe(false)
  })

  it('is false for an empty or unreadable count', () => {
    expect(worthVacuuming({ pageSize: 4096, pageCount: 0, freelistCount: 0 })).toBe(false)
    expect(worthVacuuming({ pageSize: 0, pageCount: 10, freelistCount: 10 })).toBe(false)
  })
})

describe('reclaimFreeSpace', () => {
  let directory: string
  let path: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'listulator-reclaim-'))
    path = join(directory, 'listulator.sqlite')
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  /** A database like the owner's: a few live rows, and a big list that was imported and deleted. */
  function makeBloated(deleteBigList = true) {
    const connection = new Database(path)
    connection.pragma('journal_mode = WAL')
    connection.exec('CREATE TABLE lists (id TEXT PRIMARY KEY, title TEXT)')
    connection.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, list_id TEXT, title TEXT)')
    connection.exec(`INSERT INTO lists VALUES ('keep', 'Kept'), ('big', 'Big test list')`)
    const insert = connection.prepare('INSERT INTO items (list_id, title) VALUES (?, ?)')
    connection.transaction(() => {
      for (let n = 0; n < 77; n += 1) insert.run('keep', `Kept item ${n}`)
      for (let n = 0; n < 60_000; n += 1) insert.run('big', `Midnight Harbor #${n} ${'x'.repeat(120)}`)
    })()
    if (deleteBigList) connection.exec(`DELETE FROM items WHERE list_id = 'big'; DELETE FROM lists WHERE id = 'big'`)
    connection.pragma('wal_checkpoint(TRUNCATE)')
    connection.close()
  }

  it('shrinks a file that is mostly free pages, keeps every live row, and leaves nothing of the deleted list in it', () => {
    makeBloated()
    const before = statSync(path).size
    expect(before).toBeGreaterThan(MIN_FREE_BYTES)

    const result = reclaimFreeSpace(path)

    expect(result.vacuumed).toBe(true)
    expect(result.bytesBefore).toBe(before)
    expect(statSync(path).size).toBeLessThan(before / 20)
    const connection = new Database(path, { readonly: true })
    expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(connection.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 77 })
    expect(connection.prepare('SELECT count(*) AS n FROM lists').get()).toEqual({ n: 1 })
    expect(connection.pragma('freelist_count', { simple: true })).toBe(0)
    connection.close()
    expect(readFileSync(path).includes('Midnight Harbor')).toBe(false)
  })

  it('leaves a file alone that has no worthwhile free space: same bytes, no rewrite', () => {
    makeBloated(false)
    const before = statSync(path).size

    const result = reclaimFreeSpace(path)

    expect(result.vacuumed).toBe(false)
    expect(statSync(path).size).toBe(before)
  })

  it('does nothing, and does not create a file, for a database that is not there or is in memory', () => {
    expect(reclaimFreeSpace(join(directory, 'missing.sqlite')).vacuumed).toBe(false)
    expect(existsSync(join(directory, 'missing.sqlite'))).toBe(false)
    expect(reclaimFreeSpace(':memory:').vacuumed).toBe(false)
  })

  it('gives up quietly when another connection holds the database, and the file is as it was', () => {
    makeBloated()
    const before = statSync(path).size
    const other = new Database(path)
    other.exec('BEGIN EXCLUSIVE')

    const result = reclaimFreeSpace(path, { busyMs: 50 })

    other.exec('ROLLBACK')
    other.close()
    expect(result.vacuumed).toBe(false)
    expect(result.error).toBeDefined()
    expect(statSync(path).size).toBe(before)
  })

  it('gives up quietly on a file that is not a database', () => {
    writeFileSync(path, 'this is not a database'.repeat(1000))

    expect(reclaimFreeSpace(path).vacuumed).toBe(false)
  })
})
