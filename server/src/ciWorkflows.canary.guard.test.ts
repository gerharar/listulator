import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { type Workflow, workflowProblems } from './ciWorkflowRules.js'

/**
 * The canary profile of `workflowProblems` (Phase 31, task 31.9), proven on hostile workflows, and what the real `canary.yml` and the
 * commands it runs must keep. The other profiles are in `ciWorkflows.guard.test.ts`.
 */

const WORKFLOWS = join(import.meta.dirname, '../../.github/workflows')

const sha = (letter: string) => letter.repeat(40)

const parse = (text: string) => loadYaml(text) as Workflow

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
