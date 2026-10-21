import { REPO, type Runner } from './releaseSign.js'
import { runChecked } from './runChecked.js'

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

const short = (commit: string): string => commit.slice(0, 12)

/** The `ci.yml` runs of one commit, as GitHub lists them. */
export async function listCiRuns(run: Runner, commit: string, cwd?: string): Promise<CiRun[]> {
  const result = await runChecked(run, 'gh run list', 'gh', ['run', 'list', '--repo', REPO, '--workflow', 'ci.yml', '--commit', commit, '--json', 'databaseId,status,conclusion,createdAt,headSha', '--limit', '20'], cwd === undefined ? undefined : { cwd })

  return (JSON.parse(result.stdout) as { databaseId: number; status: string; conclusion: string; createdAt: string; headSha: string }[]).map((entry) => ({
    id: entry.databaseId,
    status: entry.status,
    conclusion: entry.conclusion,
    createdAt: entry.createdAt,
    headSha: entry.headSha,
  }))
}

/** The verdict on the latest `ci.yml` run of `head`: a sentence for what is wrong, or the run when it is green. */
export function ciVerdict(runs: readonly CiRun[], head: string): { run: CiRun } | { problem: string } {
  const latest = runs.filter((run) => run.headSha === head).sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))[0]
  if (latest === undefined) return { problem: `No ci.yml run on ${short(head)}: push it to main and wait for the run, or start one with gh workflow run ci.yml` }
  if (latest.status !== 'completed') return { problem: `The latest ci.yml run on ${short(head)} (run ${latest.id}) is ${latest.status}: wait for it to finish` }
  if (latest.conclusion !== 'success') return { problem: `The latest ci.yml run on ${short(head)} (run ${latest.id}) ended ${latest.conclusion}` }

  return { run: latest }
}
