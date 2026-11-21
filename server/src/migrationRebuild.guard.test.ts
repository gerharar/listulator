import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No migration may rebuild a table yet. Phase 52 (task 52.2) put this guard up and Phase 53 (task 53.4) kept it, on purpose.
 *
 * What 53.4 made safe: the DESKTOP. `runLocalMigrations` (web/src/lib/db/localDb.ts) now applies a migration file and its tag row in one
 * transaction (the native `sql_batch`), and a file that rebuilds a table (drizzle-kit writes `PRAGMA foreign_keys=OFF;` ... `DROP TABLE`,
 * `RENAME TO` ... `PRAGMA foreign_keys=ON;`) runs with foreign keys off on a connection of its own and is checked before it commits, so a
 * half-done rebuild cannot be left behind and the children of the dropped parent are not deleted. (Tested there with a fixture; no real
 * migration rebuilds anything.)
 *
 * What it did not: the SERVER. `runMigrations` (server/src/db/client.ts) is drizzle's own migrator for better-sqlite3, which runs every
 * pending file inside one transaction, where `PRAGMA foreign_keys=OFF` does nothing: a rebuild there would still delete the children of a
 * dropped parent, in the self-hosted server's file and in the dev database the end-to-end tests use. The server is unsupported, but its
 * tests and the owner's dev database run these files, so the guard stays until the first rebuild is actually needed. Lifting it then means
 * making the server's runner turn enforcement off before its transaction and run `PRAGMA foreign_key_check` before it commits, and
 * allowing a rebuild only in a file that carries drizzle-kit's `PRAGMA foreign_keys` lines (the marker the desktop's runner looks for).
 *
 * All of the migrations so far only add things. docs/tasks/plan-complete.md: Phase 52 (task 52.2) and Phase 53 (task 53.4).
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
    `${file} uses ${found.join(', ')}. The desktop applies a migration in one transaction and runs a table rebuild with foreign keys off ` +
    `(Phase 53, task 53.4), but the server's migrator runs every pending file in one transaction where that pragma does nothing, so a ` +
    `rebuild there still deletes the children of the dropped parent. Make the server's runner turn enforcement off before its transaction ` +
    `and check the foreign keys before it commits, then relax this guard: docs/tasks/plan-complete.md, Phase 53 (task 53.4), and docs/DECISIONS.md "53.4 built".`
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
    expect(message).toContain("server's migrator")
    expect(message).toContain('foreign keys')
    expect(message).toContain('Phase 53')
    expect(message).toContain('53.4')
    expect(message).toContain('DECISIONS')
  })
})
