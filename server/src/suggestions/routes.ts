import type { FastifyPluginAsync } from 'fastify'
import { getCurrentUser } from '../auth/currentUser.js'
import { findListItems, findListsWithStats } from '../catalog/repository.js'
import type { AppDatabase } from '../db/client.js'
import type { ListItem } from '../db/schema.js'
import { rank, type Suggestion } from './engine.js'
import { loadStrategy } from './loader.js'
import { StrategyError } from './strategy.js'

export interface SuggestionsRoutesOptions {
  db: AppDatabase
  /** Overridable so tests can point at fixture strategies. */
  strategiesDir?: string
}

function present(suggestions: Suggestion[]) {
  return {
    // Best first. The UI shows the top pick; the rest are the "or…" options.
    picks: suggestions.map((suggestion) => ({
      list: suggestion.list,
      nextItem: suggestion.nextItem,
      score: suggestion.score,
      factors: suggestion.factors,
    })),
  }
}

export const suggestionsRoutes: FastifyPluginAsync<SuggestionsRoutesOptions> = async (
  app,
  { db, strategiesDir },
) => {
  // A malformed strategy file is a user editing JSON by hand, not a server
  // fault: answer 500 but say exactly what is wrong with which file.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof StrategyError) {
      return reply.code(500).send({ error: 'Invalid strategy', message: error.message })
    }

    request.log.error(error)
    return reply.send(error)
  })

  async function suggest(userId: string, strategyName: string, currentListId?: string) {
    const strategy = strategiesDir ? loadStrategy(strategyName, strategiesDir) : loadStrategy(strategyName)
    const candidates = await findListsWithStats(db, userId)

    // Only the lists that survive filtering need their items loaded. Order
    // doesn't matter for building this map, so these run concurrently.
    const nextItems = new Map<string, ListItem | undefined>(
      await Promise.all(
        candidates.map(
          async (list) =>
            [
              list.id,
              (await findListItems(db, userId, list.id))?.find((item) => item.consumedAt === null),
            ] as const,
        ),
      ),
    )

    return rank({
      strategy,
      candidates,
      nextItems,
      ...(currentListId ? { currentListId } : {}),
    })
  }

  /**
   * Takes the list you are tired of, explicitly. Never inferred from recent
   * activity — "I'm tired of *this*" is a thing the user knows and the server
   * would only be guessing at (SPEC.md §6).
   */
  app.post<{ Body: { currentListId: string } }>(
    '/suggestions/tired-boss',
    {
      schema: {
        body: {
          type: 'object',
          required: ['currentListId'],
          additionalProperties: false,
          properties: { currentListId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      const user = getCurrentUser(request)

      return present(await suggest(user.id, 'tired-boss', request.body.currentListId))
    },
  )

  app.get('/suggestions/suggest', async (request) => {
    const user = getCurrentUser(request)

    return present(await suggest(user.id, 'suggest'))
  })

  app.get('/suggestions/quickie', async (request) => {
    const user = getCurrentUser(request)

    return present(await suggest(user.id, 'quickie'))
  })
}
