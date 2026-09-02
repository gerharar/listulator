import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { loadConfig, type ServerConfig } from '../config.js'
import { createDatabase, runMigrations } from '../db/client.js'
import type { AppDatabase } from '../db/client.js'
import type { MediaTypeRegistry } from '../ingestion/mediaTypes.js'

export interface TestApp {
  app: FastifyInstance
  db: AppDatabase
  /** Path to this instance's SQLite file, for tests that reopen the same data. */
  databasePath: string
  cleanup: () => Promise<void>
}

export interface TestAppOptions extends Partial<ServerConfig> {
  /** Swap in a registry with extra categories, to prove the set is extensible. */
  mediaTypes?: MediaTypeRegistry
}

/**
 * Builds an app against a throwaway SQLite file (not `:memory:`, so the real
 * file/migration path is exercised). Each call gets its own temp directory.
 */
export function createTestApp({ mediaTypes, ...overrides }: TestAppOptions = {}): TestApp {
  const directory = mkdtempSync(join(tmpdir(), 'duldulator-test-'))
  const databasePath = overrides.databasePath ?? join(directory, 'test.sqlite')

  // Empty env so a developer's real SINGLE_USER_MODE can't change test results.
  const config: ServerConfig = { ...loadConfig({}), ...overrides, databasePath }

  const { db, close } = createDatabase(databasePath)
  runMigrations(db)

  const app = buildApp({ db, config, ...(mediaTypes ? { mediaTypes } : {}) })

  return {
    app,
    db,
    databasePath,
    cleanup: async () => {
      await app.close()
      close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
