import type { ListItem } from '../../lib/api.js'

/** How many of a list's items are still waiting for their length to be looked up (15.7). */
export const countRuntimesPending = (items: readonly ListItem[]): number =>
  items.filter((item) => item.runtimePending).length

/**
 * What a re-read of the list changes on the screen while lengths are coming in (15.7): only the length of an
 * item that was waiting for one and now has it. Nothing else is taken from the re-read: not its order, its
 * titles, its ticks, nor items the screen does not have (or has since removed), so a re-read that crosses a
 * drag or an edit cannot undo it. An item that was not waiting is never touched, so a time the user set is
 * never replaced by an older one. When nothing arrived the same array comes back, and nothing is redrawn.
 */
export function mergeArrivedRuntimes(current: ListItem[], fresh: readonly ListItem[]): ListItem[] {
  const byId = new Map(fresh.map((item) => [item.id, item]))
  let arrivedAny = false

  const merged = current.map((item) => {
    if (!item.runtimePending) return item

    const arrived = byId.get(item.id)
    if (!arrived || arrived.runtimePending || arrived.timeToConsumeIsEstimated) return item

    arrivedAny = true

    return {
      ...item,
      timeToConsumeMinutes: arrived.timeToConsumeMinutes,
      timeToConsumeIsEstimated: false,
      runtimePending: false,
    }
  })

  return arrivedAny ? merged : current
}
