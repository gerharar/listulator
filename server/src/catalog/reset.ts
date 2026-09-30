import { eq } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import {
  dismissalTitleKey,
  dismissedItems,
  listGroups,
  listItems,
  type List,
  type ListStatus,
} from '../db/schema.js'
import {
  canonicalPathFromExternalRef,
  CustomListParseError,
  fetchCanonicalList,
  isSafeCanonicalPath,
  parseCustomList,
  type ParsedCustomList,
} from '../ingestion/customLists.js'
import { expandSource, SourceUnavailableError } from '../ingestion/expandSource.js'
import type { ExpansionCache } from '../ingestion/expansionCache.js'
import { IngestionError, type FetchLike } from '../ingestion/http.js'
import type { ListExpansion, MediaType } from '../ingestion/mediaTypes.js'
import { findListGroups, seedGroupOrder } from './groups.js'
import {
  createListItem,
  findList,
  findListItems,
  findListSnapshot,
  updateList,
} from './repository.js'
import { captureItemSet, restoreItemSet } from './restore.js'
import type { ItemSetRestore, OrderRestore } from './restorePayloads.js'

/**
 * Sort chronologically and Reset to the source (D4, task 10.18).
 *
 * Both are imported by the server's routes and by the desktop's `api.local.ts`
 * alike, so there is one implementation: nothing here reads a Node builtin, and
 * anything that could fail (a fetch, a parse) is done before the first write —
 * the desktop has no transactions to fall back on.
 */

/** A list with no source to return to: hand-made, or one with no stored copy and no way to fetch its source. */
export class ResetUnavailableError extends Error {}

/**
 * The source, fetched live for a list with no stored copy, now has nothing.
 * Resetting to it would empty the list, so it is refused (task 12.3).
 */
export class ResetSourceEmptyError extends Error {
  constructor(readonly title: string) {
    super('The source returned no items.')
    this.name = 'ResetSourceEmptyError'
  }
}

const NO_YEAR = Number.POSITIVE_INFINITY

/**
 * One in-place re-sort by year (the design rules' "Sort chronologically").
 * Groups move as blocks, positioned by their earliest item, and the items
 * inside a group are sorted the same way; a loose item is a unit of its own.
 * Units and items with no year come last and ties keep the order they had. Group rows follow the same
 * sequence, empty ones last. Nothing is added, removed or ticked, and no
 * source is read. Returns where everything stood, for Undo.
 */
