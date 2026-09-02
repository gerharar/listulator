import type { FastifyPluginAsync } from 'fastify'
import { getCurrentUser } from './currentUser.js'

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', async (request) => {
    const user = getCurrentUser(request)

    return {
      id: user.id,
      isDefaultLocalUser: user.isDefaultLocalUser,
    }
  })
}
