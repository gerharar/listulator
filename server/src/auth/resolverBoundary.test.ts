import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * SPEC.md §11: every handler must obtain the current user from the resolver.
 * If a handler reaches for the `users` table, the single-user flag, or the raw
 * request property instead, flipping SINGLE_USER_MODE stops being a config
 * change and becomes a refactor — which is the whole promise this guards.
 *
 * These are source-level checks, so they catch the mistake at the moment it is
 * written rather than when multi-tenancy is switched on much later.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [path]
  })
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  contents: readFileSync(path, 'utf8'),
}))

function offenders(allowed: string[], matches: (contents: string) => boolean): string[] {
  return files
    .filter(({ path }) => !allowed.includes(path))
    .filter(({ contents }) => matches(contents))
    .map(({ path }) => path)
}

describe('current-user resolver boundary', () => {
  it('finds source files to check', () => {
    // Guards against the walk silently matching nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(5)
  })

  it('keeps the users table inside the auth and db modules', () => {
    const allowed = ['db/schema.ts', 'db/client.ts', 'auth/currentUser.ts']

    // Matches code that actually reaches for the table — a named import of
    // `users`, or `schema.users` — rather than the word appearing in prose.
    // The first version matched any occurrence and fired on a doc comment.
    const importsUsersTable = /import\s*(?:type\s*)?\{[^}]*\busers\b[^}]*\}\s*from/
    const accessesViaSchema = /\bschema\.users\b/

    expect(
      offenders(
        allowed,
        (contents) => importsUsersTable.test(contents) || accessesViaSchema.test(contents),
      ),
    ).toEqual([])
  })

  it('routes every current-user read through getCurrentUser', () => {
    const allowed = ['auth/currentUser.ts']

    expect(offenders(allowed, (contents) => /\.currentUser\b/.test(contents))).toEqual([])
  })

  it('keeps the single-user-mode flag out of handlers', () => {
    const allowed = ['config.ts', 'auth/currentUser.ts', 'testing/harness.ts']

    expect(offenders(allowed, (contents) => /singleUserMode|SINGLE_USER_MODE/.test(contents))).toEqual(
      [],
    )
  })
})
