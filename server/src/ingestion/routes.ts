import type { FastifyPluginAsync } from 'fastify'
import { getCurrentUser } from '../auth/currentUser.js'
import { createList, createListItem, findList, findListWithStats } from '../catalog/repository.js'
import { IngestionError } from './http.js'
import type { AppDatabase } from '../db/client.js'
import type { MediaTypeRegistry } from './mediaTypes.js'

export interface IngestionRoutesOptions {
  db: AppDatabase
  mediaTypes: MediaTypeRegistry
}

interface ImportItem {
  title: string
  timeToConsumeMinutes?: number
  externalRef?: string
}

export const ingestionRoutes: FastifyPluginAsync<IngestionRoutesOptions> = async (
  app,
  { db, mediaTypes },
) => {
  // Upstream being down or rate-limiting is not a bug in this app, and the
  // message says which service and what to do about it.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IngestionError) {
      return reply.code(502).send({ error: 'Upstream unavailable', message: error.message })
    }

    request.log.error(error)
    return reply.send(error)
  })

  /**
   * Finds things that could become a whole list — an artist, a filmography —
   * rather than individual items. See SearchAdapter.
   */
  app.get<{ Params: { key: string }; Querystring: { q?: string } }>(
    '/media-types/:key/search',
    async (request, reply) => {
      getCurrentUser(request)

      const mediaType = mediaTypes.get(request.params.key)
      if (!mediaType) return reply.callNotFound()

      const query = request.query.q?.trim()
      if (!query) return reply.code(400).send({ message: 'Give me something to search for.' })

      if (!mediaType.adapter?.isAvailable()) {
        // Not an error: plenty of categories will never have search, and the
        // manual path always works.
        return reply
          .code(409)
          .send({ message: `Search is not available for ${mediaType.label}. Add items by hand.` })
      }

      return { sources: await mediaType.adapter.search(query) }
    },
  )

  /**
   * Creates a list from a searched source, importing everything it expands to.
   * One step rather than preview-then-import: the list is trivially deletable,
   * and its items are editable once it exists.
   */
  app.post<{ Body: { mediaType: string; externalRef: string; title: string } }>(
    '/lists/from-source',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mediaType', 'externalRef', 'title'],
          additionalProperties: false,
          properties: {
            mediaType: { type: 'string', minLength: 1 },
            externalRef: { type: 'string', minLength: 1, maxLength: 500 },
            title: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { mediaType: key, externalRef, title } = request.body

      const mediaType = mediaTypes.get(key)
      if (!mediaType) return reply.code(400).send({ message: `Unknown category "${key}".` })

      if (!mediaType.adapter?.isAvailable()) {
        return reply
          .code(409)
          .send({ message: `Search is not available for ${mediaType.label}. Add items by hand.` })
      }

      // Expanded before the list is created, so a failure upstream does not
      // leave an empty list behind.
      const candidates = await mediaType.adapter.expand(externalRef)
      if (candidates.length === 0) {
        return reply.code(422).send({ message: `Found nothing to import for "${title}".` })
      }

      const list = createList(db, user.id, { title, mediaType: key, source: 'api', externalRef })

      for (const candidate of candidates) {
        const known = candidate.timeToConsumeMinutes !== undefined

        createListItem(db, user.id, list.id, {
          title: candidate.title,
          timeToConsumeMinutes: known
            ? candidate.timeToConsumeMinutes!
            : mediaType.defaultDurationMinutes,
          timeToConsumeIsEstimated: !known,
        })
      }

      return reply.code(201).send(findListWithStats(db, user.id, list.id))
    },
  )

  /**
   * The UI renders a bucket per category — including ones with no lists yet —
   * so it needs the whole registry, not just the categories in use.
   */
  app.get('/media-types', async () =>
    mediaTypes.list().map(({ key, label, sortOrder, defaultDurationMinutes, adapter }) => ({
      key,
      label,
      sortOrder,
      defaultDurationMinutes,
      // Whether search is offered for this category. Manual entry always works.
      searchAvailable: adapter?.isAvailable() ?? false,
    })),
  )

  /**
   * Bulk-adds items to a list — the single write path for every ingestion
   * route. Manual entry uses it directly today; Phase 3a's adapters will
   * resolve candidates and hand them to the same endpoint.
   *
   * Durations left out are filled from the category's default and marked
   * estimated, which is how `time_to_consume_minutes` stays NOT NULL without
   * the catalog ever inventing a number (SPEC.md §4, §5).
   */
  app.post<{ Params: { listId: string }; Body: { items: ImportItem[] } }>(
    '/lists/:listId/items/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['title'],
                additionalProperties: false,
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 500 },
                  timeToConsumeMinutes: { type: 'integer', minimum: 0 },
                  externalRef: { type: 'string', maxLength: 500 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId } = request.params

      const list = findList(db, user.id, listId)
      if (!list) return reply.callNotFound()

      // A list's category is validated on write, but a registry entry can be
      // removed while lists still reference it; fall back rather than crash.
      const fallbackMinutes = mediaTypes.get(list.mediaType)?.defaultDurationMinutes ?? 30

      const created = request.body.items.map((item) => {
        const known = item.timeToConsumeMinutes !== undefined

        return createListItem(db, user.id, listId, {
          title: item.title,
          timeToConsumeMinutes: known ? item.timeToConsumeMinutes! : fallbackMinutes,
          timeToConsumeIsEstimated: !known,
        })
      })

      return reply.code(201).send(created)
    },
  )
}
