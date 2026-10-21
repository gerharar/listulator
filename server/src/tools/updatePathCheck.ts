import { verifyMinisign } from './minisignVerify.js'
import { reason } from './toolText.js'
import { compareVersions, keyIdOfPublicKey } from './updateManifest.js'

/**
 * The UPDATE PATH of a release (Phase 31, task 31.9), as the app that is already installed would walk it: an installed copy of the
 * previous release asks the address its OWN config carries, reads the version the feed announces, and downloads the new update file only if
 * its signature verifies against the key its OWN config carries. The production app cannot be driven from outside (the spike found that
 * its debugging flag never reaches the browser), so this is the same decision made from its inputs: what that release embedded, and what
 * the feed serves now. It is checked for the newest release only, because the feed serves nothing else.
 */

export interface UpdatePathHost {
  /** `plugins.updater.pubkey` as written in a tag's config. */
  pubkey(tag: string): Promise<string>
  /** `plugins.updater.endpoints` as written in a tag's config. */
  updaterEndpoints(tag: string): Promise<string[]>
}

export interface UpdatePathInput {
  /** The release served by the feed, and the one before it. */
  tag: string
  previous: string
  /** The address the feed is read from. */
  feedUrl: string
  /** `latest.json`, parsed; undefined when it could not be read (that failure is already reported). */
  manifest: unknown
  /** The update files the manifest signs, with the bytes that were downloaded. */
  files: readonly { name: string; data: Buffer; signature: string }[]
}

/** Says what it found through `log` (everything passes, in one line) and `fail` (one sentence for each thing that does not). */
export async function checkUpdatePath(host: UpdatePathHost, input: UpdatePathInput, log: (line: string) => void, fail: (line: string) => void): Promise<void> {
  const { tag, previous, feedUrl, manifest, files } = input
  let problems = 0
  const bad = (line: string) => {
    problems++
    fail(line)
  }

  // 1. The address an installed copy of the previous release asks.
  try {
    const endpoints = await host.updaterEndpoints(previous)
    if (endpoints.length === 0) bad(`An installed ${previous} asks no address: it would never look for ${tag}`)
    else if (!endpoints.includes(feedUrl)) bad(`An installed ${previous} asks ${endpoints.join(', ')}, not ${feedUrl}: it would never see ${tag}`)
  } catch (error) {
    bad(`The update address of ${previous} could not be read: ${reason(error)}`)
  }

  // 2. Whether it is offered this version: the feed must announce a newer one than the installed copy has.
  if (manifest !== undefined) {
    const announced = (manifest as { version?: unknown } | null)?.version
    const shown = typeof announced === 'string' ? announced.slice(0, 40) : (JSON.stringify(announced) ?? 'no version')?.slice(0, 40)
    let offered = false
    try {
      offered = typeof announced === 'string' && compareVersions(announced, previous.slice(1)) > 0
    } catch {
      // not a version: it is not offered either
    }
    if (!offered) bad(`An installed ${previous} would not be offered ${tag}: the feed announces ${shown}`)
  }

  // 3. Whether it accepts the update files: their signatures must verify against the key IT carries, which a rotation changes.
  let key: string | undefined
  try {
    key = await host.pubkey(previous)
  } catch (error) {
    bad(`The updater public key of ${previous} could not be read: ${reason(error)}`)
  }
  if (key !== undefined && keyIdOfPublicKey(key) === undefined) {
    bad(`The updater public key of ${previous} is not a minisign public key, so what an installed copy accepts cannot be checked`)
    key = undefined
  }
  if (key !== undefined) {
    for (const { name, data, signature } of files) {
      const verdict = verifyMinisign(key, signature, data)
      if (!verdict.ok) bad(`${name}: an installed ${previous} would reject this update: ${verdict.reason}`)
    }
  }

  if (problems === 0 && files.length > 0) log(`An installed ${previous} asks ${feedUrl}, is offered ${tag} and accepts the signatures of ${files.map((file) => file.name).join(' and ')}`)
}
