import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDependencies } from '../app.js'
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
  /** Point at fixture strategy files instead of the shipped ones. */
  strategiesDir?: string
  /** Point at a fixture drop folder instead of the real one. */
  listsDropDir?: string
  /** Fake the clock, the waits and the pacing of the background lookup of lengths. */
  runtimeFill?: AppDependencies['runtimeFill']
}

/**
 * Builds an app against a throwaway SQLite file (not `:memory:`, so the real
 * file/migration path is exercised). Each call gets its own temp directory.
 */
export function createTestApp({
  mediaTypes,
  strategiesDir,
  listsDropDir,
  runtimeFill,
  ...overrides
}: TestAppOptions = {}): TestApp {
  const directory = mkdtempSync(join(tmpdir(), 'listulator-test-'))
  const databasePath = overrides.databasePath ?? join(directory, 'test.sqlite')

  // Empty env so a developer's real SINGLE_USER_MODE can't change test results.
  const config: ServerConfig = { ...loadConfig({}), ...overrides, databasePath }

  const { db, close } = createDatabase(databasePath)
  runMigrations(db)

  const app = buildApp({
    db,
    config,
    ...(mediaTypes ? { mediaTypes } : {}),
    ...(strategiesDir ? { strategiesDir } : {}),
    ...(listsDropDir ? { listsDropDir } : {}),
    ...(runtimeFill ? { runtimeFill } : {}),
  })

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
