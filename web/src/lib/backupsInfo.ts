import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './platform.js'

/** Where the copies of the database are and how many of ours there are (`backup.rs`, `Info`). */
export interface BackupsInfo {
  folder: string
  count: number
}

/**
 * Whether the desktop app has kept a copy of the database, for the screen that says the lists would not load (task 52.3). The app's own
 * command `backups_info` (lib.rs; the isolation hook lets it through with no payload) answers; `null` when there is no copy, no app (the
 * browser build), or no answer. It never throws: it only adds a sentence to a screen that already says something failed.
 */
export async function getBackupsInfo(): Promise<BackupsInfo | null> {
  if (!isDesktop()) return null
  try {
    return (await invoke<BackupsInfo | null>('backups_info')) ?? null
  } catch {
    return null
  }
}
