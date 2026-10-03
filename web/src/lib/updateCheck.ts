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
  /**
   * Which source a list is checked against (BL-054): no two lists of one source are checked at once, so each
   * source's own pacing holds and none is asked more than it allows. Home says it from the category's source
   * (TMDB, MusicBrainz, ...) and the community library for a canonical list. Absent, every list is its own
   * kind of source's worth: they go one after another, as before.
   */
  sourceOf?: (list: MediaList) => string
}

/** How many lists an explicit check looks at together, at most, when they are of different sources. */
export const CHECK_CONCURRENCY = 4

export interface CheckSummary {
  checked: number
  /** Lists that turned out to have something new. */
  found: number
  failed: { listId: string; title: string; message: string }[]
}

/**
 * Home's explicit check (owner ruling, 10.22c): every list that has a source, recording each finding the
 * moment it arrives so its band can appear while the rest are still being looked at. A list it cannot reach
 * keeps whatever entry it had and is reported at the end. Returns `null` when a check is already running.
 *
 * Up to `CHECK_CONCURRENCY` lists at once, **never two of the same source** (BL-054, owner: "option 1 is OK,
 * if it's robust"): one at a time took the sum of every wait (19 s for 21 lists), and lists of different
 * sources do not wait on each other. Each source's own pacing still holds, since it only ever sees one
 * list at a time from here. The order is the order shown, except that a list whose source is busy lets the
 * ones behind it go first.
 *
 * Robust by construction: no check is abandoned or left running when the run ends (it ends when every
 * started check has), one list failing or failing to be remembered never stops the others, and a failure to
 * remember a finding is raised after everything has finished, as it was when this ran one at a time.
 */
export async function checkLists(lists: readonly MediaList[], { api, pending, sourceOf }: Deps): Promise<CheckSummary | null> {
  if (pending.isChecking()) return null
  pending.setChecking(true)

  const summary: CheckSummary = { checked: 0, found: 0, failed: [] }
  const failures: { index: number; failure: CheckSummary['failed'][number] }[] = []
  let remembering: unknown

  const queue = lists.flatMap((list, index) => (list.externalRef ? [{ list, index, source: sourceOf?.(list) ?? '' }] : []))
  const busy = new Set<string>()
  const running = new Set<Promise<void>>()

  async function check({ list, index }: (typeof queue)[number]): Promise<void> {
    summary.checked += 1

    let count: number
    try {
      count = (await api.checkForUpdates(list.id, false)).newItems.length
    } catch (cause) {
      failures.push({
        index,
        failure: { listId: list.id, title: list.title, message: cause instanceof Error ? cause.message : String(cause) },
      })
      return
    }

    // Not with the check: failing to remember a finding is not "could not reach the source".
    try {
      await pending.set(list.id, count)
      if (count > 0) summary.found += 1
    } catch (cause) {
      remembering ??= cause
    }
  }

  try {
    while (queue.length > 0 || running.size > 0) {
      // Start what can start: room in the run, and the next list whose source is idle.
      while (running.size < CHECK_CONCURRENCY) {
        const at = queue.findIndex((job) => !busy.has(job.source))
        if (at === -1) break

        const [job] = queue.splice(at, 1)
        busy.add(job!.source)
        const task: Promise<void> = check(job!).finally(() => {
          busy.delete(job!.source)
          running.delete(task)
        })
        running.add(task)
      }

      if (running.size === 0) break
      await Promise.race(running)
    }
  } finally {
    pending.setChecking(false)
  }

  summary.failed = failures.sort((a, b) => a.index - b.index).map((entry) => entry.failure)
  if (remembering !== undefined) throw remembering

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
