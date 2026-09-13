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

/**
 * Where a list's contents came from. Free text by design — see `mediaType`.
 * `'file'` is a pasted/uploaded or locally-dropped custom-list YAML file
 * (tasks 7.2/7.3, `docs/intent/custom-lists.md`) — kept distinct from
 * `'manual'` (the hand-typed creation form) since it is a bulk,
 * machine-parsed import, and distinct from `'api'` since it has no live
 * upstream to refresh against. `'canonical'` (task 7.4) is the same file
 * format synced from the canonical GitHub repo instead — kept distinct
 * from both `'file'` (which has nothing to refresh) and `'api'` (a
 * TMDB/IGDB/Wikipedia-style adapter) so a future feature enumerating every
 * synced list (task 7.6's update notifications) can select on `source`
 * alone, rather than `source = 'api' AND externalRef LIKE 'canonical:%'`.
 */
export type ListSource = 'api' | 'llm' | 'manual' | 'file' | 'canonical'

/**
 * Where one item came from — distinct from `ListSource` above, and tracked
 * per item rather than inherited from the list, because a search-imported
 * list can still gain hand-typed items afterward (task 6.1's single-item
 * add form works on any list, imported or not) — the list's own `source`
 * cannot tell those two kinds of item apart once that happens.
 */
export type ItemSource = 'manual' | 'import'

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
    /**
     * Upstream id where the source has one (a TMDB movie, an IGDB game). Null
     * for hand-typed items, and for sources with no stable id of their own —
     * Wikipedia events and Open Library works. Used to match an item against
     * its source when checking a list for updates.
     */
    externalRef: text('external_ref'),
    /**
     * Defaults to `'import'` so existing rows (migrated before this column
     * existed) don't retroactively gain a manual-entry marker they never
     * earned — every real call site sets this explicitly regardless (task
     * 6.2), the default only matters for that backfill.
     */
    source: text('source').$type<ItemSource>().notNull().default('import'),
    /**
     * The year the item was originally released/published, where the source
     * knows one — null otherwise (nullable by design: not every source has
     * one, e.g. Comic Vine issues, whose only date field is an unreliable
     * cover date rather than a real publication year). Never guessed.
     */
    year: integer('year'),
    /**
     * Optional grouping label, e.g. "Season 1" for a TV episode — presentation
     * only, never affects ordering or progress (task 6.6). The same field
     * Phase 7's custom-list YAML uses for its per-item `group` (SPEC.md's
     * intent doc, `docs/intent/custom-lists.md`), so a season and a comic
     * story arc share one shape rather than one per category.
     */
    group: text('group'),
    /**
     * Per-item language tag, when a source both tracks one and a filter was
     * actually applied while building the list — Open Library's `language`
     * field for a book, or the literal `'unknown'` when a book with no
     * language metadata was kept anyway (the "include unknown" toggle).
     * Null for every other category, and for a book list built with no
     * language filter ("All"). Presentation only — makes an otherwise
     * invisible filtering decision visible per item, since Open Library's
     * own tagging is inconsistent enough that a filtered list can still mix
     * languages (a real, verified-live case, not hypothetical).
     */
    language: text('language'),
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

/**
 * Items the user deleted, so a refresh does not keep offering them back.
 *
 * Import filtering is deliberately imperfect (SPEC.md §5) on the promise that
 * anything unwanted can be deleted by hand. That promise only holds if the
 * deletion sticks: without this table every rescan re-offers the thirty
 * behind-the-scenes entries you already pruned, and you re-skip them forever.
 *
 * Scoped by `list_id` like `list_items`, which carries the `user_id` — see
 * docs/DECISIONS.md.
 *
 * Matched the same way a refresh matches: on `external_ref` where the source
 * has one, and on the normalised title where it does not (Wikipedia events,
 * Open Library works). Title matching can over-suppress two genuinely
 * different entries sharing a name, which is why the rescan can ignore this
 * table entirely — see `includeDismissed`.
 */
export const dismissedItems = sqliteTable(
  'dismissed_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    /** Null for sources with no stable id; `title_key` is then the only match. */
    externalRef: text('external_ref'),
    /** Lower-cased, trimmed title. Always set, so there is always a fallback. */
    titleKey: text('title_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('dismissed_items_list_idx').on(table.listId)],
)

export type List = typeof lists.$inferSelect
export type ListItem = typeof listItems.$inferSelect
export type DismissedItem = typeof dismissedItems.$inferSelect

/** The one place a title is turned into a match key. */
export function dismissalTitleKey(title: string): string {
  return title.trim().toLowerCase()
}
