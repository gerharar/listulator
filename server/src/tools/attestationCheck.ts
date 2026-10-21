import { join } from 'node:path'
import { reason } from './toolText.js'

/**
 * The attestation check and its negative control, shared by `release:verify` (31.4, the public files) and `release:audit` (31.10,
 * the draft's files): every file must have a build attestation from this repository's release workflow on the tag and the tag's
 * commit, and the same check must REFUSE the previous release's commit. A check that accepts anything proves nothing.
 */

export interface AttestationHost {
  /** The full commit a tag points at. */
  tagCommit(tag: string): Promise<string>
  /** Whether `file` has a build attestation from this repository's release workflow on `tag` and `commit`. */
  verifyAttestation(file: string, tag: string, commit: string): Promise<boolean>
}

export interface AttestationInput {
  /** The folder holding the files, and the names of the files in it to check. */
  dir: string
  names: readonly string[]
  tag: string
  /** The tag's commit. */
  commit: string
  /** The previous release's tag, if there is one; the first release has none and the control is skipped. */
  previous: string | undefined
}

/**
 * Says what it found through `log` (a pass) and `fail` (a failure, one sentence). A file that fails the real check is not put to the
 * control: a refusal of the wrong commit means nothing when the right one is refused as well.
 */
export async function checkAttestations(host: AttestationHost, input: AttestationInput, log: (line: string) => void, fail: (line: string) => void): Promise<void> {
  const { dir, names, tag, commit, previous } = input
  const attested: string[] = []
  for (const name of names) {
    if (await host.verifyAttestation(join(dir, name), tag, commit)) {
      attested.push(name)
      log(`${name}  built by this repository's release workflow on ${tag} (commit ${commit.slice(0, 12)})`)
    } else fail(`${name}: no valid build attestation from this repository's release workflow on ${tag} (commit ${commit.slice(0, 12)})`)
  }

  if (previous === undefined) {
    log('No earlier release: the negative control not run')

    return
  }
  let previousCommit: string | undefined
  try {
    previousCommit = await host.tagCommit(previous)
  } catch (error) {
    fail(`The commit of ${previous} could not be read (${reason(error)}): the negative control was not run`)
  }
  if (previousCommit === commit) fail(`${previous} points at the same commit as ${tag}: the negative control could not tell them apart`)
  else if (previousCommit !== undefined) {
    for (const name of attested) {
      if (await host.verifyAttestation(join(dir, name), tag, previousCommit)) {
        fail(`${name}: the attestation check accepts the previous tag's commit (${previous}) as well, so it proves nothing`)
      } else log(`${name}  refused with the commit of ${previous}, as it must be`)
    }
  }
}
