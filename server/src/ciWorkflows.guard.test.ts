import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * The rules every GitHub Actions workflow of this public repository keeps (Phase 17, docs/DECISIONS.md; tightened
 * by the security review, SR-049). On a public repo a push or pull-request trigger lets a stranger's change run here,
 * wider permissions let a run write to the repo, an action named by tag can be changed under us by whoever controls
 * that tag, and a script that is handed text it did not write runs it. A change to any of these is a decision, so it
 * has to change this test too.
 *
 * One function, `workflowProblems`, holds every rule. It runs on each real workflow (which must have none) and on
 * hostile ones below (each of which must trip exactly the rule it was written for), so a rule that quietly stopped
 * working would fail here.
 */

const WORKFLOWS = join(import.meta.dirname, '../../.github/workflows')

/** `actions/<name>@<40 hex>`: GitHub's own actions only, each a commit, which no one can move. */
const PINNED_GITHUB_ACTION = /^actions\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/
/** A GitHub-hosted runner. A self-hosted runner on a public repository runs whatever a workflow says, on a machine. */
const HOSTED_RUNNER = /^(windows|macos|ubuntu)-(latest|\d[\w.]*)$/
/** The longest an artifact may live: a test build is unannounced, not a release (DECISIONS 2026-10-05). */
const MAX_RETENTION_DAYS = 7

interface Step {
  uses?: string
  run?: string
  with?: Record<string, unknown>
  'continue-on-error'?: unknown
}

interface Job {
  'runs-on'?: unknown
  permissions?: unknown
  uses?: string
  secrets?: unknown
  environment?: unknown
  'continue-on-error'?: unknown
  steps?: Step[]
}

interface Workflow {
  on: unknown
  permissions?: unknown
  jobs: Record<string, Job>
}

/** Every string anywhere in a parsed document, with the key it sits under. */
function strings(value: unknown, key = ''): [string, string][] {
  if (typeof value === 'string') return [[key, value]]
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([name, inner]) => strings(inner, name))
  }

  return []
}

/** Every rule a workflow breaks, as sentences; empty when it breaks none. */
function workflowProblems(workflow: Workflow): string[] {
  const problems: string[] = []
  const jobs = Object.entries(workflow.jobs)
  const steps = jobs.flatMap(([name, job]) => (job.steps ?? []).map((step) => ({ job: name, step })))

  // Started by hand only: no push or pull-request trigger, so no stranger's change is ever built.
  const triggers = typeof workflow.on === 'string' ? [workflow.on] : Object.keys((workflow.on ?? {}) as object)
  if (JSON.stringify(triggers) !== JSON.stringify(['workflow_dispatch'])) {
    problems.push(`is started by ${triggers.join(', ') || 'nothing'}, not by hand only (workflow_dispatch)`)
  }

  // Reads the repository and nothing more.
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })) problems.push('does not have permissions: { contents: read }')
  for (const [name, job] of jobs) {
    if (job.permissions !== undefined && JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) {
      problems.push(`job ${name} widens its permissions`)
    }
  }

  // GitHub's own actions, each pinned by commit (a job may call a reusable workflow with `uses`, a step an action).
  const uses = [...jobs.flatMap(([, job]) => (job.uses ? [job.uses] : [])), ...steps.flatMap(({ step }) => (step.uses ? [step.uses] : []))]
  if (uses.length === 0) problems.push('uses no action at all (an empty list would pass every rule below on nothing)')
  for (const use of uses) if (!PINNED_GITHUB_ACTION.test(use)) problems.push(`uses ${use}: not a GitHub-owned action pinned by a 40-character commit`)

  // A GitHub-hosted runner only.
  for (const [name, job] of jobs) {
    if (typeof job['runs-on'] !== 'string' || !HOSTED_RUNNER.test(job['runs-on'])) {
      problems.push(`job ${name} runs on ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted runner`)
    }
  }

  // The checkout does not leave a token in `.git/config` for the build's scripts to read.
  for (const { job, step } of steps.filter(({ step }) => step.uses?.startsWith('actions/checkout@'))) {
    if (step.with?.['persist-credentials'] !== false) problems.push(`job ${job}: checkout does not set persist-credentials: false`)
  }

  // An artifact is a test build kept for days, not a release.
  for (const { job, step } of steps.filter(({ step }) => step.uses?.startsWith('actions/upload-artifact@'))) {
    const days = step.with?.['retention-days']
    if (typeof days !== 'number' || days < 1 || days > MAX_RETENTION_DAYS) {
      problems.push(`job ${job}: upload-artifact retention-days is ${JSON.stringify(days)}, not 1 to ${MAX_RETENTION_DAYS}`)
    }
  }

  // A script is handed values through `env:`, never pasted: `${{ … }}` in a `run:` is text written into the script
  // before it runs, so whoever sets that value (an input, a branch name, an actor) writes shell. And it fetches and
  // runs nothing it did not pin: no download piped to a shell, no `npx` of a package named on the fly.
  for (const { job, step } of steps.filter(({ step }) => step.run !== undefined)) {
    const run = step.run!
    if (run.includes('${{')) problems.push(`job ${job}: a run: script contains \${{ … }} (hand values through env:)`)
    if (/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Invoke-Expression|iex)\b/i.test(run)) {
      problems.push(`job ${job}: a run: script downloads or evaluates remote text`)
    }
    if (/\bnpx\b/.test(run)) problems.push(`job ${job}: a run: script uses npx`)
  }

  // No secret, and no token handed on, in any spelling: the key `secrets:` of a reusable-workflow call
  // (`secrets: inherit`), `${{ secrets.X }}`, `secrets['X']`, `toJSON(secrets)`, `github.token`, `GITHUB_TOKEN`.
  for (const [name, job] of jobs) if (job.secrets !== undefined) problems.push(`job ${name} passes secrets`)
  for (const [key, text] of strings(workflow)) {
    if (/\$\{\{[^}]*\bsecrets\b/.test(text) || /\bgithub\.token\b|\bGITHUB_TOKEN\b/.test(text)) {
      problems.push(`${key || 'a value'} reaches for a secret or the token: ${text.slice(0, 60)}`)
    }
  }

  // Nothing is allowed to fail quietly, and no environment (with its own secrets and reviewers) is in play.
  for (const [name, job] of jobs) {
    if (job['continue-on-error'] !== undefined) problems.push(`job ${name} sets continue-on-error`)
    if (job.environment !== undefined) problems.push(`job ${name} uses an environment`)
  }
  for (const { job, step } of steps) if (step['continue-on-error'] !== undefined) problems.push(`job ${job}: a step sets continue-on-error`)

  return problems
}

