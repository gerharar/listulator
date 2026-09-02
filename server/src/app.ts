import Fastify, { type FastifyInstance } from 'fastify'
import { authRoutes } from './auth/routes.js'
import { currentUserPlugin } from './auth/currentUser.js'
import { catalogRoutes } from './catalog/routes.js'
import type { ServerConfig } from './config.js'
import type { AppDatabase } from './db/client.js'

export interface AppDependencies {
  db: AppDatabase
  config: ServerConfig
}

/**
 * Builds the Fastify app without starting it, so tests can inject requests
 * directly (`app.inject(...)`) rather than binding a port.
 */
export function buildApp({ db, config }: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false })

  // Infrastructure probe, deliberately outside /api and outside auth.
  app.get('/health', () => ({ status: 'ok' }))

  // Everything the app itself exposes lives under /api (the web dev server
  // proxies /api here). The current-user resolver wraps this whole scope, so
  // every capability router registered inside it gets a resolved user.
  app.register(
    async (api) => {
      await api.register(currentUserPlugin, { db, config })
      await api.register(authRoutes)
      await api.register(catalogRoutes, { db })
    },
    { prefix: '/api' },
  )

  return app
}
