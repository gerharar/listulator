import type { Page } from '@playwright/test'

/**
 * Every spec that just needs Home to render normally was implicitly
 * depending on whatever happens to be in the dev database (currently one
 * row, "Test Layer Stack List") — an empty database now boots straight
 * into the first-run create flow (task 10.10) rather than showing "My
 * Lists" at all, so a fresh clone, a CI run, or the owner deleting that
 * one row during their own click-through would have silently broken most
 * of this suite. `GET /api/lists` is intercepted with one canned,
 * canonical, complete-status list instead — everything else (`POST`,
 * individual list routes) passes through to the real server untouched, so
 * specs that create/delete their own real rows (`no-native-dialogs.spec.ts`,
 * `first-run.spec.ts`'s second test) are unaffected.
 */
export const FIXTURE_LIST_ID = 'fixture-list-1'
export const FIXTURE_LIST_TITLE = 'Fixture Franchise'

export async function useHomeFixture(page: Page): Promise<void> {
  await page.route('**/api/lists', (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      json: [
        {
          id: FIXTURE_LIST_ID,
          title: FIXTURE_LIST_TITLE,
          description: null,
          // A real key from the registry, not an invented one — an
          // unrecognized key would land the row in the Uncategorised
          // bucket instead of exercising a normal one.
          mediaType: 'movie',
          source: 'canonical',
          externalRef: null,
          status: 'complete',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          stats: {
            totalItems: 10,
            consumedItems: 4,
            completionPercent: 40,
            timeRemainingMinutes: 360,
            lastConsumedAt: null,
          },
        },
      ],
    })
  })
}
