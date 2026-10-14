import type { ListItem } from '../../lib/api.js'

/** How many of a list's items still wait for the page slug their link needs (H-002, IGDB). */
export const countLinksPending = (items: readonly ListItem[]): number => items.filter((item) => item.linkPending).length

/**
 * What a re-read of the list changes on the screen while links are coming in: only the link of an item that was
 * waiting for one. An item the re-read no longer calls pending is settled, whether the link arrived or the lookup
 * gave up (then it has none and the screen stops waiting for it). Nothing else is taken from the re-read, as with
 * the lengths (`mergeArrivedRuntimes`): not its order, titles or ticks, nor items the screen does not have, so a
 * re-read that crosses a drag or an edit cannot undo it. When nothing changed the same array comes back.
 */
export function mergeArrivedLinks(current: ListItem[], fresh: readonly ListItem[]): ListItem[] {
  const byId = new Map(fresh.map((item) => [item.id, item]))
  let changed = false

  const merged = current.map((item) => {
    if (!item.linkPending) return item

    const reread = byId.get(item.id)
    if (!reread || reread.linkPending) return item

    changed = true

    return { ...item, link: reread.link ?? null, linkPending: false }
  })

  return changed ? merged : current
}
