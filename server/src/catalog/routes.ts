import type { FastifyPluginAsync } from 'fastify'
import { getCurrentUser } from '../auth/currentUser.js'
import type { AppDatabase } from '../db/client.js'
import type { ListSource } from '../db/schema.js'
import type { MediaTypeRegistry } from '../ingestion/mediaTypes.js'
import {
  createList,
  createListItem,
  deleteList,
  deleteListItem,
  findListItems,
  findListWithStats,
  findListsWithStats,
  setListItemConsumed,
  updateList,
  updateListItem,
} from './repository.js'

const LIST_SOURCES = ['api', 'llm', 'manual'] as const

/**
 * Built from the registry at registration time, so adding a category is still
 * a single registry entry — the validation follows automatically, with no
 * schema to keep in sync (SPEC.md §5).
 */
function listBodyProperties(mediaTypes: MediaTypeRegistry) {
  return {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    mediaType: { type: 'string', enum: mediaTypes.keys() },
    source: { type: 'string', enum: LIST_SOURCES },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
  } as const
}

const itemBodyProperties = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  // Required on create: the catalog stores a number, and deciding *which*
  // number when nothing is known is ingestion's job (SPEC.md §5).
  timeToConsumeMinutes: { type: 'integer', minimum: 0 },
  timeToConsumeIsEstimated: { type: 'boolean' },
  orderIndex: { type: 'integer', minimum: 0 },
} as const

interface ListParams {
  listId: string
}

interface ItemParams extends ListParams {
  itemId: string
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
    Body: { title: string; mediaType: string; source?: ListSource; externalRef?: string | null }
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

    return { ...list, items: (await findListItems(db, user.id, list.id)) ?? [] }
  })

  app.patch<{
    Params: ListParams
    Body: { title?: string; mediaType?: string; source?: ListSource; externalRef?: string | null }
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
