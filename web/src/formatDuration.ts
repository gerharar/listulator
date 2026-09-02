/**
 * Formats a `time_to_consume_minutes` value for display.
 * Minutes are the storage unit everywhere (SPEC.md §4).
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}
