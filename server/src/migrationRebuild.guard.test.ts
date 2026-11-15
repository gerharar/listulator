import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No migration may rebuild a table until the desktop applies a migration in one transaction (Phase 53, task 53.4).
 *
 * On the desktop `runLocalMigrations` (web/src/lib/db/localDb.ts) applies a migration statement by statement, each its own commit,
 * with progress rows. A table rebuild (create a new table, copy, `DROP TABLE` the old, `RENAME TO`) is several such commits, and one
 * that stops half-way leaves the library in a state the next start cannot open. With foreign keys on, dropping a parent table also
 * deletes its children. All of the migrations so far only add things. Phase 52 backs the file up before a new version migrates it
 * (backup.rs); this guard is the other half, and 53.4 lifts it, in the same change that makes the desktop's migrations atomic.
 *
 * docs/tasks/plan.md: Phase 52 (task 52.2) and Phase 53 (task 53.4).
 */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { name: 'RENAME TO', pattern: /\bRENAME\s+TO\b/i },
  { name: 'PRAGMA foreign_keys', pattern: /\bPRAGMA\s+foreign_keys\b/i },
]

/** The names of the forbidden statements in `sql`, outside its comments (a comment may explain what a migration does not do). */
function forbiddenIn(sql: string): string[] {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ')

  return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name)
}

function explain(file: string, found: string[]): string {
  return (
    `${file} uses ${found.join(', ')}. On the desktop a migration is applied statement by statement, each its own commit, so a table ` +
    `rebuild is several commits and one that stops half-way loses data; with foreign keys on, dropping a parent table deletes its ` +
    `children. Do not rebuild a table until Phase 53 makes the desktop's migrations atomic: docs/tasks/plan.md, Phase 52 (task 52.2) ` +
    `explains this guard and task 53.4 lifts it.`
  )
}

const folder = fileURLToPath(new URL('../drizzle/', import.meta.url))

describe('the migrations in server/drizzle', () => {
  it('rebuild no table (no DROP TABLE, RENAME TO or PRAGMA foreign_keys)', () => {
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql'))
    expect(files.length, 'the migrations are where this guard looks').toBeGreaterThan(20)

    const offences = files.flatMap((file) => {
      const found = forbiddenIn(readFileSync(folder + file, 'utf8'))

      return found.length > 0 ? [explain(file, found)] : []
    })

    expect(offences).toEqual([])
  })
})

describe('the rule itself', () => {
  it.each([
    ['DROP TABLE', 'DROP TABLE `lists`;'],
    ['RENAME TO', 'ALTER TABLE `lists_new` RENAME TO `lists`;'],
    ['PRAGMA foreign_keys', 'PRAGMA foreign_keys=OFF;'],
  ])('stops a migration with %s', (name, sql) => {
    expect(forbiddenIn(sql)).toEqual([name])
  })

  it('does not care about case or the space between the words', () => {
    expect(forbiddenIn('drop   table lists;')).toEqual(['DROP TABLE'])
    expect(forbiddenIn('ALTER TABLE a rename\n  to b;')).toEqual(['RENAME TO'])
    expect(forbiddenIn('pragma Foreign_Keys = on;')).toEqual(['PRAGMA foreign_keys'])
  })

  it('reports each forbidden statement once, in a migration that has several', () => {
    const rebuild =
      'PRAGMA foreign_keys=OFF;\nCREATE TABLE t_new (id integer);\nDROP TABLE t;\nALTER TABLE t_new RENAME TO t;\nDROP TABLE u;'

    expect(forbiddenIn(rebuild)).toEqual(['DROP TABLE', 'RENAME TO', 'PRAGMA foreign_keys'])
  })

  it('leaves what only adds alone, and what a comment says', () => {
    expect(
      forbiddenIn(
        'CREATE TABLE `x` (`id` integer);\n--> statement-breakpoint\nALTER TABLE `x` ADD `y` text;',
      ),
    ).toEqual([])
    expect(
      forbiddenIn('-- no DROP TABLE here, and no RENAME TO\nCREATE INDEX i ON t (a);'),
    ).toEqual([])
    expect(forbiddenIn('/* DROP TABLE t */ CREATE INDEX i ON t (a);')).toEqual([])
  })

  it('says why, and which plan tasks hold and lift it', () => {
    const message = explain('0099_rebuild.sql', ['DROP TABLE'])

    expect(message).toContain('0099_rebuild.sql')
    expect(message).toContain('statement by statement')
    expect(message).toContain('foreign keys')
    expect(message).toContain('Phase 52')
    expect(message).toContain('53.4')
  })
})
