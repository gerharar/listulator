import type {
  DismissedItem,
  ItemSource,
  List,
  ListGroup,
  ListItem,
  ListSnapshotItem,
  ListSource,
  ListStatus,
} from '../db/schema.js'

/**
 * What a destructive call hands back so it can be undone (D2, task 10.19a).
 * Plain JSON — dates are ISO strings — because the client holds it only in the
 * Undo toast's memory and posts it back to a restore endpoint. A restart loses
 * the Undo, never the data: the delete itself is already committed.
 *
 * Kept free of any repository import so `repository.ts` and `groups.ts` can
 * build these without a cycle with `restore.ts`.
 */
export interface ItemPayload {
  id: string
  title: string
  orderIndex: number
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated: boolean
  externalRef: string | null
  source: ItemSource
  year: number | null
  group: string | null
  tags: string[] | null
  consumedAt: string | null
  notes: string | null
  /** Absent on payloads from before 10.17; read as false. */
  isNew?: boolean
  createdAt: string
  updatedAt: string
}

export interface GroupPayload {
  id: string
  name: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface DismissalPayload {
  id: string
  externalRef: string | null
  titleKey: string
  createdAt: string
}

export interface SnapshotPayload {
  id: string
  title: string
  orderIndex: number
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated: boolean
  externalRef: string | null
  year: number | null
  group: string | null
  tags: string[] | null
  notes: string | null
}

export interface ListPayload {
  id: string
  title: string
  description: string | null
  mediaType: string
  source: ListSource
  externalRef: string | null
  status: ListStatus | null
  sourceYaml: string | null
  arrivedTitle: string | null
  arrivedDescription: string | null
  arrivedStatus: ListStatus | null
  snapshotFetchedAt?: string | null
  createdAt: string
  updatedAt: string
}

/** A deleted item, and the dismissal the delete recorded (removed again on restore). */
export interface ItemRestore {
  item: ItemPayload
  dismissalId: string | null
}

export interface GroupRestore {
  group: GroupPayload
  /** Present when the group was deleted with its items: they come back too. */
  items?: ItemPayload[]
  /** The "not wanted" records that delete made for those items, removed again on restore. */
  dismissalIds?: string[]
}

/** A deleted list with everything that went with it. */
export interface ListRestore {
  list: ListPayload
  items: ItemPayload[]
  groups: GroupPayload[]
  snapshot: SnapshotPayload[]
  dismissals: DismissalPayload[]
}

/** The list's own fields that a Reset can change (from the source's name, description and status). */
export interface ListFieldsPayload {
  title: string
  description: string | null
  status: ListStatus | null
}

/**
 * A list's whole item set and dismissals, as they stood — what undoing a Reset
 * puts back. `groups` and `list` are what a Reset also rewrites (the group rows,
 * with their order and any empty ones, and the list's own title, description
 * and status); absent on a payload from before 10.18, which then restores the
 * items alone.
 */
export interface ItemSetRestore {
  items: ItemPayload[]
  dismissals: DismissalPayload[]
  groups?: GroupPayload[]
  list?: ListFieldsPayload
}

/** Where every item and group stood before Sort chronologically — what its Undo puts back. */
export interface OrderRestore {
  items: { id: string; orderIndex: number }[]
  groups: { id: string; orderIndex: number }[]
}

export const toItemPayload = (item: ListItem): ItemPayload => ({
  id: item.id,
  title: item.title,
  orderIndex: item.orderIndex,
  timeToConsumeMinutes: item.timeToConsumeMinutes,
  timeToConsumeIsEstimated: item.timeToConsumeIsEstimated,
  externalRef: item.externalRef,
  source: item.source,
  year: item.year,
  group: item.group,
  tags: item.tags,
  consumedAt: item.consumedAt?.toISOString() ?? null,
  notes: item.notes,
  isNew: item.isNew,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
})

export const toGroupPayload = (group: ListGroup): GroupPayload => ({
  id: group.id,
  name: group.name,
  orderIndex: group.orderIndex,
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
})

export const toDismissalPayload = (row: DismissedItem): DismissalPayload => ({
  id: row.id,
  externalRef: row.externalRef,
  titleKey: row.titleKey,
  createdAt: row.createdAt.toISOString(),
})

export const toSnapshotPayload = (row: ListSnapshotItem): SnapshotPayload => ({
  id: row.id,
  title: row.title,
  orderIndex: row.orderIndex,
  timeToConsumeMinutes: row.timeToConsumeMinutes,
  timeToConsumeIsEstimated: row.timeToConsumeIsEstimated,
  externalRef: row.externalRef,
  year: row.year,
  group: row.group,
  tags: row.tags,
  notes: row.notes,
})

export const toListPayload = (list: List): ListPayload => ({
  id: list.id,
  title: list.title,
  description: list.description,
  mediaType: list.mediaType,
  source: list.source,
  externalRef: list.externalRef,
  status: list.status,
  sourceYaml: list.sourceYaml,
  arrivedTitle: list.arrivedTitle,
  arrivedDescription: list.arrivedDescription,
  arrivedStatus: list.arrivedStatus,
  snapshotFetchedAt: list.snapshotFetchedAt?.toISOString() ?? null,
  createdAt: list.createdAt.toISOString(),
  updatedAt: list.updatedAt.toISOString(),
})
