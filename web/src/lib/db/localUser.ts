import { eq } from 'drizzle-orm'
import { users, type User } from '../../../../server/src/db/schema.js'
import type { LocalDatabase } from './localDb.js'

/**
 * The standalone app's equivalent of `server/src/auth/currentUser.ts`'s
 * `ensureDefaultLocalUser` — deliberately not a shared import of it. That
 * function takes `AppDatabase`, which is still pinned to the
 * `better-sqlite3` driver type specifically (flagged in `docs/DECISIONS.md`
 * under task 5.4); widening it is 5.6's job, not this task's. This
 * duplicates the same ~5 lines of logic against `LocalDatabase` instead of
 * blocking on that widening, or reaching past this task's scope to do it.
 *
 * There is no Fastify plugin, no request, no `onRequest` hook here — the
 * standalone app has no concept of a request. The user is resolved once,
 * at startup, and cached for the app's lifetime.
 */
async function ensureLocalUser(db: LocalDatabase): Promise<User> {
  const existing = await db.select().from(users).where(eq(users.isDefaultLocalUser, true)).get()
  if (existing) return existing

  return await db.insert(users).values({ isDefaultLocalUser: true }).returning().get()
}

let cachedUser: User | undefined

export async function getLocalCurrentUser(db: LocalDatabase): Promise<User> {
  cachedUser ??= await ensureLocalUser(db)
  return cachedUser
}
