/**
 * Puts rows that were taken out at once (an optimistic delete the server then refused) back into the list as it is NOW, each after the row that
 * preceded it at the click. Only those rows move: a snapshot of the whole list taken at the click would also undo what changed since (BL-109).
 * A row that is already back (a refresh brought it) is left alone.
 */
export function putBack<T extends { id: string }>(current: readonly T[], before: readonly T[], removed: readonly T[]): T[] {
  const result = [...current]

  for (const row of before.filter((entry) => removed.some((gone) => gone.id === entry.id))) {
    if (result.some((entry) => entry.id === row.id)) continue

    // The nearest row before it at the click that is still here; none means it was first.
    let at = 0

    for (let index = before.findIndex((entry) => entry.id === row.id) - 1; index >= 0; index -= 1) {
      const anchor = result.findIndex((entry) => entry.id === before[index]!.id)

      if (anchor !== -1) {
        at = anchor + 1
        break
      }
    }

    result.splice(at, 0, row)
  }

  return result
}
