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
 *
 * What is cached is the lookup in progress, not its result: several calls ask
 * at start-up before the first has finished, and on a fresh database each used
 * to find nobody and insert, so the second hit `users_one_default_local` and
 * the very first launch said "Couldn't load your lists". A failed lookup is
 * forgotten, so the next call tries again.
 */
let currentUser: Promise<User> | undefined

export function getLocalCurrentUser(db: LocalDatabase): Promise<User> {
  currentUser ??= ensureDefaultLocalUser(db).catch((cause: unknown) => {
    currentUser = undefined
    throw cause
  })

  return currentUser
}