export async function sortChronologically(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<OrderRestore | undefined> {
  return reorderBy(db, userId, listId, (item) => item.year ?? NO_YEAR)
}

/**
 * Reset the order: the same in-place re-order, but by where the source has each
 * item instead of by year. Items are matched to the source the way a refresh
 * matches them; one the source does not have (added by hand, or arrived since)
 * goes after the rest, in the order it had. Nothing is added, removed or ticked
 * and the list's own fields are left alone. Returns where everything stood, for Undo.
 */
export async function resetOrderToSource(
  db: PortableDatabase,
  userId: string,
  listId: string,
  deps: ResetDeps,
): Promise<OrderRestore | undefined> {
  const list = await findList(db, userId, listId)
  if (!list) return undefined

  const target = await resolveTarget(db, userId, list, deps)
  const slots = new Map<string, number[]>()
  for (const [position, item] of target.items.entries()) {
    const key = identity(item)
    slots.set(key, [...(slots.get(key) ?? []), position])
  }
  // Duplicates of one identity take the source's slots in the order they now stand.
  const positionOf = new Map<string, number>()
  for (const item of (await findListItems(db, userId, listId)) ?? []) {
    const taken = slots.get(identity(item))?.shift()
    if (taken !== undefined) positionOf.set(item.id, taken)
  }

  return reorderBy(db, userId, listId, (item) => positionOf.get(item.id) ?? NO_YEAR)
}

/** What the source says for one item's tags (U5): `sourced: false` for an item added by hand or a hand-made list. */
export interface ItemSourceTags {
  sourced: boolean
  tags: string[] | null
}

/**
 * The tags the item's source gives it, for the Edit window's "Source says …"
 * and Reset to source (U5). Read from the same place a Reset reads (the live
 * canonical file, the stored file, or the arrived snapshot) and matched the way
 * Reset the order matches: by identity, duplicates taking the source's rows in
 * the order they now stand. Undefined when the list or the item is not there.
 */
export async function sourceTagsOf(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemId: string,
  deps: ResetDeps,
): Promise<ItemSourceTags | undefined> {
  const list = await findList(db, userId, listId)
  if (!list) return undefined
  const items = (await findListItems(db, userId, listId)) ?? []
  const item = items.find((entry) => entry.id === itemId)
  if (!item) return undefined

  const none: ItemSourceTags = { sourced: false, tags: null }
  if (item.source === 'manual') return none

  let target: ResetTarget
  try {
    target = await resolveTarget(db, userId, list, deps)
  } catch (cause) {
    // A line in an edit window: a source that cannot be read just has nothing to say.
    if (
      cause instanceof ResetUnavailableError ||
      cause instanceof ResetSourceEmptyError ||
      cause instanceof SourceUnavailableError ||
      cause instanceof IngestionError
    ) {
      return none
    }
    throw cause
  }

  const rows = new Map<string, TargetItem[]>()
  for (const row of target.items) rows.set(identity(row), [...(rows.get(identity(row)) ?? []), row])
  for (const entry of items) {
    const row = rows.get(identity(entry))?.shift()
    if (entry.id === itemId) return row ? { sourced: true, tags: row.tags ?? null } : none
  }
  return none
}

async function reorderBy(
  db: PortableDatabase,
  userId: string,
  listId: string,
  keyOf: (item: { id: string; year: number | null }) => number,
): Promise<OrderRestore | undefined> {
  const items = await findListItems(db, userId, listId)
  const groups = await findListGroups(db, userId, listId)
  if (!items || !groups) return undefined

  const restore: OrderRestore = {
    items: items.map((item) => ({ id: item.id, orderIndex: item.orderIndex })),
    groups: groups.map((group) => ({ id: group.id, orderIndex: group.orderIndex })),
  }

  interface Unit {
    group: string | null
    key: number
    first: number
    members: typeof items
  }
  const units: Unit[] = []
  const byGroup = new Map<string, Unit>()
  for (const [position, item] of items.entries()) {
    const year = keyOf(item)
    if (item.group) {
      const unit = byGroup.get(item.group)
      if (unit) {
        unit.members.push(item)
        unit.key = Math.min(unit.key, year)
        continue
      }
      const created: Unit = { group: item.group, key: year, first: position, members: [item] }
      byGroup.set(item.group, created)
      units.push(created)
    } else {
      units.push({ group: null, key: year, first: position, members: [item] })
    }
  }

  const ordered = [...units].sort((a, b) => a.key - b.key || a.first - b.first)

  let next = 0
  for (const unit of ordered) {
    // Inside a group too (owner, 2026-09-26): by year, no-year last, ties as they were.
    const members = unit.members
      .map((member, position) => ({ member, position }))
      .sort((a, b) => keyOf(a.member) - keyOf(b.member) || a.position - b.position)
      .map((entry) => entry.member)
    for (const member of members) {
      if (member.orderIndex !== next) {
        await db.update(listItems).set({ orderIndex: next }).where(eq(listItems.id, member.id)).run()
      }
      next += 1
    }
  }

  // Group rows follow the blocks; a group with no items yet stays after them, as it was.
  const rank = new Map(
    ordered.filter((unit) => unit.group !== null).map((unit, index) => [unit.group!, index] as const),
  )
  const sequence = [...groups].sort(
    (a, b) =>
      (rank.get(a.name) ?? NO_YEAR) - (rank.get(b.name) ?? NO_YEAR) || a.orderIndex - b.orderIndex,
  )
  for (const [index, group] of sequence.entries()) {
    if (group.orderIndex !== index) {
      await db.update(listGroups).set({ orderIndex: index }).where(eq(listGroups.id, group.id)).run()
    }
  }

  return restore
}

export interface ResetDeps {
  /**
   * The live registry: valid categories for a parsed file, the runtime a source item without one gets,
   * and, for a list with no stored copy, the adapter its source is fetched through.
   */
  mediaTypes: readonly (Pick<MediaType, 'key' | 'defaultDurationMinutes'> & Partial<MediaType>)[]
  /** Lets a preview, a Reset and the source tags that follow it share one live fetch (only a copy-less list fetches). */
  expansions?: ExpansionCache
  /** For a test; the real fetch otherwise. */
  fetchImpl?: FetchLike
}

export interface ResetCounts {
  /** Items in the list that the source does not have — added by hand, or by a refresh. */
  removed: number
  /** Items the source has that the list no longer does. */
  restored: number
  /** Items that were ticked done. */
  doneCleared: number
}

export interface ResetPreview extends ResetCounts {
  /** An API list with a source ref: the caller should run its Check for updates afterwards. */
  followUpCheck: boolean
}

export interface ResetResult {
  counts: ResetCounts
  followUpCheck: boolean
  restore: ItemSetRestore
}

interface TargetItem {
  title: string
  minutes?: number
  externalRef?: string | null
  year?: number | null
  group?: string | null
  tags?: string[] | null
  notes?: string | null
}

interface ResetTarget {
  title: string
  description: string | null
  status: ListStatus | null
  items: TargetItem[]
}

const fromParsed = (parsed: ParsedCustomList): ResetTarget => ({
  title: parsed.title,
  description: parsed.description ?? null,
  status: parsed.status ?? null,
  items: parsed.items.map((item) => ({
    title: item.title,
    ...(item.minutes !== undefined ? { minutes: item.minutes } : {}),
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(item.group !== undefined ? { group: item.group } : {}),
    ...(item.tags !== undefined ? { tags: item.tags } : {}),
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
  })),
})

/**
 * What a list with no stored copy is reset to: its source, fetched now (task
 * 12.3). The copy is gone because it reached its source's storage limit and
 * could not be refreshed, or because the list never had one. Nothing names or
 * describes the list in what a source returns, so the list keeps its own title
 * and description; its status is the source's where the source has one. The
 * fetch is never written back: a Reset, its preview and "Source says" only read.
 */
async function liveTarget(
  list: List,
  { mediaTypes, expansions }: ResetDeps,
  categories: ReadonlySet<string>,
): Promise<ResetTarget> {
  const mediaType = mediaTypes.find((entry) => entry.key === list.mediaType)
  if (list.source !== 'api' || !list.externalRef || !mediaType?.adapter) {
    throw new ResetUnavailableError('no arrived state kept, and no source to fetch')
  }

  const expansion: ListExpansion = await expandSource(
    { key: mediaType.key, label: mediaType.label ?? mediaType.key, adapter: mediaType.adapter },
    list.externalRef,
    {},
    categories,
    expansions,
  )
  if (expansion.items.length === 0) throw new ResetSourceEmptyError(list.title)

  return {
    title: list.title,
    description: list.description,
    status: expansion.status ?? list.status,
    items: expansion.items.map((item) => ({
      title: item.title,
      ...(item.timeToConsumeMinutes !== undefined ? { minutes: item.timeToConsumeMinutes } : {}),
      ...(item.externalRef ? { externalRef: item.externalRef } : {}),
      ...(item.year ? { year: item.year } : {}),
      ...(item.group ? { group: item.group } : {}),
      ...(item.tags ? { tags: item.tags } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    })),
  }
}

/** What the list is reset *to*, worked out in full before anything is touched. */
async function resolveTarget(
  db: PortableDatabase,
  userId: string,
  list: List,
  deps: ResetDeps,
): Promise<ResetTarget> {
  const { mediaTypes, fetchImpl } = deps
  const categories = new Set(mediaTypes.map((entry) => entry.key))

  if (list.source === 'canonical') {
    const path = canonicalPathFromExternalRef(list.externalRef)
    if (!path) throw new ResetUnavailableError('canonical list without a path')
    if (!isSafeCanonicalPath(path)) throw new CustomListParseError('list.fileInvalid')

    // Always the live file: a Reset must not be answered from an earlier read.
    return fromParsed(await fetchCanonicalList(path, categories, fetchImpl))
  }

  if (list.source === 'file') {
    if (list.sourceYaml === null) throw new ResetUnavailableError('no stored file')

    return fromParsed(parseCustomList(list.sourceYaml, categories))
  }

  if (list.source === 'api' || list.source === 'llm') {
    const snapshot = await findListSnapshot(db, userId, list.id)
    if (snapshot.length === 0) return await liveTarget(list, deps, categories)

    // A list that arrived before 10.2e has no arrived_* columns: keep what it has.
    const arrived = list.arrivedTitle !== null
    return {
      title: arrived ? list.arrivedTitle! : list.title,
      description: arrived ? list.arrivedDescription : list.description,
      status: arrived ? list.arrivedStatus : list.status,
      items: snapshot.map((row) => ({
        title: row.title,
        ...(row.timeToConsumeIsEstimated ? {} : { minutes: row.timeToConsumeMinutes }),
        externalRef: row.externalRef,
        year: row.year,
        group: row.group,
        tags: row.tags,
        notes: row.notes,
      })),
    }
  }

  throw new ResetUnavailableError('a hand-made list has no source')
}

/** The same identity a refresh uses to say two items are the same one. */
const identity = (item: { title: string; externalRef?: string | null }): string =>
  item.externalRef ? `ref:${item.externalRef}` : `title:${dismissalTitleKey(item.title)}`

function countChanges(
  current: { title: string; externalRef: string | null; consumedAt: Date | null }[],
  target: TargetItem[],
): ResetCounts {
  const wanted = new Map<string, number>()
  for (const item of target) wanted.set(identity(item), (wanted.get(identity(item)) ?? 0) + 1)

  let removed = 0
  for (const item of current) {
    const key = identity(item)
    const left = wanted.get(key) ?? 0
    if (left > 0) wanted.set(key, left - 1)
    else removed += 1
  }

  let restored = 0
  for (const left of wanted.values()) restored += left

  return { removed, restored, doneCleared: current.filter((item) => item.consumedAt !== null).length }
}

const wantsFollowUp = (list: List): boolean =>
  (list.source === 'api' || list.source === 'llm') &&
  Boolean(list.externalRef)

/** What a Reset would do, in numbers, without doing it: the confirm sentence states the cost first. */
export async function previewReset(
  db: PortableDatabase,
  userId: string,
  listId: string,
  deps: ResetDeps,
): Promise<ResetPreview | undefined> {
  const list = await findList(db, userId, listId)
  if (!list) return undefined

  const target = await resolveTarget(db, userId, list, deps)
  const current = (await findListItems(db, userId, listId)) ?? []

  return { ...countChanges(current, target.items), followUpCheck: wantsFollowUp(list) }
}

/**
 * Reset everything: the list goes back to how its source has it — items, order,
 * groups, and its own name, description and status — and forgets what was done
 * to it: hand-added and arrived items go, every tick is cleared, and what was
 * deleted by hand is no longer held back. Rebuilt through the import's own path
 * (`createListItem`, then `seedGroupOrder`), so it is what a fresh import makes.
 *
 * The target is resolved first and refuses without touching the list. The
 * returned `restore` puts everything back (`restoreItemSet`); if the rebuild
 * itself fails part-way, that same payload is applied before the error goes on.
 */
export async function resetToSource(
  db: PortableDatabase,
  userId: string,
  listId: string,
  deps: ResetDeps,
): Promise<ResetResult | undefined> {
  const list = await findList(db, userId, listId)
  if (!list) return undefined

  const target = await resolveTarget(db, userId, list, deps)
  const restore = (await captureItemSet(db, userId, listId))!
  const current = (await findListItems(db, userId, listId)) ?? []
  const counts = countChanges(current, target.items)
  const fallbackMinutes =
    deps.mediaTypes.find((entry) => entry.key === list.mediaType)?.defaultDurationMinutes ?? 30

  try {
    await db.delete(listItems).where(eq(listItems.listId, listId)).run()
    await db.delete(dismissedItems).where(eq(dismissedItems.listId, listId)).run()
    await db.delete(listGroups).where(eq(listGroups.listId, listId)).run()

    // Sequential, as every import is: each create reads the current end of the list.
    for (const item of target.items) {
      const known = item.minutes !== undefined
      await createListItem(db, userId, listId, {
        title: item.title,
        timeToConsumeMinutes: known ? item.minutes! : fallbackMinutes,
        timeToConsumeIsEstimated: !known,
        ...(item.externalRef ? { externalRef: item.externalRef } : {}),
        ...(item.year ? { year: item.year } : {}),
        ...(item.group ? { group: item.group } : {}),
        ...(item.tags ? { tags: item.tags } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
        source: 'import',
      })
    }

    await seedGroupOrder(db, listId)
    await updateList(db, userId, listId, {
      title: target.title,
      description: target.description,
      status: target.status,
    })
  } catch (cause) {
    await restoreItemSet(db, userId, listId, restore)
    throw cause
  }

  return { counts, followUpCheck: wantsFollowUp(list), restore }
}
