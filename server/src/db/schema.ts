import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
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

/** Where a list's contents came from. Free text by design — see `mediaType`. */
export type ListSource = 'api' | 'llm' | 'manual'

/**
 * A finite, curated set of things to finish — "all Jackie Chan movies", a
 * discography, a game franchise.
 *
 * `media_type` is deliberately plain text, not an enum: it is an open registry
 * key resolved to an ingestion adapter at runtime (SPEC.md §5). Adding books or
 * podcasts later must not require a migration.
 */
export const lists = sqliteTable(
  'lists',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    mediaType: text('media_type').notNull(),
    source: text('source').$type<ListSource>().notNull().default('manual'),
    /** Upstream identifier, e.g. a TMDB collection id. Null for hand-made lists. */
    externalRef: text('external_ref'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('lists_user_idx').on(table.userId)],
)

/**
 * One thing to consume within a list, in order.
 *
 * `time_to_consume_minutes` is NOT NULL on purpose (SPEC.md §4): a real value
 * where an API has one, otherwise the media type's heuristic default with
 * `time_to_consume_is_estimated` set. That keeps "time remaining" and the
 * Quickie ranking free of null-handling.
 */
export const listItems = sqliteTable(
  'list_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    timeToConsumeMinutes: integer('time_to_consume_minutes').notNull(),
    timeToConsumeIsEstimated: integer('time_to_consume_is_estimated', { mode: 'boolean' })
      .notNull()
      .default(true),
    /** Null until checked off; doubles as the "when" behind list neglect scoring. */
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('list_items_list_idx').on(table.listId)],
)

export type List = typeof lists.$inferSelect
export type ListItem = typeof listItems.$inferSelect
