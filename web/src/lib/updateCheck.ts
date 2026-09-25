import type { api as Api, MediaList } from './api.js'
import type { PendingUpdates } from './pendingUpdates.js'

/** Only what these need from the API, so a test can hand in a stub. */
export interface UpdateApi {
  checkForUpdates: typeof Api.checkForUpdates
  importItems: typeof Api.importItems
}

interface Deps {
  api: UpdateApi
  pending: PendingUpdates
}

export interface CheckSummary {
  checked: number
  /** Lists that turned out to have something new. */
  found: number
  failed: { listId: string; title: string; message: string }[]
}

/**
 * Home's explicit check (owner ruling, 10.22c): every list that has a source,
 * one at a time, recording each finding the moment it arrives so its band can
 * appear while the rest are still being looked at. A list it cannot reach keeps
 * whatever entry it had and is reported at the end. Returns `null` when a check
 * is already running.
 */
export async function checkLists(lists: readonly MediaList[], { api, pending }: Deps): Promise<CheckSummary | null> {
  if (pending.isChecking()) return null
  pending.setChecking(true)

  const summary: CheckSummary = { checked: 0, found: 0, failed: [] }

  try {
    for (const list of lists) {
      if (!list.externalRef) continue
      summary.checked += 1

      let count: number
      try {
        count = (await api.checkForUpdates(list.id, false)).newItems.length
      } catch (cause) {
        summary.failed.push({
          listId: list.id,
          title: list.title,
          message: cause instanceof Error ? cause.message : String(cause),
        })
        continue
      }

      // Not inside the try: failing to remember a finding is not "could not reach the source".
      await pending.set(list.id, count)
      if (count > 0) summary.found += 1
    }
  } finally {
    pending.setChecking(false)
  }

  return summary
}

/** One list's own check: records what it found and says how many. A failure goes through. */
export async function checkList(listId: string, { api, pending }: Deps): Promise<number> {
  const result = await api.checkForUpdates(listId, false)
  await pending.set(listId, result.newItems.length)

  return result.newItems.length
}

/**
 * Update List: asks the source again (what was counted may be out of date) and
 * adds what is new as arrivals, so it shows as NEW until marked seen. Items the
 * reader deleted are never among them: a check skips those. Returns how many
 * were added; the entry is cleared once there is nothing left to offer, and
 * kept if the source or the add fails.
 */
export async function applyUpdate(listId: string, { api, pending }: Deps): Promise<number> {
  const result = await api.checkForUpdates(listId, false)

  if (result.newItems.length > 0) {
    await api.importItems(listId, result.newItems, 'import', true)
  }
  await pending.remove(listId)

  return result.newItems.length
}
