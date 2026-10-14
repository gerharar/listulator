import type { PortableDatabase } from '../db/client.js'
import type { MediaType } from '../ingestion/mediaTypes.js'
import { missingSlugRefs, recordSlugs } from './itemSlugs.js'

/**
 * Looks up the page slugs a list's items lack (H-002, BL-087: IGDB's pages are `/games/<slug>`), in the background,
 * when the list is opened. The same code runs on the server and in the desktop webview, each with its own database,
 * so nothing here reaches for either; like the lookup of lengths (`runtimeFill.ts`) it keeps no state that matters:
 * what is still to ask is worked out from the database, so a restart resumes where it stopped.
 *
 * Made to cost little (the owner's worry, 2026-10-14):
 *  - a category whose addresses need no slug, or a source that cannot answer (no key), never reaches the database;
 *  - one lookup per list at a time, however often the list is read meanwhile;
 *  - one request per 500 games, the source's own ceiling, through the source's own pacer;
 *  - each batch is kept as it arrives, so a failure loses only the batch in flight;
 *  - after a failure, or an answer that left games out, the list is left alone for a while (`cooldownMs`), not asked
 *    again at every read: IGDB being down must not turn every opening into a request.
 */

/** IGDB's ceiling on one query (`limit`); see `PAGE_SIZE` in `igdb.ts`. */
const BATCH_SIZE = 500
/** How long a list is left alone after a failed or incomplete lookup. */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000

export interface SlugFillDeps {
  db: PortableDatabase
  /** Injectable so the cooldown is testable without waiting. */
  now?: () => Date
  cooldownMs?: number
  /** Stops the run after the batch in hand. */
  signal?: AbortSignal
  /** Where a failed lookup is reported; it is never thrown out of the background. */
  onError?: (error: unknown) => void
}

export function createSlugFiller({ db, now = () => new Date(), cooldownMs = DEFAULT_COOLDOWN_MS, signal, onError }: SlugFillDeps) {
  /** One run per list: asking again while one is going gets that run. */
  const running = new Map<string, Promise<void>>()
  /** Lists left alone until this time (ms). */
  const coolingUntil = new Map<string, number>()

  const cool = (listId: string): void => void coolingUntil.set(listId, now().getTime() + cooldownMs)

  async function run(listId: string, adapter: NonNullable<MediaType['adapter']>, prefixes: readonly string[]): Promise<void> {
    const missing = await missingSlugRefs(db, listId, prefixes)

    for (let start = 0; start < missing.length; start += BATCH_SIZE) {
      if (signal?.aborted) return

      const batch = missing.slice(start, start + BATCH_SIZE)
      const answers = await adapter.slugs!(batch)
      const asked = new Set(batch)
      await recordSlugs(
        db,
        [...answers].filter(([ref]) => asked.has(ref)).map(([ref, slug]) => ({ ref, slug })),
        now(),
      )

      // A source that left games out of its answer is not asked about them again straight away.
      if ([...asked].some((ref) => !answers.has(ref))) {
        cool(listId)
        return
      }
    }
  }

  return {
    /**
     * Starts the lookup for a list if one is needed and allowed, without waiting for it. True: a lookup is running
     * for the list (this one, or one already going), so its links are on their way; false: there is nothing to look
     * up, or none will be asked now (no slugs for the category, no key, or the list is cooling off).
     */
    start(listId: string, mediaType: MediaType | undefined): boolean {
      const adapter = mediaType?.adapter
      const prefixes = adapter?.slugPrefixes
      if (!adapter?.slugs || !prefixes || prefixes.length === 0) return false
      if (running.has(listId)) return true
      if (signal?.aborted || !adapter.isAvailable()) return false

      const until = coolingUntil.get(listId)
      if (until !== undefined) {
        if (now().getTime() < until) return false
        coolingUntil.delete(listId)
      }

      const job = run(listId, adapter, prefixes)
        .catch((error: unknown) => {
          cool(listId)
          onError?.(error)
        })
        .finally(() => running.delete(listId))
      running.set(listId, job)

      return true
    },

    /** Resolves when the list's lookup, if there is one, has ended. Never rejects. */
    idle: (listId: string): Promise<void> => running.get(listId) ?? Promise.resolve(),
  }
}

export type SlugFiller = ReturnType<typeof createSlugFiller>
