import { ensureDefaultLocalUser } from '../../../../server/src/auth/currentUser.js'
import type { User } from '../../../../server/src/db/schema.js'
import type { LocalDatabase } from './localDb.js'

/**
 * The standalone app's current-user bootstrap. Reuses the server's own
 * `ensureDefaultLocalUser` directly — no duplicate copy of the "find or
 * create the one local user" logic (task 5.5 had a temporary duplicate,
 * documented there as pending this task's `PortableDatabase` widening).
 *
 * There is no Fastify plugin, no request, no `onRequest` hook here — the
 * standalone app has no concept of a request. The user is resolved once,
 * at startup, and cached for the app's lifetime.
 */
let cachedUser: User | undefined

export async function getLocalCurrentUser(db: LocalDatabase): Promise<User> {
  cachedUser ??= await ensureDefaultLocalUser(db)
  return cachedUser
}
