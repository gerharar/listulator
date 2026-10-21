import { RELEASE_VERSION } from './versionSources.js'

/**
 * The small helpers every release tool (`release:prepare`, `release:verify`, `release:audit`, `release:ship` and the CI gate) used to
 * carry its own copy of: what an error says, a commit as the owner reads it, and which tags are stable releases.
 */

/** What an error says, whatever was thrown. */
export const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A commit the way a person reads it. */
export const short = (commit: string): string => commit.slice(0, 12)

/** `v` + a version with no pre-release part: a stable release, never a release candidate. */
export const isStableTag = (value: string): boolean => value.startsWith('v') && !value.includes('-') && RELEASE_VERSION.test(value.slice(1))
