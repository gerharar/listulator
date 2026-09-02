import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { AppDatabase } from '../db/client.js'
import { users, type User } from '../db/schema.js'
import type { ServerConfig } from '../config.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `currentUserPlugin`. Read it via `getCurrentUser`, not directly. */
    currentUser?: User
  }
}

/**
 * Finds the single local user, creating it on first boot.
 *
 * The unique index on `is_default_local_user` means a double-insert fails
 * loudly rather than producing two "you"s.
 */
function ensureDefaultLocalUser(db: AppDatabase): User {
  const existing = db.select().from(users).where(eq(users.isDefaultLocalUser, true)).get()
  if (existing) return existing

  return db.insert(users).values({ isDefaultLocalUser: true }).returning().get()
}

export interface CurrentUserPluginOptions {
  db: AppDatabase
  config: ServerConfig
}

const plugin: FastifyPluginAsync<CurrentUserPluginOptions> = async (app, { db, config }) => {
  app.decorateRequest('currentUser', undefined)

  if (!config.singleUserMode) {
    // The schema is multi-tenant-ready, but no login flow exists yet — say so
    // rather than silently serving one user's data to everyone.
    app.addHook('onRequest', async () => {
      const error = Object.assign(
        new Error('Multi-user mode is not implemented yet; set SINGLE_USER_MODE=true.'),
        { statusCode: 501 },
      )
      throw error
    })
    return
  }

  // Resolved once at boot rather than per request: in single-user mode the
  // answer cannot change while the process is running.
  let defaultUser: User | undefined

  app.addHook('onReady', async () => {
    defaultUser = ensureDefaultLocalUser(db)
  })

  app.addHook('onRequest', async (request) => {
    request.currentUser = defaultUser
  })
}

/**
 * Register this on the scope that needs authentication (i.e. the /api scope).
 *
 * `fastify-plugin` is load-bearing: it attaches the hooks to the *enclosing*
 * scope rather than a private child one, so sibling route plugins registered
 * on that same scope actually get a resolved user. Without it the hooks apply
 * to nothing. It stops at the enclosing scope, so unauthenticated routes
 * outside it (e.g. /health at the root) remain unaffected.
 */
export const currentUserPlugin = fp(plugin, { name: 'current-user' })

/**
 * The only supported way for a handler to learn who is making the request.
 *
 * Handlers must never read the `users` table or the single-user flag
 * themselves — that is what keeps flipping `SINGLE_USER_MODE` a config change
 * instead of a refactor (SPEC.md §11). Enforced by resolverBoundary.test.ts.
 */
export function getCurrentUser(request: FastifyRequest): User {
  const user = request.currentUser
  if (!user) {
    throw new Error('No current user on request — is currentUserPlugin registered?')
  }
  return user
}
