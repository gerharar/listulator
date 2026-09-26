import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { sendApiError } from '../apiErrors.js'
import { getCurrentUser } from '../auth/currentUser.js'
import type { AppDatabase } from '../db/client.js'
import type { ListSource, ListStatus } from '../db/schema.js'
import type { MediaTypeRegistry } from '../ingestion/mediaTypes.js'
import {
  createList,
  createListItem,
  deleteList,
  deleteListItem,
  findListItems,
  findListWithStats,
  markListSeen,
  findListsWithStats,
  reorderListItems,
  ReorderMismatchError,
  setListItemConsumed,
  updateList,
  updateListItem,
} from './repository.js'
import {
  createListGroup,
  deleteListGroup,
  findListGroups,
  GroupNameError,
  GroupNotEmptyError,
  GroupReorderMismatchError,
  renameListGroup,
  reorderListGroups,
} from './groups.js'
import {
  ListExistsError,
  restoreItemSet,
  restoreList,
  restoreListGroup,
  restoreListItem,
  restoreOrder,
} from './restore.js'
import { CustomListParseError } from '../ingestion/customLists.js'
import { IngestionError } from '../ingestion/http.js'
import {
  previewReset,
  resetOrderToSource,
  resetToSource,
  ResetUnavailableError,
  sortChronologically,
} from './reset.js'
import type {
  GroupRestore,
  ItemRestore,
  ItemSetRestore,
  ListRestore,
  OrderRestore,
} from './restorePayloads.js'
import {
  dismissalPayloadSchema,
  groupPayloadSchema,
  itemPayloadSchema,
  listFieldsPayloadSchema,
  orderRestoreSchema,
  listPayloadSchema,
  snapshotPayloadSchema,
} from './restoreSchemas.js'

const LIST_SOURCES = ['api', 'llm', 'manual'] as const
const LIST_STATUSES = ['complete', 'ongoing'] as const

/**
 * Built from the registry at registration time, so adding a category is still
 * a single registry entry — the validation follows automatically, with no
 * schema to keep in sync (SPEC.md §5).
 */
function listBodyProperties(mediaTypes: MediaTypeRegistry) {
  return {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    mediaType: { type: 'string', enum: mediaTypes.keys() },
    source: { type: 'string', enum: LIST_SOURCES },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
    // Production status of the thing the list is about, not the user's own
    // progress (that's the derived `stats.completionPercent`). Omit/null
    // means unknown — never a third enum value (schema.ts's `ListStatus`).
    status: { type: ['string', 'null'], enum: [...LIST_STATUSES, null] },
  } as const
}

const itemBodyProperties = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  // Required on create: the catalog stores a number, and deciding *which*
  // number when nothing is known is ingestion's job (SPEC.md §5).
  timeToConsumeMinutes: { type: 'integer', minimum: 0 },
  timeToConsumeIsEstimated: { type: 'boolean' },
  orderIndex: { type: 'integer', minimum: 0 },
  // Lets a hand-typed item join (or leave, via null on a patch) a season
  // group started by an import — task 6.6's manual-entry follow-up.
  group: { type: ['string', 'null'], maxLength: 500 },
} as const

interface ListParams {
  listId: string
}

interface ItemParams extends ListParams {
  itemId: string
}

interface GroupParams extends ListParams {
  groupId: string
}

function sendGroupNameError(reply: FastifyReply, error: GroupNameError): FastifyReply {
  return error.reason === 'empty'
    ? sendApiError(reply, 400, 'group.nameEmpty')
    : sendApiError(reply, 409, 'group.nameTaken')
}

export interface CatalogRoutesOptions {
  db: AppDatabase
  mediaTypes: MediaTypeRegistry
}

