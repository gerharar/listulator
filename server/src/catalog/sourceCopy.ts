import { eq } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { lists, type List } from '../db/schema.js'
import { expandSource } from '../ingestion/expandSource.js'
import type { MediaType, MediaTypeCandidate } from '../ingestion/mediaTypes.js'
import { normalizeItemTags } from './facets.js'
import { knownRuntimes, withKnownRuntimes } from './runtimes.js'
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
 * list. The exception is a list with no copy (dropped, task 12.3): it has no
 * arrived title to keep, so the new copy takes the list's title and description
 * as they stand, and the source's status where it has one, else the list's.
 * That is what a Reset from the live source already gave such a list, so making
 * the copy changes nothing about what Reset does.
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

  // The copy keeps the lengths already looked up (15.11): a source listed without lengths gives every item
  // the estimate otherwise, and the list's own lookup only ever fills the list, never the copy.
  const rows = snapshotRowsFor(
    withKnownRuntimes(
      expansion.items,
      await knownRuntimes(
        db,
        expansion.items.filter((item) => item.externalRef && item.timeToConsumeMinutes === undefined).map((item) => item.externalRef!),
        now,
      ),
    ),
    mediaType.defaultDurationMinutes,
  )

  const arrived =
    list.arrivedTitle !== null
      ? { arrivedStatus: expansion.status ?? null }
      : {
          arrivedTitle: list.title,
          arrivedDescription: list.description,
          arrivedStatus: expansion.status ?? list.status,
        }

  await deleteListSnapshot(db, list.id)
  await createListSnapshot(db, list.id, rows)
  await db
    .update(lists)
    .set({ ...arrived, snapshotFetchedAt: now })
    .where(eq(lists.id, list.id))
    .run()

  return { items: rows.length }
}

/**
 * Forgets a list's stored source copy: the snapshot rows, the arrived fields
 * and the date. The user's list is untouched. A list with no copy is what
 * `resolveTarget` (reset.ts) answers from the live source, and what a list
 * that never had one already looked like, so "dropped" and "never had one" are
 * one state (task 12.3).
 */
export async function dropSourceCopy(db: PortableDatabase, list: List): Promise<void> {
  await deleteListSnapshot(db, list.id)
  await db
    .update(lists)
    .set({ arrivedTitle: null, arrivedDescription: null, arrivedStatus: null, snapshotFetchedAt: null })
    .where(eq(lists.id, list.id))
    .run()
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whether the copy has reached its source's storage limit. False for a source with no limit or a list with no copy. */
function isOverdue(list: List, mediaTypes: readonly MediaType[], now: Date): boolean {
  const maxDays = mediaTypes.find((entry) => entry.key === list.mediaType)?.sourceCopyMaxDays
  if (!maxDays || !list.snapshotFetchedAt) return false

  return now.getTime() - list.snapshotFetchedAt.getTime() >= maxDays * DAY_MS
}

export type SourceCopyOutcome =
  | { outcome: 'refreshed'; items: number }
  /** A list whose copy had been dropped got one again, because its source answered. */
  | { outcome: 'created'; items: number }
  /** The refresh failed but the copy is still within its limit, so it stays. */
  | { outcome: 'kept'; error: unknown }
  /** The refresh failed and the copy had reached its limit, so it was dropped. */
  | { outcome: 'dropped'; error: unknown }
  /** No copy, and the source could not give one now; asked again next time. */
  | { outcome: 'missing'; error: unknown }
  /** Nothing to keep or make: not a fetched list, or its source sets no limit. The source was not asked. */
  | { outcome: 'none' }

/**
 * Keeps one list's copy within its source's limit (task 12.3): refresh it, and
 * if that fails (offline, no key, source gone or empty) drop it only when it has
 * reached the limit. A copy still in time survives a failed refresh and is tried
 * again later. The limit counts from the date on the copy, and a copy is overdue
 * on the day it reaches the limit, since the platforms say to delete or refresh
 * *within* that many days. Which lists are due, and when, is the schedule's
 * business (12.4).
 *
 * A fetched list of a category with a limit and no copy gets one again whenever
 * its source answers (owner, 2026-10-01): a dropped copy is not lost for good,
 * and until it is back Reset reads the source live. A category with no limit is
 * left as it is: nothing in it ever has to be dropped, so nothing is made.
 *
 * Never throws for a failed refresh: the failure comes back in the outcome so a
 * schedule can go on to the next list.
 */
export async function refreshOrDropSourceCopy(
  db: PortableDatabase,
  list: List,
  deps: SourceCopyDeps,
  now: Date = new Date(),
): Promise<SourceCopyOutcome> {
  if (!list.snapshotFetchedAt) {
    const mediaType = deps.mediaTypes.find((entry) => entry.key === list.mediaType)
    if (list.source !== 'api' || !list.externalRef || !mediaType?.adapter || !mediaType.sourceCopyMaxDays) {
      return { outcome: 'none' }
    }

    try {
      return { outcome: 'created', ...(await refreshSourceCopy(db, list, deps, now)) }
    } catch (error) {
      return { outcome: 'missing', error }
    }
  }

  try {
    return { outcome: 'refreshed', ...(await refreshSourceCopy(db, list, deps, now)) }
  } catch (error) {
    if (!isOverdue(list, deps.mediaTypes, now)) return { outcome: 'kept', error }

    await dropSourceCopy(db, list)
    return { outcome: 'dropped', error }
  }
}
