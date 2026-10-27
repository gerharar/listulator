import { describe, expect, it } from 'vitest'
import { CANARY_MAX_AGE_HOURS, canaryVerdict, listCanaryRuns, type CiRun } from './ciCheck.js'
import type { Runner } from './releaseSign.js'

/**
 * The canary gate of a release (BL-127): `release:prepare` refuses unless the newest run of `canary.yml` is green and under about 36
 * hours old. The canary is not about a commit (it looks at the published releases), so unlike the CI gate it asks only "newest, and how old".
 */

const NOW = new Date('2026-10-22T09:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
const run = (over: Partial<CiRun> = {}): CiRun => ({ id: 10, status: 'completed', conclusion: 'success', createdAt: hoursAgo(4), headSha: 'a'.repeat(40), ...over })

describe('canaryVerdict', () => {
  it('passes a green run of today, and says which run it is', () => {
    expect(canaryVerdict([run()], NOW)).toEqual({ run: run() })
  })

  it('judges the newest run, not the best: a red run after a green one refuses', () => {
    const verdict = canaryVerdict([run({ id: 1, createdAt: hoursAgo(28) }), run({ id: 2, createdAt: hoursAgo(4), conclusion: 'failure' })], NOW)

    expect(verdict).toMatchObject({ problem: expect.stringMatching(/run 2.*failure/) })
  })

  it('judges a green run after a red one by the green one', () => {
    const verdict = canaryVerdict([run({ id: 1, createdAt: hoursAgo(28), conclusion: 'failure' }), run({ id: 2, createdAt: hoursAgo(4) })], NOW)

    expect(verdict).toMatchObject({ run: { id: 2 } })
  })

  it('takes the higher run id when two were made at the same second', () => {
    const verdict = canaryVerdict([run({ id: 5, conclusion: 'failure' }), run({ id: 6 })], NOW)

    expect(verdict).toMatchObject({ run: { id: 6 } })
  })

  it('refuses a run that is not finished, and says to wait', () => {
    expect(canaryVerdict([run({ status: 'in_progress', conclusion: '' })], NOW)).toMatchObject({ problem: expect.stringMatching(/run 10.*in_progress.*wait/i) })
  })

  it.each(['failure', 'cancelled', 'timed_out'])('refuses a run that ended %s, naming it', (conclusion) => {
    expect(canaryVerdict([run({ conclusion })], NOW)).toMatchObject({ problem: expect.stringContaining(conclusion) })
  })

  it('refuses when the canary has never run, and says how to start one', () => {
    const verdict = canaryVerdict([], NOW)

    expect(verdict).toMatchObject({ problem: expect.stringMatching(/no canary run/i) })
    expect(verdict).toMatchObject({ problem: expect.stringContaining('gh workflow run canary.yml') })
  })

  it('accepts a run just under the age limit and refuses one just over it', () => {
    expect('run' in canaryVerdict([run({ createdAt: hoursAgo(CANARY_MAX_AGE_HOURS - 0.1) })], NOW)).toBe(true)
    expect('problem' in canaryVerdict([run({ createdAt: hoursAgo(CANARY_MAX_AGE_HOURS + 0.1) })], NOW)).toBe(true)
  })

  it('says a green run that is too old means the schedule may be switched off, how GitHub does that, and what to do', () => {
    const verdict = canaryVerdict([run({ createdAt: hoursAgo(70) })], NOW)

    expect(verdict).toMatchObject({ problem: expect.stringMatching(/run 10.*70 hours old/) })
    expect(verdict).toMatchObject({ problem: expect.stringMatching(/switched off.*60 days.*no activity|60 days.*switched off/i) })
    expect(verdict).toMatchObject({ problem: expect.stringContaining('Actions tab') })
    expect(verdict).toMatchObject({ problem: expect.stringContaining('gh workflow run canary.yml') })
  })

  it('says both things when the newest run is old and red', () => {
    const verdict = canaryVerdict([run({ createdAt: hoursAgo(100), conclusion: 'failure' })], NOW)

    expect(verdict).toMatchObject({ problem: expect.stringMatching(/failure.*switched off|switched off.*failure/i) })
  })

  it('does not call a run from a moment in the future too old (a skewed clock)', () => {
    expect('run' in canaryVerdict([run({ createdAt: hoursAgo(-1) })], NOW)).toBe(true)
  })
})

describe('listCanaryRuns', () => {
  const answer = (stdout: string, code = 0): { runner: Runner; calls: string[][] } => {
    const calls: string[][] = []
    const runner: Runner = async (command, args) => {
      calls.push([command, ...args])

      return { code, stdout, stderr: code === 0 ? '' : 'gh: not logged in' }
    }

    return { runner, calls }
  }

  it('asks GitHub for the canary workflow\'s runs, with no commit, and reads them', async () => {
    const { runner, calls } = answer(JSON.stringify([{ databaseId: 77, status: 'completed', conclusion: 'success', createdAt: '2026-10-22T05:20:00Z', headSha: 'f'.repeat(40) }]))

    expect(await listCanaryRuns(runner)).toEqual([{ id: 77, status: 'completed', conclusion: 'success', createdAt: '2026-10-22T05:20:00Z', headSha: 'f'.repeat(40) }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('canary.yml')
    expect(calls[0]).not.toContain('--commit')
    expect(calls[0]).toEqual(expect.arrayContaining(['gh', 'run', 'list', '--workflow']))
  })

  it('says what failed when gh does', async () => {
    const { runner } = answer('', 1)

    await expect(listCanaryRuns(runner)).rejects.toThrow(/gh run list failed.*not logged in/)
  })
})
