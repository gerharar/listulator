import type { FastifyPluginAsync } from 'fastify'
import type { ServerConfig } from './config.js'

/**
 * What the server tells the app about itself, the same for every user (so not `/me`, which is about who is asking): today the switch for
 * drawing only the rows in view on a long list (Phase 25.7). Read from the environment once at start; the app combines it with its own
 * preference and `off` wins.
 */
export const serverSettingsRoutes: FastifyPluginAsync<{ config: ServerConfig }> = async (app, { config }) => {
  app.get('/server-settings', async () => ({ listVirtualization: config.listVirtualization }))
}