const sha = (letter: string) => letter.repeat(40)

/** A workflow that breaks no rule; each hostile one below changes one thing in it. */
const GOOD = `
name: Test
on:
  workflow_dispatch:
    inputs:
      profile:
        type: choice
        options: [release, debug]
permissions:
  contents: read
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
      - name: Build
        env:
          PROFILE: \${{ inputs.profile || 'release' }}
        run: npm ci --ignore-scripts
      - uses: actions/upload-artifact@${sha('b')} # v1
        with:
          name: x
          path: y
          retention-days: 3
`

const parse = (text: string) => loadYaml(text) as Workflow

describe('the rules for a workflow, proven on hostile workflows', () => {
  it('accept a workflow that breaks none', () => {
    expect(workflowProblems(parse(GOOD))).toEqual([])
  })

  const hostile: [string, (text: string) => string, RegExp][] = [
    ['a pull request trigger', (t) => t.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'), /not by hand only/],
    ['a push trigger instead', (t) => t.replace('  workflow_dispatch:\n    inputs:\n      profile:\n        type: choice\n        options: [release, debug]', '  push:'), /not by hand only/],
    ['write permission', (t) => t.replace('contents: read', 'contents: write'), /permissions: \{ contents: read \}/],
    ['no permissions at all', (t) => t.replace('permissions:\n  contents: read\n', ''), /permissions: \{ contents: read \}/],
    ['a job that widens its permissions', (t) => t.replace('    runs-on: windows-latest', '    runs-on: windows-latest\n    permissions:\n      contents: write'), /widens its permissions/],
    ['an action named by tag', (t) => t.replace(`actions/checkout@${sha('a')} # v1`, 'actions/checkout@v4'), /not a GitHub-owned action pinned/],
    ['an action from another owner, pinned', (t) => t.replace(`actions/upload-artifact@${sha('b')}`, `someone/else@${sha('b')}`), /not a GitHub-owned action pinned/],
    ['a local action', (t) => t.replace(`actions/upload-artifact@${sha('b')}`, './.github/actions/mine'), /not a GitHub-owned action pinned/],
    ['a docker action', (t) => t.replace(`actions/upload-artifact@${sha('b')}`, 'docker://alpine:3'), /not a GitHub-owned action pinned/],
    ['a self-hosted runner', (t) => t.replace('windows-latest', 'self-hosted'), /not a GitHub-hosted runner/],
    ['a runner list with self-hosted', (t) => t.replace('windows-latest', '[self-hosted, linux]'), /not a GitHub-hosted runner/],
    ['a runner chosen by an expression', (t) => t.replace('windows-latest', '${{ inputs.runner }}'), /not a GitHub-hosted runner/],
    ['a checkout that keeps credentials', (t) => t.replace('          persist-credentials: false', '          fetch-depth: 0'), /persist-credentials: false/],
    ['a checkout that sets it true', (t) => t.replace('persist-credentials: false', 'persist-credentials: true'), /persist-credentials: false/],
    ['an artifact kept a month', (t) => t.replace('retention-days: 3', 'retention-days: 30'), /retention-days/],
    ['an artifact with no retention set', (t) => t.replace('          retention-days: 3\n', ''), /retention-days/],
    ['an input pasted into a script', (t) => t.replace('run: npm ci --ignore-scripts', "run: echo ${{ inputs.profile }}"), /contains \$\{\{/],
    ['a branch name pasted into a script', (t) => t.replace('run: npm ci --ignore-scripts', "run: echo ${{ github.head_ref }}"), /contains \$\{\{/],
    ['an output pasted into a script', (t) => t.replace('run: npm ci --ignore-scripts', "run: echo ${{ steps.x.outputs.y }}"), /contains \$\{\{/],
    ['a download piped to a shell', (t) => t.replace('run: npm ci --ignore-scripts', 'run: curl -fsSL https://example.com/i.sh | sh'), /downloads or evaluates/],
    ['a PowerShell download evaluated', (t) => t.replace('run: npm ci --ignore-scripts', "run: iwr https://example.com/i.ps1 | iex"), /downloads or evaluates/],
    ['npx of a package named on the fly', (t) => t.replace('run: npm ci --ignore-scripts', 'run: npx some-package'), /uses npx/],
    ['a secret in the usual spelling', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'TOKEN: ${{ secrets.TOKEN }}'), /secret or the token/],
    ['a secret by index', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", "TOKEN: ${{ secrets['TOKEN'] }}"), /secret or the token/],
    ['all secrets as JSON', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'ALL: ${{ toJSON(secrets) }}'), /secret or the token/],
    ['the workflow token handed to a step', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'T: ${{ github.token }}'), /secret or the token/],
    ['the token under its usual name', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'GITHUB_TOKEN: ${{ github.token }}'), /secret or the token/],
    ['GITHUB_TOKEN read in a script', (t) => t.replace('run: npm ci --ignore-scripts', 'run: echo $env:GITHUB_TOKEN'), /secret or the token/],
    ['secrets: inherit on a job', (t) => t.replace('    runs-on: windows-latest', '    runs-on: windows-latest\n    secrets: inherit'), /passes secrets/],
    ['a job that may fail quietly', (t) => t.replace('    runs-on: windows-latest', '    runs-on: windows-latest\n    continue-on-error: true'), /continue-on-error/],
    ['a step that may fail quietly', (t) => t.replace('        run: npm ci --ignore-scripts', '        continue-on-error: true\n        run: npm ci --ignore-scripts'), /continue-on-error/],
    ['an environment', (t) => t.replace('    runs-on: windows-latest', '    runs-on: windows-latest\n    environment: release'), /uses an environment/],
  ]

  it.each(hostile)('refuse %s', (_name, change, expected) => {
    const changed = change(GOOD)

    expect(changed).not.toBe(GOOD)
    expect(workflowProblems(parse(changed)).join(' | ')).toMatch(expected)
  })
})

describe('GitHub Actions workflows', () => {
  const workflows = readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, workflow: loadYaml(readFileSync(join(WORKFLOWS, name), 'utf8')) as Workflow }))

  it('exist (an empty folder would make every rule below pass on nothing)', () => {
    expect(workflows.map((entry) => entry.name)).toContain('desktop-windows.yml')
  })

  it.each(workflows)('$name breaks none of the rules', ({ workflow }) => {
    expect(workflowProblems(workflow)).toEqual([])
  })
})
