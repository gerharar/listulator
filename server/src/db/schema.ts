import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Users exist even in single-user mode: every other table is `user_id`-scoped
 * from day one so enabling multi-tenancy later is a config change, not a
 * migration (SPEC.md §11).
 *
 * Only the auth module may read this table — handlers get the current user
 * from the resolver instead. Enforced by src/auth/resolverBoundary.test.ts.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    isDefaultLocalUser: integer('is_default_local_user', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // At most one default local user, ever. Without this, a bug that
    // double-bootstraps would silently split data across two "you"s.
    uniqueIndex('users_one_default_local')
      .on(table.isDefaultLocalUser)
      .where(sql`${table.isDefaultLocalUser} = 1`),
  ],
)

export type User = typeof users.$inferSelect
