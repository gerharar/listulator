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

  app.delete<{ Params: ListParams }>('/lists/:listId', async (request, reply) => {
    const user = getCurrentUser(request)
    if (!(await deleteList(db, user.id, request.params.listId))) return reply.callNotFound()

    return reply.code(204).send()
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
    if (!(await deleteListItem(db, user.id, listId, itemId))) return reply.callNotFound()

    return reply.code(204).send()
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

  app.delete<{ Params: GroupParams }>('/lists/:listId/groups/:groupId', async (request, reply) => {
    const user = getCurrentUser(request)
    const { listId, groupId } = request.params

    try {
      if (!(await deleteListGroup(db, user.id, listId, groupId))) return reply.callNotFound()

      return reply.code(204).send()
    } catch (cause) {
      if (cause instanceof GroupNotEmptyError) return sendApiError(reply, 409, 'group.notEmpty')
      throw cause
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
