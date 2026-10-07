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

  // The toolchain is the one the repository names, never "whatever is current today" (SR-041): Node comes from `.node-version`,
  // Rust from `rust-toolchain.toml`, and a build resolves its dependencies from the committed lockfiles or fails (`--locked`).
  for (const { job, step } of steps.filter(({ step }) => step.uses?.startsWith('actions/setup-node@'))) {
    if (step.with?.['node-version'] !== undefined) problems.push(`job ${job}: setup-node names a node-version (read .node-version instead)`)
    if (step.with?.['node-version-file'] !== '.node-version') problems.push(`job ${job}: setup-node does not read .node-version`)
  }
  for (const { job, step } of steps.filter(({ step }) => step.run !== undefined)) {
    const run = step.run!
    if (/\brustup\s+(toolchain\s+install|default|update|override)\b/.test(run)) {
      if (/\b(stable|beta|nightly)\b/.test(run)) problems.push(`job ${job}: rustup is given a moving channel (stable, beta or nightly)`)
      if (!run.includes('rust-toolchain.toml')) problems.push(`job ${job}: rustup does not take its version from rust-toolchain.toml`)
    }
    for (const line of run.split('\n')) {
      if (/\b(tauri:build|tauri build|cargo\s+(build|test|run|check|clippy|install|bench))\b/.test(line) && !/--locked\b/.test(line)) {
        problems.push(`job ${job}: \`${line.trim().slice(0, 70)}\` is not run with --locked`)
      }
    }
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
      - uses: actions/setup-node@${sha('c')} # v1
        with:
          node-version-file: .node-version
      - name: Rust
        shell: pwsh
        run: |
          $channel = (Select-String -Path rust-toolchain.toml -Pattern '^channel').Line
          rustup toolchain install $channel --profile minimal --no-self-update
      - name: Installer
        shell: pwsh
        run: |
          if ($true) {
            npm run tauri:build -w @listulator/desktop -- --bundles nsis --debug -- --locked
          } else {
            npm run tauri:build -w @listulator/desktop -- --bundles nsis -- --locked
          }
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
    ['a node version named in the workflow', (t) => t.replace('node-version-file: .node-version', 'node-version: 26'), /names a node-version/],
    ['a node version range', (t) => t.replace('node-version-file: .node-version', 'node-version: ">=20"\n          node-version-file: .node-version'), /names a node-version/],
    ['a node version file that is not .node-version', (t) => t.replace('node-version-file: .node-version', 'node-version-file: package.json'), /does not read .node-version/],
    ['rustup given stable', (t) => t.replace('rustup toolchain install $channel --profile minimal --no-self-update', 'rustup toolchain install stable --profile minimal rust-toolchain.toml'), /moving channel/],
    ['rustup default stable', (t) => t.replace('rustup toolchain install $channel --profile minimal --no-self-update', 'rustup default stable # rust-toolchain.toml'), /moving channel/],
    ['rustup given a nightly', (t) => t.replace('rustup toolchain install $channel --profile minimal --no-self-update', 'rustup toolchain install nightly # rust-toolchain.toml'), /moving channel/],
    ['rustup with a version written in the workflow, not read from the file', (t) => t.replace("$channel = (Select-String -Path rust-toolchain.toml -Pattern '^channel').Line\n          rustup toolchain install $channel", 'rustup toolchain install 1.98.1'), /does not take its version from rust-toolchain.toml/],
    ['a tauri build without --locked (the release branch)', (t) => t.replace('--bundles nsis -- --locked', '--bundles nsis'), /not run with --locked/],
    ['a tauri build without --locked (the debug branch)', (t) => t.replace('--debug -- --locked', '--debug'), /not run with --locked/],
    ['a cargo build without --locked', (t) => t.replace('run: npm ci --ignore-scripts', 'run: cargo build --release'), /not run with --locked/],
    ['a cargo test without --locked', (t) => t.replace('run: npm ci --ignore-scripts', 'run: cargo test'), /not run with --locked/],
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

/**
 * The versions the repository builds with are written down once each and are exact (security review, Phase 19, SR-041): the compiler in
 * `rust-toolchain.toml`, Node in `.node-version`. The workflow reads both (the rules above), Cargo's own `rust-version` agrees with the
 * compiler, so a bump is one deliberate commit that changes these files together and says why in docs/DECISIONS.md.
 */
describe('the pinned toolchain', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const EXACT = /^\d+\.\d+\.\d+$/
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  const toolchain = read('rust-toolchain.toml')
  const channel = /^channel\s*=\s*"([^"]+)"/m.exec(toolchain)?.[1]

  it('names Node exactly, once, in .node-version', () => {
    expect(read('.node-version').trim()).toMatch(EXACT)
  })

  it('names the Rust compiler exactly, once, in rust-toolchain.toml, with the minimal profile', () => {
    expect(channel).toMatch(EXACT)
    expect(toolchain).toMatch(/^profile\s*=\s*"minimal"/m)
    // The settings, not the comments (which explain why "stable" is not used).
    expect(toolchain.replace(/^\s*#.*$/gm, '')).not.toMatch(/\b(stable|beta|nightly)\b/)
  })

  it('has Cargo.toml say the same compiler as its minimum (a lower number was never tried)', () => {
    expect(/^rust-version\s*=\s*"([^"]+)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'))?.[1]).toBe(channel)
  })

  it('is what the root package says it runs on: Node at the version file or above within the same major', () => {
    const engines = (JSON.parse(read('package.json')) as { engines?: { node?: string } }).engines?.node ?? ''
    const major = Number(read('.node-version').trim().split('.')[0])

    expect(engines).toMatch(/^>=\d+/)
    expect(Number(engines.replace(/^>=/, ''))).toBeLessThanOrEqual(major)
  })
})

