/**
 * Human phrasing for "when did I last touch this", used to explain why a
 * suggestion was picked. Deliberately vague at the long end — "8 months ago"
 * says everything "on 3 January" does, and reads faster.
 */
export function formatTimeAgo(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'never touched'

  const elapsed = now.getTime() - new Date(iso).getTime()
  const days = Math.floor(elapsed / (24 * 60 * 60 * 1000))

  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`

  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`

  const years = Math.floor(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}
