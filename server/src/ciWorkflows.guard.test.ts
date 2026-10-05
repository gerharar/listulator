import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * The rules every GitHub Actions workflow of this public repository keeps (Phase 17, docs/DECISIONS.md). On a public
 * repo a push or pull-request trigger lets a stranger's change run here, wider permissions let a run write to the
 * repo, and an action named by tag can be changed under us by whoever controls that tag. A change to any of these
 * is a decision, so it has to change this test too.
 */

const WORKFLOWS = join(import.meta.dirname, '../../.github/workflows')

/** `owner/repo@<40 hex>` (or `owner/repo/path@<40 hex>`): a commit, which no one can move. */
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/

interface Workflow {
  on: unknown
  permissions?: unknown
  jobs: Record<string, { permissions?: unknown; uses?: string; steps?: { uses?: string; run?: string }[] }>
}

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8')
    return { name, text, workflow: loadYaml(text) as Workflow }
  })

describe('GitHub Actions workflows', () => {
  it('exist (an empty folder would make every rule below pass on nothing)', () => {
    expect(workflows.map((entry) => entry.name)).toContain('desktop-windows.yml')
  })

  it.each(workflows)('$name is started by hand only', ({ workflow }) => {
    const triggers = typeof workflow.on === 'string' ? [workflow.on] : Object.keys(workflow.on as object)

    expect(triggers).toEqual(['workflow_dispatch'])
  })

  it.each(workflows)('$name reads the repository and nothing more', ({ workflow }) => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    for (const job of Object.values(workflow.jobs)) {
      if (job.permissions !== undefined) expect(job.permissions).toEqual({ contents: 'read' })
    }
  })

  it.each(workflows)('$name pins every action by commit', ({ workflow }) => {
    const uses = Object.values(workflow.jobs).flatMap((job) => [
      ...(job.uses ? [job.uses] : []),
      ...(job.steps ?? []).flatMap((step) => (step.uses ? [step.uses] : [])),
    ])

    expect(uses.length).toBeGreaterThan(0)
    expect(uses.filter((use) => !PINNED.test(use))).toEqual([])
  })

  it.each(workflows)('$name hands inputs to scripts only through the environment', ({ workflow }) => {
    // `${{ inputs.x }}` written into a `run:` is pasted into the script before it runs: whoever sets the input
    // writes shell. Through `env:` it stays a value.
    const runs = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => (step.run ? [step.run] : [])))

    expect(runs.filter((run) => /\$\{\{\s*(inputs|github\.event)\./.test(run))).toEqual([])
  })

  it.each(workflows)('$name uses no secret', ({ text }) => {
    expect(text).not.toMatch(/\$\{\{\s*secrets\./)
  })
})
