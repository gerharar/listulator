import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The guide that says where the desktop app's backups are and how to put one back (Phase 52, task 52.3) must say what `backup.rs`
 * writes: a folder name, a file name or a number changed in one place and not the other sends someone to a folder that is not there.
 * The app's half is Rust, so this reads its source.
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8')

const backup = read('apps/desktop/src-tauri/src/backup.rs')
const vacuum = read('apps/desktop/src-tauri/src/vacuum.rs')
const guide = read('guides/restore-a-backup.md')

function constant(source: string, name: string): string {
  const value = new RegExp(`pub const ${name}: (?:&str|usize|u64) = "?([^";]+)"?;`).exec(
    source,
  )?.[1]
  expect(value, `${name} is a plain constant in the Rust source`).toBeDefined()

  return value!
}

describe('guides/restore-a-backup.md', () => {
  it('names the folder, the file shape and the database file that backup.rs and vacuum.rs use', () => {
    expect(guide).toContain(`${constant(backup, 'BACKUP_FOLDER')}`)
    expect(guide).toContain(
      `${constant(backup, 'PREFIX')}<version>-<date>-<time>${constant(backup, 'SUFFIX')}`,
    )
    const database = constant(vacuum, 'DATABASE_FILE')
    expect(guide).toContain(`\`${database}\``)
    // A copy is not WAL, but the file it replaces may have these beside it, and they must be moved aside with it.
    expect(guide).toContain(`\`${database}-wal\``)
    expect(guide).toContain(`\`${database}-shm\``)
  })

  it('says how many copies are kept', () => {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five']
    expect(guide).toContain(`newest ${words[Number(constant(backup, 'KEEP'))]}`)
  })

  it('gives the data folder of the installed app on macOS and Windows, by the identifier the app is built with', () => {
    const identifier = (
      JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { identifier: string }
    ).identifier

    expect(guide).toContain(`~/Library/Application Support/${identifier}/backups`)
    expect(guide).toContain(`%APPDATA%\\${identifier}\\backups`)
  })

  it('is listed in the guides index', () => {
    expect(read('guides/README.md')).toContain('(restore-a-backup.md)')
  })
})