export const catalogRoutes: FastifyPluginAsync<CatalogRoutesOptions> = async (
  app,
  { db, mediaTypes },
) => {
  const listProperties = listBodyProperties(mediaTypes)

  app.post<{
    Body: {
      title: string
      description?: string | null
      mediaType: string
      source?: ListSource
      externalRef?: string | null
      status?: ListStatus | null
    }
  }>(
    '/lists',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'mediaType'],
          additionalProperties: false,
          properties: listProperties,
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const list = await createList(db, user.id, request.body)

      // Re-read so every list response carries stats, even a brand new list
      // whose numbers are all zero.
      return reply.code(201).send(await findListWithStats(db, user.id, list.id))
    },
  )

  app.get('/lists', async (request) => {
    const user = getCurrentUser(request)

    return await findListsWithStats(db, user.id)
  })

  app.get<{ Params: ListParams }>('/lists/:listId', async (request, reply) => {
    const user = getCurrentUser(request)
    const list = await findListWithStats(db, user.id, request.params.listId)
    if (!list) return reply.callNotFound()

    return {
      ...list,
      items: (await findListItems(db, user.id, list.id)) ?? [],
      groups: (await findListGroups(db, user.id, list.id)) ?? [],
    }
  })

  app.patch<{
    Params: ListParams
    Body: {
      title?: string
      description?: string | null
      mediaType?: string
      source?: ListSource
      externalRef?: string | null
      status?: ListStatus | null
    }
  }>(
    '/lists/:listId',
    {
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: listProperties,
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const updated = await updateList(db, user.id, request.params.listId, request.body)
      if (!updated) return reply.callNotFound()

      return await findListWithStats(db, user.id, updated.id)
    },
  )

  /** Mark all seen (10.17): clears the list's NEW markers. */
  app.post<{ Params: ListParams }>('/lists/:listId/seen', async (request, reply) => {
    const user = getCurrentUser(request)
    const cleared = await markListSeen(db, user.id, request.params.listId)
    if (cleared === undefined) return reply.callNotFound()

    return { cleared }
  })

  app.delete<{ Params: ListParams }>('/lists/:listId', async (request, reply) => {
    const user = getCurrentUser(request)
    // Acts at once and hands back everything that went, for Undo (D2, 10.19a).
    const restore = await deleteList(db, user.id, request.params.listId)
    if (!restore) return reply.callNotFound()

    return { restore }
  })

  app.post<{
    Params: ListParams
    Body: {
      title: string
      timeToConsumeMinutes: number
      timeToConsumeIsEstimated?: boolean
      orderIndex?: number
      group?: string | null
    }
  }>(
    '/lists/:listId/items',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'timeToConsumeMinutes'],
          additionalProperties: false,
          properties: itemBodyProperties,
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      // This route's whole reason to exist is adding one item by hand
      // (task 6.1/6.2) — bulk/search-imported items always go through
      // ingestion's own routes instead.
      const item = await createListItem(db, user.id, request.params.listId, {
        ...request.body,
        source: 'manual',
      })
      if (!item) return reply.callNotFound()

      return reply.code(201).send(item)
    },
  )

  app.patch<{
    Params: ItemParams
    Body: {
      title?: string
      timeToConsumeMinutes?: number
      timeToConsumeIsEstimated?: boolean
      orderIndex?: number
      group?: string | null
    }
  }>(
    '/lists/:listId/items/:itemId',
    {
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: itemBodyProperties,
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId, itemId } = request.params
      const updated = await updateListItem(db, user.id, listId, itemId, request.body)
      if (!updated) return reply.callNotFound()

      return updated
    },
  )

  app.delete<{ Params: ItemParams }>('/lists/:listId/items/:itemId', async (request, reply) => {
    const user = getCurrentUser(request)
    const { listId, itemId } = request.params
    const restore = await deleteListItem(db, user.id, listId, itemId)
    if (!restore) return reply.callNotFound()

    return { restore }
  })

  /**
   * Renumbers the whole list to the order given (task 6.7) — a bulk "set the
   * whole order" rather than a move-to-position endpoint, matching
   * `reorderListItems`'s own reasoning. Which pairs of items are legal to
   * swap (never crossing a season boundary, task 6.6) is enforced by the UI,
   * not here.
   */
  app.put<{ Params: ListParams; Body: { itemIds: string[] } }>(
    '/lists/:listId/items/order',
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['itemIds'],
          additionalProperties: false,
          properties: {
            // No real limit on a list's length; this only guards against a
            // wrong request. The ids are the whole list, so the body size is
            // what actually bounds it (~40 bytes each).
            itemIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId } = request.params

      try {
        const reordered = await reorderListItems(db, user.id, listId, request.body.itemIds)
        if (!reordered) return reply.callNotFound()

        return reordered
      } catch (cause) {
        if (cause instanceof ReorderMismatchError) {
          return reply.code(400).send({ message: cause.message })
        }
        throw cause
      }
    },
  )

  // Groups (D3, task 10.16). A group is a row of its own, so an empty one can
  // exist; its name is what its items carry as their `group`.
  const groupNameBody = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: { name: { type: 'string', minLength: 1, maxLength: 500 } },
  } as const

  app.post<{ Params: ListParams; Body: { name: string } }>(
    '/lists/:listId/groups',
    { schema: { body: groupNameBody } },
    async (request, reply) => {
      const user = getCurrentUser(request)

      try {
        const group = await createListGroup(db, user.id, request.params.listId, request.body.name)
        if (!group) return reply.callNotFound()

        return reply.code(201).send(group)
      } catch (cause) {
        if (cause instanceof GroupNameError) return sendGroupNameError(reply, cause)
        throw cause
      }
    },
  )

  // Registered before `:groupId`, so "order" is never read as a group id.
  app.put<{ Params: ListParams; Body: { groupIds: string[] } }>(
    '/lists/:listId/groups/order',
    {
      schema: {
        body: {
          type: 'object',
          required: ['groupIds'],
          additionalProperties: false,
          properties: {
            groupIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)

      try {
        const groups = await reorderListGroups(db, user.id, request.params.listId, request.body.groupIds)
        if (!groups) return reply.callNotFound()

        return groups
      } catch (cause) {
        if (cause instanceof GroupReorderMismatchError) {
          return sendApiError(reply, 400, 'group.orderMismatch')
        }
        throw cause
      }
    },
  )

  app.patch<{ Params: GroupParams; Body: { name: string } }>(
    '/lists/:listId/groups/:groupId',
    { schema: { body: groupNameBody } },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId, groupId } = request.params

      try {
        const group = await renameListGroup(db, user.id, listId, groupId, request.body.name)
        if (!group) return reply.callNotFound()

        return group
      } catch (cause) {
        if (cause instanceof GroupNameError) return sendGroupNameError(reply, cause)
        throw cause
      }
    },
  )

  // `?withItems=true` deletes a group that still has items, and them with it (after the UI's confirmation).
  app.delete<{ Params: GroupParams; Querystring: { withItems?: string } }>('/lists/:listId/groups/:groupId', async (request, reply) => {
    const user = getCurrentUser(request)
    const { listId, groupId } = request.params

    try {
      const restore = await deleteListGroup(db, user.id, listId, groupId, {
        withItems: request.query.withItems === 'true',
      })
      if (!restore) return reply.callNotFound()

      return { restore }
    } catch (cause) {
      if (cause instanceof GroupNotEmptyError) return sendApiError(reply, 409, 'group.notEmpty')
      throw cause
    }
  })

  // Undo (D2, task 10.19a): every delete above returns what it removed, and these
  // put it back with the original ids, positions and done state.
  app.post<{ Params: ListParams; Body: ItemRestore }>(
    '/lists/:listId/items/restore',
    {
      schema: {
        body: {
          type: 'object',
          required: ['item'],
          additionalProperties: false,
          properties: { item: itemPayloadSchema, dismissalId: { type: ['string', 'null'] } },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const item = await restoreListItem(db, user.id, request.params.listId, {
        item: request.body.item,
        dismissalId: request.body.dismissalId ?? null,
      })
      if (!item) return reply.callNotFound()

      return item
    },
  )

  app.post<{ Params: ListParams; Body: GroupRestore }>(
    '/lists/:listId/groups/restore',
    {
      // A group deleted with its items carries them all back.
      bodyLimit: 64 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['group'],
          additionalProperties: false,
          properties: {
            group: groupPayloadSchema,
            // A group deleted with its items brings them back too.
            items: { type: 'array', items: itemPayloadSchema },
            dismissalIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)

      try {
        const group = await restoreListGroup(db, user.id, request.params.listId, request.body)
        if (!group) return reply.callNotFound()

        return group
      } catch (cause) {
        if (cause instanceof GroupNameError) return sendGroupNameError(reply, cause)
        throw cause
      }
    },
  )

  // The payload is the whole list, so it can be large: 10,000 items is ~3 MB.
  app.post<{ Body: ListRestore }>(
    '/lists/restore',
    {
      bodyLimit: 64 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['list', 'items', 'groups', 'snapshot', 'dismissals'],
          additionalProperties: false,
          properties: {
            list: listPayloadSchema,
            items: { type: 'array', items: itemPayloadSchema },
            groups: { type: 'array', items: groupPayloadSchema },
            snapshot: { type: 'array', items: snapshotPayloadSchema },
            dismissals: { type: 'array', items: dismissalPayloadSchema },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)

      try {
        await restoreList(db, user.id, request.body)
      } catch (cause) {
        if (cause instanceof ListExistsError) return sendApiError(reply, 409, 'list.alreadyExists')
        throw cause
      }

      return reply.code(201).send(await findListWithStats(db, user.id, request.body.list.id))
    },
  )

  // Replaces the whole item set — what undoing a Reset (task 10.18) posts.
  app.put<{ Params: ListParams; Body: ItemSetRestore }>(
    '/lists/:listId/items/restore-all',
    {
      bodyLimit: 64 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['items', 'dismissals'],
          additionalProperties: false,
          properties: {
            items: { type: 'array', items: itemPayloadSchema },
            dismissals: { type: 'array', items: dismissalPayloadSchema },
            // What a Reset also rewrites (10.18); optional, so older payloads still work.
            groups: { type: 'array', items: groupPayloadSchema },
            list: listFieldsPayloadSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const items = await restoreItemSet(db, user.id, request.params.listId, request.body)
      if (!items) return reply.callNotFound()

      return items
    },
  )

  // Sort chronologically (10.18): one in-place re-sort; hands back the old order for Undo.
  app.post<{ Params: ListParams }>('/lists/:listId/sort', async (request, reply) => {
    const user = getCurrentUser(request)
    const restore = await sortChronologically(db, user.id, request.params.listId)
    if (!restore) return reply.callNotFound()

    return { restore }
  })

  app.put<{ Params: ListParams; Body: OrderRestore }>(
    '/lists/:listId/order/restore',
    {
      bodyLimit: 64 * 1024 * 1024,
      schema: { body: orderRestoreSchema },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      if (!(await restoreOrder(db, user.id, request.params.listId, request.body))) {
        return reply.callNotFound()
      }

      return { restored: true }
    },
  )

  /** A Reset's refusals, as the codes the client words (a hand-made list, a file that no longer parses, a source that is down). */
  function resetError(reply: FastifyReply, cause: unknown): FastifyReply {
    if (cause instanceof ResetUnavailableError) return sendApiError(reply, 409, 'reset.unavailable')
    if (cause instanceof CustomListParseError) {
      return sendApiError(reply, 400, cause.code, cause.params)
    }
    if (cause instanceof IngestionError) {
      return reply.code(502).send({ error: 'Upstream unavailable', message: cause.message })
    }
    throw cause
  }

  // Reset the order: back to the order the source has, nothing else touched; hands back the old order for Undo.
  app.post<{ Params: ListParams }>('/lists/:listId/reset-order', async (request, reply) => {
    const user = getCurrentUser(request)

    try {
      const restore = await resetOrderToSource(db, user.id, request.params.listId, {
        mediaTypes: mediaTypes.list(),
      })
      if (!restore) return reply.callNotFound()

      return { restore }
    } catch (cause) {
      return resetError(reply, cause)
    }
  })

  // What Reset everything would do, in numbers, without doing it (the confirm sentence).
  app.get<{ Params: ListParams }>('/lists/:listId/reset-preview', async (request, reply) => {
    const user = getCurrentUser(request)

    try {
      const preview = await previewReset(db, user.id, request.params.listId, {
        mediaTypes: mediaTypes.list(),
      })
      if (!preview) return reply.callNotFound()

      return preview
    } catch (cause) {
      return resetError(reply, cause)
    }
  })

  app.post<{ Params: ListParams }>('/lists/:listId/reset', async (request, reply) => {
    const user = getCurrentUser(request)

    try {
      const result = await resetToSource(db, user.id, request.params.listId, {
        mediaTypes: mediaTypes.list(),
      })
      if (!result) return reply.callNotFound()

      return result
    } catch (cause) {
      return resetError(reply, cause)
    }
  })

  app.put<{ Params: ItemParams; Body: { consumed: boolean } }>(
    '/lists/:listId/items/:itemId/consumed',
    {
      schema: {
        body: {
          type: 'object',
          required: ['consumed'],
          additionalProperties: false,
          properties: { consumed: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId, itemId } = request.params
      const updated = await setListItemConsumed(db, user.id, listId, itemId, request.body.consumed)
      if (!updated) return reply.callNotFound()

      return updated
    },
  )
}
