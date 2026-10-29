/**
 * The rules every GitHub Actions workflow of this public repository keeps (Phase 17, docs/DECISIONS.md; tightened by the security review,
 * SR-049). On a public repo a push or pull-request trigger lets a stranger's change run here, wider permissions let a run write to the
 * repo, an action named by tag can be changed under us by whoever controls that tag, and a script that is handed text it did not write
 * runs it. A change to any of these is a decision, so it has to change the guard tests too.
 *
 * One function, `workflowProblems`, holds every rule. `ciWorkflows.guard.test.ts` runs it on each real workflow (which must have none) and
 * on hostile ones (each of which must trip exactly the rule it was written for), so a rule that quietly stopped working would fail
 * there; `ciWorkflows.canary.guard.test.ts` does the same for the canary profile.
 */

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
export const UPDATER_OVERLAY = 'src-tauri/tauri.updater-artifacts.conf.json'
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
/** The Release run's Windows job tries the installer it built, as the last thing before it is uploaded (BL-120). */
const INSTALL_CHECK = 'npm run release:install-check'
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
export type Profile = 'manual' | 'release' | 'ci' | 'canary' | 'updaterTest'
/** The longest an artifact may live: a test build is unannounced, not a release (DECISIONS 2026-10-05). */
const MAX_RETENTION_DAYS = 7

export interface Step {
  uses?: string
  if?: unknown
  name?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
  'continue-on-error'?: unknown
}

export interface Job {
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

export interface Workflow {
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
export function workflowProblems(workflow: Workflow, profile: Profile = 'manual'): string[] {
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
  // The checked repeats reach the test as data, in one file of the folder it reads, written by one step that carries nothing else, after the upload
  // (the file is not uploaded) and before the key goes: the update test's own step keeps its two lines and no environment.
  const writingRepeats = indexed.filter(({ run }) => /repeats\.txt/.test(run))
  if (writingRepeats.length !== 1) problems.push(`writes the repeats file in ${writingRepeats.length} steps, not one`)
  for (const { step, run, index } of writingRepeats) {
    const exactly =
      JSON.stringify(Object.keys(step).sort()) === JSON.stringify(['env', 'name', 'run', 'shell']) &&
      JSON.stringify(step.env) === JSON.stringify({ REPEATS: '${{ inputs.repeats }}' }) &&
      JSON.stringify(codeOf(run)) === JSON.stringify(['Set-Content -Path updater-test-out/repeats.txt -Value $env:REPEATS -NoNewline'])
    if (!exactly) problems.push('the repeats step is not exactly one Set-Content of the checked repeats into updater-test-out/repeats.txt, with only REPEATS in its env')
    if (upload === undefined || index < upload.index || deleting.some((step) => step.index < index)) problems.push("writes the repeats file outside the window between the upload and the key's deletion")
  }
  // The older app's debugging symbols (BL-116) are kept by two lines of the FIRST build step, before the update's build overwrites them, and
  // go nowhere: no other line names the folder, and the upload lists none of it (its exact names are checked below).
  const SYMBOL_LINES = ['New-Item -ItemType Directory -Force -Path updater-test-symbols | Out-Null', 'Copy-Item apps/desktop/src-tauri/target/release/*.pdb updater-test-symbols']
  const firstBuildStep = indexed.find(({ run }) => codeOf(run).some((line) => /^npm run tauri:build\b/.test(line)))
  const symbolLines = lines.filter(({ line }) => /updater-test-symbols/.test(line))
  if (JSON.stringify(symbolLines.map(({ line }) => line)) !== JSON.stringify(SYMBOL_LINES) || symbolLines.some(({ index }) => index !== firstBuildStep?.index)) {
    problems.push('the symbols folder is touched other than by its two lines in the first build step')
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
  // The number of updates to try (BL-116) is checked in that same first step, as a whole number from 1 to 20, before anything uses it.
  if (first?.env?.['REPEATS'] !== '${{ inputs.repeats }}' || !/\$env:REPEATS\s+-notmatch\s+'\^\(\[1-9\]\|1\[0-9\]\|20\)\$'/.test(firstRun) || !/\bthrow\b/.test(firstRun)) {
    problems.push('does not check the repeats first (a whole number from 1 to 20, before the checkout and before the key)')
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
  // BL-120: the installer is installed and started before it is uploaded, so a release whose installer does not install, or whose app does not
  // start, stops the run before any draft exists. The step is the last one before the upload, so nothing can change the file after it was tried
  // (the bytes tried are the bytes uploaded, attested and signed). It says a name and the command and nothing else: no `if`, no folder, no env.
  if (windows !== undefined) {
    const own = windows.steps ?? []
    const windowsName = jobs.find(([, job]) => job === windows)![0]
    const at = own.findIndex((step) => step.run?.trim() === INSTALL_CHECK)
    const upload = own.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'))
    const building = own.findIndex((step) => /\btauri:build\b/.test(step.run ?? ''))
    if (at === -1) problems.push(`job ${windowsName} never installs the installer it built (a step that runs exactly ${INSTALL_CHECK})`)
    else {
      if (upload === -1 || at !== upload - 1) problems.push(`job ${windowsName}: the install check is not the step right before the upload (nothing may change the installer after it was tried)`)
      if (building === -1 || at < building) problems.push(`job ${windowsName}: the install check runs before the installer is built`)
      const keys = Object.keys(own[at]!).filter((key) => key !== 'name' && key !== 'run')
      if (keys.length > 0) problems.push(`job ${windowsName}: the install check step says more than a name and a run (${keys.join(', ')}): no condition, folder or environment may change what it does`)
    }
  }
  for (const { job, run } of runs) {
    if (run.includes('release:install-check') && job !== jobs.find(([, candidate]) => candidate === windows)?.[0]) problems.push(`job ${job}: runs the install check outside the Windows build job (it installs a program)`)
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
