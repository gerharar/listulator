import { eq } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { lists, type List } from '../db/schema.js'
import { expandSource } from '../ingestion/expandSource.js'
import type { MediaType, MediaTypeCandidate } from '../ingestion/mediaTypes.js'
import { normalizeItemTags } from './facets.js'
import {
  createListSnapshot,
  deleteListSnapshot,
  type CreateListSnapshotItemInput,
} from './repository.js'

/** The list has no source to refresh its copy from: hand-made, curated, a removed category or one with no adapter. */
export class SourceCopyUnavailableError extends Error {
  constructor(reason: string) {
    super(`No source copy to refresh: ${reason}.`)
    this.name = 'SourceCopyUnavailableError'
  }
}

/** The source now expands to nothing. Replacing a copy with an empty one would be a silent loss, so it is refused. */
export class SourceCopyEmptyError extends Error {
  constructor() {
    super('The source returned no items.')
    this.name = 'SourceCopyEmptyError'
  }
}

export interface SourceCopyDeps {
  mediaTypes: readonly MediaType[]
}

/**
 * What a fresh import would snapshot for these candidates, worked out in
 * memory: the import snapshots the list's rows *after* placement, so this
 * repeats the placement rules of `createListItem` (labels trimmed and matched
 * to an earlier spelling case-insensitively; a grouped item goes straight
 * after its group's last item, anything else at the end; tags normalised;
 * the category default for an unknown length). Kept equal to a real import by
 * a test that compares the two.
 */
function snapshotRowsFor(
  candidates: readonly MediaTypeCandidate[],
  defaultDurationMinutes: number,
): CreateListSnapshotItemInput[] {
  const placed: Omit<CreateListSnapshotItemInput, 'orderIndex'>[] = []
  const spellings = new Map<string, string>()

  for (const candidate of candidates) {
    const label = candidate.group?.trim()
    const group = label ? (spellings.get(label.toLowerCase()) ?? label) : null
    if (label && !spellings.has(label.toLowerCase())) spellings.set(label.toLowerCase(), label)

    const known = candidate.timeToConsumeMinutes !== undefined
    const row = {
      title: candidate.title,
      timeToConsumeMinutes: known ? candidate.timeToConsumeMinutes! : defaultDurationMinutes,
      timeToConsumeIsEstimated: !known,
      externalRef: candidate.externalRef || null,
      year: candidate.year || null,
      group,
      tags: normalizeItemTags(candidate.tags),
      notes: candidate.notes || null,
    }

    const lastInGroup = group ? placed.findLastIndex((entry) => entry.group === group) : -1
    if (lastInGroup === -1) placed.push(row)
    else placed.splice(lastInGroup + 1, 0, row)
  }

  return placed.map((row, orderIndex) => ({ ...row, orderIndex }))
}

/**
 * Refreshes a fetched list's stored source copy (task 12.2): re-expands the
 * list's stored ref through its category's adapter and replaces the snapshot
 * rows, `arrived_status` and `snapshot_fetched_at`. That is all. The user's
 * list — items, groups, ticks, dismissals, order, title, description, status —
 * is theirs and is never read or written here.
 *
 * `arrived_title` and `arrived_description` stay as they were: an expansion
 * carries items and a production status, nothing that names or describes the
 * list.
 *
 * Not one transaction, because the desktop driver has none (docs/DECISIONS.md,
 * 10.16, 10.18). Everything that can fail on the network happens first, and
 * nothing is written if it does. The writes then run in an order where a
 * failure between any two leaves a state the app already handles: old rows
 * are deleted before the new ones go in, so a failure mid-way leaves an empty
 * copy (Reset refuses, and 12.3 fetches live) and never old and new together;
 * the date moves last, so a half-finished refresh still looks due and a
 * repeat finishes it.
 */
export async function refreshSourceCopy(
  db: PortableDatabase,
  list: List,
  { mediaTypes }: SourceCopyDeps,
  now: Date = new Date(),
): Promise<{ items: number }> {
  if (list.source !== 'api' || !list.externalRef) {
    throw new SourceCopyUnavailableError('the list was not fetched from a source')
  }

  const mediaType = mediaTypes.find((entry) => entry.key === list.mediaType)
  if (!mediaType?.adapter) {
    throw new SourceCopyUnavailableError(`${list.mediaType} has no source to fetch from`)
  }

  // Live, never from the expansion cache: a refresh is asked because the copy is old.
  const expansion = await expandSource(
    mediaType,
    list.externalRef,
    {},
    new Set(mediaTypes.map((entry) => entry.key)),
  )
  if (expansion.items.length === 0) throw new SourceCopyEmptyError()

  const rows = snapshotRowsFor(expansion.items, mediaType.defaultDurationMinutes)

  await deleteListSnapshot(db, list.id)
  await createListSnapshot(db, list.id, rows)
  await db
    .update(lists)
    .set({ arrivedStatus: expansion.status ?? null, snapshotFetchedAt: now })
    .where(eq(lists.id, list.id))
    .run()

  return { items: rows.length }
}
