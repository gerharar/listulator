/**
 * Puts rows that were taken out at once (an optimistic delete the server then refused) back into the list as it is NOW, each after the row that
 * preceded it at the click. Only those rows move: a snapshot of the whole list taken at the click would also undo what changed since (BL-109).
 * A row that is already back (a refresh brought it) is left alone.
 *
 * One pass over `before` finds, for each missing row, the nearest row before it at the click that is still here (or is put back just before it),
 * and one pass over `current` writes the result: linear in the size of the list, where a lookup per row made a large group in a 50,000-item list
 * freeze the screen for seconds (BL-123). Two rows never share an anchor: the first one put back becomes the anchor of the next.
 */
export function putBack<T extends { id: string }>(current: readonly T[], before: readonly T[], removed: readonly T[]): T[] {
  const removedIds = new Set(removed.map((row) => row.id))
  const hereIds = new Set(current.map((row) => row.id))
  /** The row to put back right after each anchor (an id, or `null` for the start of the list). */
  const after = new Map<string | null, T>()
  let anchor: string | null = null

  for (const row of before) {
    if (hereIds.has(row.id)) anchor = row.id
    else if (removedIds.has(row.id)) {
      after.set(anchor, row)
      anchor = row.id
    }
    // Any other row of `before` is gone since the click and stays gone: it is not an anchor.
  }

  const result: T[] = []
  const putBackAfter = (key: string | null) => {
    for (let next = after.get(key); next !== undefined; next = after.get(next.id)) result.push(next)
  }

  putBackAfter(null)
  for (const row of current) {
    result.push(row)
    putBackAfter(row.id)
  }

  return result
}
