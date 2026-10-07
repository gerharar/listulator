import type { List } from '../db/schema.js'

/**
 * Whether a list can be reset to a source at all, worked out from the list alone (task 15, Checkpoint C):
 * so the app can leave Reset out where it could only fail, and never show "no source to reset it to".
 *
 * A hand-made list has none. A list imported from a file is rebuilt from the stored copy of that file, and
 * one imported before the file was kept (September 2026, migration 0014) has none to go back to. Everything
 * else (a fetched list, a community-library list) has its source, which `Reset` reads when it runs: a source
 * that is down is a different, temporary refusal.
 *
 * Takes whether a file is stored, not the file: the text can be megabytes, and the overview asks this of every list (BL-075).
 */
export function listCanBeReset(list: Pick<List, 'source'> & { hasStoredFile: boolean }): boolean {
  if (list.source === 'manual') return false
  if (list.source === 'file') return list.hasStoredFile

  return true
}
