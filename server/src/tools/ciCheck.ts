import { REPO, type Runner } from './releaseSign.js'
import { runChecked } from './runChecked.js'
import { short } from './toolText.js'

/**
 * The CI gate of a release, shared by `release:prepare` (31.3, HEAD before the version commit) and `release:ship` (31.5, the commit
 * the tag points at): the latest `ci.yml` run of exactly that commit must be green.
 */

export interface CiRun {
  id: number
  status: string
  conclusion: string
  createdAt: string
  headSha: string
}

const RUN_FIELDS = 'databaseId,status,conclusion,createdAt,headSha'

/** The runs `gh run list` printed, as `CiRun`s. */
function readRuns(stdout: string): CiRun[] {
  return (JSON.parse(stdout) as { databaseId: number; status: string; conclusion: string; createdAt: string; headSha: string }[]).map((entry) => ({
    id: entry.databaseId,
    status: entry.status,
    conclusion: entry.conclusion,
    createdAt: entry.createdAt,
    headSha: entry.headSha,
  }))
}

/** The `ci.yml` runs of one commit, as GitHub lists them. */
export async function listCiRuns(run: Runner, commit: string, cwd?: string): Promise<CiRun[]> {
  const result = await runChecked(run, 'gh run list', 'gh', ['run', 'list', '--repo', REPO, '--workflow', 'ci.yml', '--commit', commit, '--json', RUN_FIELDS, '--limit', '20'], cwd === undefined ? undefined : { cwd })

  return readRuns(result.stdout)
}

/** The verdict on the latest `ci.yml` run of `head`: a sentence for what is wrong, or the run when it is green. */
export function ciVerdict(runs: readonly CiRun[], head: string): { run: CiRun } | { problem: string } {
  const latest = runs.filter((run) => run.headSha === head).sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))[0]
  if (latest === undefined) return { problem: `No ci.yml run on ${short(head)}: push it to main and wait for the run, or start one with gh workflow run ci.yml` }
  if (latest.status !== 'completed') return { problem: `The latest ci.yml run on ${short(head)} (run ${latest.id}) is ${latest.status}: wait for it to finish` }
  if (latest.conclusion !== 'success') return { problem: `The latest ci.yml run on ${short(head)} (run ${latest.id}) ended ${latest.conclusion}` }

  return { run: latest }
}

/**
 * The canary gate of a release (BL-127): the newest run of `canary.yml` must be green and not older than this. The canary runs once a day
 * (05:17 UTC), so a day and a half is "it ran this morning, or yesterday's did and today's is late"; older means it did not run.
 */
export const CANARY_MAX_AGE_HOURS = 36

/** What to do when the canary's schedule seems off: GitHub does it silently, so nothing else says so. */
const SCHEDULE_OFF =
  'The schedule may be switched off: GitHub switches the scheduled workflows of a public repository off after 60 days with no activity, and says nothing. Enable it in the Actions tab ("Canary", Enable workflow), then start a run with gh workflow run canary.yml and wait for it'

/** The runs of the canary workflow, newest first as GitHub lists them. Not about a commit: the canary looks at the published releases. */
export async function listCanaryRuns(run: Runner, cwd?: string): Promise<CiRun[]> {
  const result = await runChecked(run, 'gh run list', 'gh', ['run', 'list', '--repo', REPO, '--workflow', 'canary.yml', '--json', RUN_FIELDS, '--limit', '20'], cwd === undefined ? undefined : { cwd })

  return readRuns(result.stdout)
}

/** The verdict on the newest canary run at `now`: a sentence for what is wrong (red, unfinished, missing, or too old), or the run. */
export function canaryVerdict(runs: readonly CiRun[], now: Date): { run: CiRun } | { problem: string } {
  const newest = [...runs].sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))[0]
  if (newest === undefined) return { problem: `No canary run was found: start one with gh workflow run canary.yml and wait for it. ${SCHEDULE_OFF}` }

  const wrong: string[] = []
  if (newest.status !== 'completed') wrong.push(`is ${newest.status}: wait for it to finish`)
  else if (newest.conclusion !== 'success') wrong.push(`ended ${newest.conclusion}`)
  const hours = (now.getTime() - Date.parse(newest.createdAt)) / 3_600_000
  const old = Number.isNaN(hours) || hours > CANARY_MAX_AGE_HOURS
  if (Number.isNaN(hours)) wrong.push('has no readable start time')
  else if (old) wrong.push(`is ${Math.round(hours)} hours old (more than ${CANARY_MAX_AGE_HOURS})`)
  if (wrong.length === 0) return { run: newest }

  return { problem: `The newest canary run (run ${newest.id}) ${wrong.join(' and ')}.${old ? ` ${SCHEDULE_OFF}` : ''}` }
}

