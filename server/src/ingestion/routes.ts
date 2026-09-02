import type { FastifyPluginAsync } from 'fastify'
import { getCurrentUser } from '../auth/currentUser.js'
import { createListItem, findList } from '../catalog/repository.js'
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
