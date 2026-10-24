import { copy } from '../../locale/index.js'
import { resetLocalMediaTypes } from '../ingestion/localMediaTypes.js'
import { notifyRegistryChanged } from '../registryChanges.js'
import { updateLocalSettings, type LocalSettings } from './localConfig.js'
import type { KeySource } from './keyTest.js'

/**
 * What Settings' key rows and the key card (H-018) share: which saved settings make up each source's key, how a key is saved, and the sentence
 * that says what to paste first. They live here, not in a screen, so a component can use them without importing one.
 */

/** Which saved settings make up each source's key (IGDB needs an ID and a secret). */
export const KEY_FIELDS: readonly { id: KeySource; fields: readonly (keyof LocalSettings)[] }[] = [
  { id: 'tmdb', fields: ['tmdbApiKey'] },
  { id: 'igdb', fields: ['igdbClientId', 'igdbClientSecret'] },
  { id: 'comicVine', fields: ['comicVineApiKey'] },
  { id: 'youtube', fields: ['youtubeApiKey'] },
]

/** Saves the changed key fields, rebuilds the search sources from them, and tells the app to ask them again (16.5). */
export async function saveAndReload(patch: Partial<LocalSettings>): Promise<void> {
  await updateLocalSettings(patch)
  resetLocalMediaTypes()
  notifyRegistryChanged()
}

/** The one sentence for a row of key fields with `missing` empty ones among `fields`: the key, both, or the one that is empty. */
export function pasteSentence(fields: readonly (keyof LocalSettings)[], missing: readonly (keyof LocalSettings)[]): string {
  const text = copy.quantum.settings.keys

  if (fields.length === 1) return text.pasteKey
  if (missing.length === fields.length) return text.pasteBoth

  return missing[0] === fields[0] ? text.pasteClientId : text.pasteClientSecret
}
