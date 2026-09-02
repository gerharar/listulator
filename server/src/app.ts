import Fastify, { type FastifyInstance } from 'fastify'

/**
 * Builds the Fastify app without starting it, so tests can inject requests
 * directly (`app.inject(...)`) rather than binding a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  // Infrastructure probe, deliberately outside /api.
  app.get('/health', () => ({ status: 'ok' }))

  // Application routes live under /api (the web dev server proxies /api here);
  // capability routers get registered on this prefix as they land.

  return app
}
