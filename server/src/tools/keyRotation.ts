import { compareVersions } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * The declaration of a bridge release of a key rotation (BL-141). A bridge release is signed with the OLD key, the one the installed apps trust,
 * while its own config already carries the NEW one. The tools that judge its signatures (`release:verify`, the canary, and the signing itself)
 * must know which key that is without guessing it from the files, so the release says so in a file committed WITH it:
 *
 *   { "bridges": { "v1.2.0": { "signedWithKeyOf": "v1.1.1" } } }
 *
 * Each tool reads the file from the tree of the tag it judges, and uses the entry of that tag alone (an entry stays in the file for good, and
 * means nothing for any other tag). The file lives in `server/src/tools`, a reviewed path: a change to it is in the diff `release:ship` makes the
 * owner read before the passphrase. It only ever names a key that is already trusted (the config of an older PUBLISHED release), so it cannot
 * make a tool accept a key of the pusher's choosing; the older release must be published, and the checked release's own key must be another one
 * (`release:verify`), and the signing refuses a tag whose declaration and flags disagree (`release:sign`).
 */

export const KEY_ROTATION_PATH = 'server/src/tools/keyRotation.json'

const isTag = (value: unknown): value is string => typeof value === 'string' && value.startsWith('v') && RELEASE_VERSION.test(value.slice(1)) && !value.includes('-')

/** The bridge releases and the older release whose key signed each, or a sentence saying what is wrong with the file. */
export function parseKeyRotation(text: string): { bridges: Map<string, string> } | string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return `${KEY_ROTATION_PATH} is not JSON`
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return `${KEY_ROTATION_PATH} must be an object`
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== 'bridges') return `${KEY_ROTATION_PATH} says only "bridges"`
  const bridges = (data as { bridges: unknown }).bridges
  if (typeof bridges !== 'object' || bridges === null || Array.isArray(bridges)) return `${KEY_ROTATION_PATH}: "bridges" must be an object`

  const result = new Map<string, string>()
  for (const [tag, entry] of Object.entries(bridges)) {
    if (!isTag(tag)) return `${KEY_ROTATION_PATH}: ${JSON.stringify(tag).slice(0, 40)} is not a tag (like v1.2.0)`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || Object.keys(entry).length !== 1 || !('signedWithKeyOf' in entry)) {
      return `${KEY_ROTATION_PATH}: the entry of ${tag} says only "signedWithKeyOf"`
    }
    const from = (entry as { signedWithKeyOf: unknown }).signedWithKeyOf
    if (!isTag(from)) return `${KEY_ROTATION_PATH}: signedWithKeyOf of ${tag} is not a tag (like v1.1.1)`
    if (compareVersions(from.slice(1), tag.slice(1)) >= 0) return `${KEY_ROTATION_PATH}: ${tag} cannot be signed with the key of ${from}: it has to be an older release`
    result.set(tag, from)
  }

  return { bridges: result }
}

/**
 * What the tree of `tag` declares about `tag` itself: the older release whose key signed it (`from`), nothing (`{}`: no file in that tree, which is
 * every release before this file existed, or no entry for the tag), or a problem, which is never guessed around.
 */
export function declaredSignerOf(text: string | undefined, tag: string): { from?: string } | { problem: string } {
  if (text === undefined) return {}
  const parsed = parseKeyRotation(text)
  if (typeof parsed === 'string') return { problem: parsed }
  const from = parsed.bridges.get(tag)

  return from === undefined ? {} : { from }
}
