import Fastify, { type FastifyInstance } from 'fastify'
import { authRoutes } from './auth/routes.js'
import { currentUserPlugin } from './auth/currentUser.js'
import { catalogRoutes } from './catalog/routes.js'
import { createRuntimeFiller, createSourceLimiters, type RuntimeFiller, type RuntimeFillDeps } from './catalog/runtimeFill.js'
import type { ServerConfig } from './config.js'
import type { AppDatabase } from './db/client.js'
import { createMediaTypeRegistry, type MediaTypeRegistry } from './ingestion/mediaTypes.js'
import { ingestionRoutes } from './ingestion/routes.js'
import { suggestionsRoutes } from './suggestions/routes.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** Looks up the lengths of items a list was built without (task 15.5); one per app. */
    runtimeFiller: RuntimeFiller
  }
}

export interface AppDependencies {
  db: AppDatabase
  config: ServerConfig
  /** Defaults to the built-in categories; injectable so tests can add one. */
  mediaTypes?: MediaTypeRegistry
  /** Overridable so tests can rank against fixture strategy files. */
  strategiesDir?: string
  /** Overridable so tests can scan a fixture directory instead of the real one. */
  listsDropDir?: string
  /** Overridable so tests can fake the clock, the waits and the pacing of the background lookup of lengths. */
  runtimeFill?: Partial<Omit<RuntimeFillDeps, 'db' | 'mediaTypes' | 'signal'>>
}

/**
 * Builds the Fastify app without starting it, so tests can inject requests
 * directly (`app.inject(...)`) rather than binding a port.
 */
export function buildApp({
  db,
  config,
  mediaTypes = createMediaTypeRegistry(),
  strategiesDir,
  listsDropDir,
  runtimeFill,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false })

  // The background lookup of lengths for lists built from a listing: one runner for the app, with one
  // pacing limiter per source shared by every list, stopped when the app closes.
  const shutdown = new AbortController()
  app.decorate(
    'runtimeFiller',
    createRuntimeFiller({
      db,
      mediaTypes: mediaTypes.list(),
      limiterFor: createSourceLimiters(),
      signal: shutdown.signal,
      ...runtimeFill,
    }),
  )
  app.addHook('onClose', async () => shutdown.abort())

  // Infrastructure probe, deliberately outside /api and outside auth.
  app.get('/health', () => ({ status: 'ok' }))

  // Everything the app itself exposes lives under /api (the web dev server
  // proxies /api here). The current-user resolver wraps this whole scope, so
  // every capability router registered inside it gets a resolved user.
  app.register(
    async (api) => {
      await api.register(currentUserPlugin, { db, config })
      await api.register(authRoutes)
      await api.register(catalogRoutes, { db, mediaTypes })
      await api.register(ingestionRoutes, { db, mediaTypes, ...(listsDropDir ? { listsDropDir } : {}) })
      await api.register(suggestionsRoutes, { db, ...(strategiesDir ? { strategiesDir } : {}) })
    },
    { prefix: '/api' },
  )

  return app
}
