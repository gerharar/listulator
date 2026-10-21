import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { checkAttestations, type AttestationHost } from './attestationCheck.js'
import {
  WATCHED_PATHS,
  changedAmong,
  codesignFindings,
  codesignProblems,
  compareTrees,
  diffSummary,
  forbiddenPaths,
  formatDiffSummary,
  hasEntitlements,
  machoArchs,
  parseEnvValues,
  plistProblems,
  readTree,
  valueHits,
  type EnvEntry,
  type Tree,
} from './releaseAuditRules.js'
import { CONFIG_PATH, createGhHost, nodeRunner, parseSums, type ReleaseHost, type Runner } from './releaseSign.js'
import { isRunDirectly } from './runDirectly.js'
import { runChecked } from './runChecked.js'
import { assetName, compareVersions } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * `npm run release:audit -- <tag>` (Phase 31, task 31.10): the scripted audit of a release's files, step 4 of the release routine.
 * It works on a draft (before `release:sign`) and on a published release alike, because it downloads with `gh`, which is signed in.
 * It runs on macOS (it mounts the disk image and runs `codesign`) and changes nothing: the files are downloaded into a temporary
 * folder that is removed at the end. A finding is a failure line, and no line ever holds a secret: the owner's `.env` values are
 * searched for by script and only the NAME of one that was found is printed.
 *
 *  1. The release holds the files the pipeline makes, and nothing nobody expected; the three files match `SHA256SUMS`.
 *  2. Each has a build attestation from this repository's release workflow on this tag and commit, and the check refuses the
 *     previous release's commit (`attestationCheck.ts`).
 *  3. The Windows installer is unpacked with `7zz`: no forbidden file (`.env`, a database, a source map, a key, curated lists), none
 *     of the `.env` values in any file, no `sourceMappingURL`.
 *  4. The macOS update archive is extracted and the disk image mounted read-only: the app in both is byte for byte the same; the
 *     seal verifies on both (`codesign --verify --deep --strict`); in the disk image's app the plist, the signature, the entitlements
 *     and the processor (arm64 only) are what the TAGGED `tauri.conf.json` says; the same scans as for Windows.
 *  5. What changed since the previous release (from the tags in this clone): how much, by area, and whether anything that runs with
 *     the updater key or decides what the app may do changed (a note: to be read before `release:sign`).
 *
 * Each stage is guarded: an error in one becomes one failure line and the others still run. The disk image is always unmounted; if
 * that fails, the folders are left where they are rather than deleted through a live mount.
 */

/** What the audit needs from GitHub, git and the programs of a Mac, as intentions; `createAuditHost` is the real one, the tests use a fake. */
export interface AuditHost extends AttestationHost {
  /** The release's files by name, as `gh` sees them (a draft too). */
  viewRelease: ReleaseHost['viewRelease']
  download: ReleaseHost['download']
  /** The version tags in THIS clone; `tagCommit` reads the commit from this clone too (the tag must have been fetched). */
  localTags(): Promise<string[]>
  /** `tauri.conf.json` as it is in the tag, parsed. */
  tagConfig(tag: string): Promise<unknown>
  /** `git diff --numstat` and `--name-only` between two tags. */
  diffNumstat(from: string, to: string): Promise<string>
  diffNames(from: string, to: string): Promise<string[]>
  unpackInstaller(file: string, dir: string): Promise<void>
  extractArchive(file: string, dir: string): Promise<void>
  mountDisk(file: string, mountPoint: string): Promise<void>
  unmountDisk(mountPoint: string): Promise<void>
  /** The app's `Info.plist` as parsed JSON. */
  plist(appDir: string): Promise<unknown>
  codesignVerify(appDir: string): Promise<{ ok: boolean; output: string }>
  /** What `codesign -dv --verbose=4` prints. */
  codesignDetails(appDir: string): Promise<string>
  entitlements(appDir: string): Promise<string>
}

export interface ReleaseAuditOptions {
  tag: string
  /** The text of the owner's `.env`; without it the values are not looked for (and the audit says so). */
  envText?: string | undefined
}

export interface ReleaseAuditResult {
  tag: string
  /** One sentence per thing that is wrong; empty when the release is as it should be. */
  failures: string[]
}

const isStableTag = (value: string): boolean => value.startsWith('v') && !value.includes('-') && RELEASE_VERSION.test(value.slice(1))
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const MAX_DIFFERENCES = 10
const MAX_AREAS = 8

interface TauriExpectations {
  identifier: string
  minimumSystemVersion: string
  adhoc: boolean
}

/** What the tagged config says about the Mac app, or why it says nothing. */
function expectationsOf(config: unknown): TauriExpectations | string {
  const root = config as { identifier?: unknown; bundle?: { macOS?: { signingIdentity?: unknown; minimumSystemVersion?: unknown } } } | null
  const identifier = root?.identifier
  const minimum = root?.bundle?.macOS?.minimumSystemVersion
  if (typeof identifier !== 'string' || typeof minimum !== 'string') return `${CONFIG_PATH} has no identifier or no bundle.macOS.minimumSystemVersion`

  return { identifier, minimumSystemVersion: minimum, adhoc: root?.bundle?.macOS?.signingIdentity === '-' }
}

/** The one `.app` folder directly inside `dir`. */
function appIn(dir: string): string {
  const apps = readdirSync(dir).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1) throw new Error(`expected exactly one .app, found ${apps.length === 0 ? 'none' : apps.join(', ')}`)

  return join(dir, apps[0]!)
}

interface Say {
  log: (line: string) => void
  fail: (line: string) => void
}

/** The app in the disk image against what the tagged config says: the plist, the processor, the signature and the entitlements. */
async function checkMacApp(host: AuditHost, app: string, expected: TauriExpectations & { version: string }, say: Say): Promise<void> {
  const info = await host.plist(app)
  const problems = plistProblems(info, { identifier: expected.identifier, version: expected.version, minimumSystemVersion: expected.minimumSystemVersion })
  for (const problem of problems) say.fail(`Info.plist: ${problem}`)
  if (problems.length === 0) say.log(`Info.plist: ${expected.identifier}, ${expected.version}, minimum macOS ${expected.minimumSystemVersion}, no usage descriptions`)

  // The program's name comes from a file inside the download: only a plain file name is joined onto the app's folder.
  const program = (info as { CFBundleExecutable?: unknown } | null)?.CFBundleExecutable
  if (typeof program !== 'string' || program === '' || program === '.' || program === '..' || /[\\/]/.test(program)) say.fail('Info.plist: CFBundleExecutable is missing or is not a plain file name')
  else {
    const archs = machoArchs(readFileSync(join(app, 'Contents', 'MacOS', program)))
    if (archs !== undefined && archs.length === 1 && archs[0] === 'arm64') say.log(`${program} is for arm64 only`)
    else say.fail(`${program} is for ${archs === undefined ? 'an unknown processor' : archs.join(', ')}, not arm64 only`)
  }

  const findings = codesignFindings(await host.codesignDetails(app))
  const signature = codesignProblems(findings, { identifier: expected.identifier, expectAdhoc: expected.adhoc })
  for (const problem of signature) say.fail(problem)
  if (signature.length === 0) say.log(`Signature: ${findings.adhoc ? 'ad hoc' : `team ${findings.team ?? 'none'}`}, flags ${findings.flags ?? 'none'}, as the tagged config says`)
  if (hasEntitlements(await host.entitlements(app))) say.fail('The app has entitlements nobody decided on')
  else say.log('The app has no entitlements')
}

export async function releaseAudit(options: ReleaseAuditOptions, host: AuditHost, log: (line: string) => void, note: (line: string) => void): Promise<ReleaseAuditResult> {
  const { tag } = options
  if (!isStableTag(tag)) throw new Error(`${JSON.stringify(tag).slice(0, 40)} is not v + a version (like v1.0.0)`)
  const version = tag.slice(1)
  const commit = await host.tagCommit(tag)
  const previous = (await host.localTags()).filter((candidate) => isStableTag(candidate) && compareVersions(candidate.slice(1), version) < 0).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]

  const exe = assetName('windows-x86_64', version)
  const archive = assetName('darwin-aarch64', version)
  const dmg = `Listulator_${version}_aarch64.dmg`
  const files = [exe, dmg, archive]
  const required = [...files, 'SHA256SUMS']
  const earlierRun = [`${exe}.sig`, `${archive}.sig`, 'latest.json']

  const failures: string[] = []
  const fail = (line: string) => failures.push(line.replace(/\s+/g, ' ').trim().slice(0, 400))
  const guarded = async (what: string, step: () => Promise<void>) => {
    try {
      await step()
    } catch (error) {
      fail(`${what}: ${reason(error)}`)
    }
  }

  // The owner's .env values: searched for in every unpacked file; only a NAME is ever reported.
  const envEntries: EnvEntry[] = options.envText === undefined ? [] : parseEnvValues(options.envText)
  let scanned = 0
  let withValues = 0
  const scan = (label: string, root: string, tree: Tree) => {
    for (const path of forbiddenPaths([...tree.keys()])) fail(`${label}: ${path} must not be in a release`)
    for (const [path, entry] of tree) {
      if (entry.kind !== 'file') continue
      const data = readFileSync(join(root, path))
      scanned++
      const hits = valueHits(envEntries, data)
      if (hits.length > 0) {
        withValues++
        fail(`${label}: ${path} holds the value of ${hits.join(', ')} from .env`)
      }
      if (data.includes('sourceMappingURL=')) fail(`${label}: ${path} holds a sourceMappingURL`)
    }
  }

  const config = await host.tagConfig(tag).then(expectationsOf, (error: unknown) => `${CONFIG_PATH} at ${tag} could not be read: ${reason(error)}`)
  if (typeof config === 'string') fail(`The tagged config: ${config}`)

  const work = mkdtempSync(join(tmpdir(), 'release-audit-'))
  // The disk image is mounted at a folder of its own, so removing the work folder can never reach into a mounted volume.
  const mountPoint = mkdtempSync(join(tmpdir(), 'release-audit-mnt-'))
  let mounted = false
  try {
    // 1. The release's files and their checksums.
    let downloaded = false
    await guarded('The release', async () => {
      const release = await host.viewRelease(tag)
      const missing = required.filter((name) => !release.assets.includes(name))
      if (missing.length > 0) fail(`The release lacks ${missing.join(', ')}`)
      const unexpected = release.assets.filter((name) => !required.includes(name) && !earlierRun.includes(name))
      if (unexpected.length > 0) fail(`The release has files nobody expected, which were not checked: ${unexpected.join(', ')}`)
      log(`The release is ${release.isDraft ? 'a draft' : 'published'} and holds ${release.assets.join(', ')}`)
      if (missing.length > 0) return
      await host.download(tag, required, work)
      downloaded = true
    })

    if (downloaded) {
      await guarded('SHA256SUMS', async () => {
        const sums = parseSums(readFileSync(join(work, 'SHA256SUMS'), 'utf8'))
        if (sums === undefined || sums.size !== files.length || files.some((name) => !sums.has(name))) {
          fail(`SHA256SUMS does not list exactly ${files.join(', ')}`)

          return
        }
        for (const name of files) {
          const actual = createHash('sha256').update(readFileSync(join(work, name))).digest('hex')
          if (actual === sums.get(name)) log(`${name}  sha256 ${actual} matches SHA256SUMS`)
          else fail(`${name} does not match its checksum in SHA256SUMS`)
        }
      })

      // 2. The attestations and their control.
      await guarded('The attestations', () => checkAttestations(host, { dir: work, names: files, tag, commit, previous }, log, fail))

      // 3. The Windows installer.
      await guarded('Windows installer', async () => {
        const dir = join(work, 'windows')
        mkdirSync(dir)
        await host.unpackInstaller(join(work, exe), dir)
        const tree = readTree(dir)
        const unpacked = [...tree].filter(([, entry]) => entry.kind === 'file').map(([path]) => path)
        log(`Windows installer unpacked: ${unpacked.length} files (${unpacked.join(', ')})`)
        scan('Windows installer', dir, tree)
      })

      // 4. The Mac archive and disk image.
      const tarLabel = `the app in ${archive}`
      const dmgLabel = 'the app in the disk image'
      let tarApp: string | undefined
      let dmgApp: string | undefined
      await guarded(archive, async () => {
        const dir = join(work, 'archive')
        mkdirSync(dir)
        await host.extractArchive(join(work, archive), dir)
        tarApp = appIn(dir)
      })
      await guarded('the disk image', async () => {
        await host.mountDisk(join(work, dmg), mountPoint)
        mounted = true
        dmgApp = appIn(mountPoint)
        log(`The disk image holds: ${readdirSync(mountPoint).join(', ')}`)
      })

      try {
        if (tarApp !== undefined && dmgApp !== undefined) {
          const [dmgPath, tarPath] = [dmgApp, tarApp]
          await guarded('the disk image and the archive', async () => {
            const [inDmg, inTar] = [readTree(dmgPath), readTree(tarPath)]
            const differences = compareTrees(inDmg, inTar, 'the disk image', archive)
            for (const line of differences.slice(0, MAX_DIFFERENCES)) fail(`Disk image against archive: ${line}`)
            if (differences.length > MAX_DIFFERENCES) fail(`Disk image against archive: and ${differences.length - MAX_DIFFERENCES} more differences`)
            if (differences.length === 0) log(`${dmgLabel} and in ${archive} are the same: ${inDmg.size} entries, byte for byte`)
          })
        }
        for (const [label, app] of [[dmgLabel, dmgApp], [tarLabel, tarApp]] as const) {
          if (app === undefined) continue
          await guarded(label, async () => {
            const verdict = await host.codesignVerify(app)
            if (verdict.ok) log(`codesign --verify --deep --strict passes for ${label}`)
            else fail(`${label}: codesign --verify --deep --strict failed: ${verdict.output}`)
            scan(label, app, readTree(app))
          })
        }
        if (dmgApp !== undefined && typeof config !== 'string') {
          const app = dmgApp
          await guarded(dmgLabel, () => checkMacApp(host, app, { ...config, version }, { log, fail }))
        }
      } finally {
        if (mounted) {
          try {
            await host.unmountDisk(mountPoint)
            mounted = false
          } catch (error) {
            fail(`Could not unmount the disk image (${reason(error)}); its folders were left in place`)
          }
        }
      }
    }

    if (options.envText === undefined) note('No .env here: the .env values were not looked for')
    else if (envEntries.length === 0) note('.env has no value of 8 or more characters to look for')
    else if (scanned === 0) note('The .env values were not looked for: no file was unpacked')
    else log(`.env: ${envEntries.length} value${envEntries.length === 1 ? '' : 's'} of 8+ characters, found in ${withValues} of ${scanned} files`)

    // 5. What changed since the previous release.
    await guarded('The change since the previous release', async () => {
      if (previous === undefined) {
        note('No earlier release: nothing to compare with')

        return
      }
      for (const line of formatDiffSummary(diffSummary(await host.diffNumstat(previous, tag)), MAX_AREAS)) note(line.startsWith(' ') ? line : `Changes ${previous}..${tag}: ${line}`)
      const changed = changedAmong(await host.diffNames(previous, tag), WATCHED_PATHS)
      const unchanged = WATCHED_PATHS.filter((path) => changed[path] === undefined)
      if (Object.keys(changed).length > 0) {
        note('Read before release:sign (they run with the updater key or decide what the app may do):')
        for (const [path, names] of Object.entries(changed)) note(names.length === 1 && names[0] === path ? `  ${path}` : `  ${path}: ${names.join(', ')}`)
      }
      if (unchanged.length > 0) note(`Unchanged since ${previous}: ${unchanged.join(', ')}`)
    })
  } finally {
    // Never delete through a live mount: if the disk image is still attached, leave both folders and say where they are.
    if (mounted) fail(`The disk image is still mounted at ${mountPoint}; detach it, then remove ${work}`)
    else {
      try {
        rmdirSync(mountPoint)
      } catch {
        // Not empty or already gone: nothing is mounted here any more, so there is nothing to protect, and a cleanup must not hide the findings.
      }
      rmSync(work, { recursive: true, force: true })
    }
  }

  return { tag, failures }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real programs

/** The real calls. `7zz`, `hdiutil`, `codesign` and `plutil` run without a shell, so no name in a path is read by one. */
export function createAuditHost(run: Runner, repoRoot: string): AuditHost {
  const git = (args: string[]) => run('git', args, { cwd: repoRoot })
  const gh = createGhHost(run, repoRoot)
  const must = (what: string, command: string, args: string[]) => runChecked(run, what, command, args)

  return {
    viewRelease: gh.viewRelease,
    download: gh.download,
    verifyAttestation: gh.verifyAttestation,

    async tagCommit(tag) {
      const result = await git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])
      const commit = result.stdout.trim()
      if (result.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`The tag ${tag} is not in this clone: run git fetch --tags`)

      return commit
    },

    async localTags() {
      const result = await git(['tag', '--list', 'v*'])
      if (result.code !== 0) throw new Error('git could not list the tags')

      return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('v') && RELEASE_VERSION.test(line.slice(1)))
    },

    async tagConfig(tag) {
      const result = await git(['show', `${tag}:${CONFIG_PATH}`])
      if (result.code !== 0) throw new Error(`git could not show ${CONFIG_PATH} at ${tag}`)

      return JSON.parse(result.stdout) as unknown
    },

    async diffNumstat(from, to) {
      const result = await git(['diff', '--numstat', from, to, '--'])
      if (result.code !== 0) throw new Error(`git could not diff ${from} and ${to}`)

      return result.stdout
    },

    async diffNames(from, to) {
      const result = await git(['diff', '--name-only', from, to, '--'])
      if (result.code !== 0) throw new Error(`git could not diff ${from} and ${to}`)

      return result.stdout.split('\n').filter((line) => line !== '')
    },

    async unpackInstaller(file, dir) {
      await must('7zz', '7zz', ['x', '-y', '-bd', `-o${dir}`, file])
    },

    async extractArchive(file, dir) {
      await must('tar', 'tar', ['-xzf', file, '-C', dir])
    },

    async mountDisk(file, mountPoint) {
      await must('hdiutil attach', 'hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountPoint, file])
    },

    async unmountDisk(mountPoint) {
      const first = await run('hdiutil', ['detach', mountPoint])
      if (first.code === 0) return
      await must('hdiutil detach -force', 'hdiutil', ['detach', '-force', mountPoint])
    },

    async plist(appDir) {
      const result = await must('plutil', 'plutil', ['-convert', 'json', '-o', '-', join(appDir, 'Contents', 'Info.plist')])

      return JSON.parse(result.stdout) as unknown
    },

    async codesignVerify(appDir) {
      const result = await run('codesign', ['--verify', '--deep', '--strict', appDir])

      return { ok: result.code === 0, output: result.stderr.trim() }
    },

    async codesignDetails(appDir) {
      // codesign prints what it found on stderr.
      const result = await must('codesign -dv', 'codesign', ['-dv', '--verbose=4', appDir])

      return `${result.stdout}${result.stderr}`.trim()
    },

    async entitlements(appDir) {
      const result = await must('codesign --entitlements', 'codesign', ['-d', '--entitlements', ':-', appDir])

      return result.stdout
    },
  }
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseReleaseAuditArguments(args: readonly string[]): { tag: string } | string {
  if (args.length === 0) return 'name the tag to audit (like v1.1.0)'
  if (args.length > 1) return 'only one tag can be audited at a time'
  const tag = args[0]!
  if (tag.startsWith('-')) return `unknown option ${JSON.stringify(tag).slice(0, 30)} (this tool takes a tag and nothing else)`
  if (!isStableTag(tag)) return `${JSON.stringify(tag).slice(0, 40)} is not a tag (like v1.1.0)`

  return { tag }
}

if (isRunDirectly(import.meta.url)) {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
  const parsed = parseReleaseAuditArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:audit -- <tag>`)
    process.exit(1)
  }
  if (process.platform !== 'darwin') {
    console.error('release:audit runs on macOS: it mounts the disk image and runs codesign')
    process.exit(1)
  }

  try {
    const envPath = join(REPO_ROOT, '.env')
    const result = await releaseAudit(
      { tag: parsed.tag, envText: existsSync(envPath) ? readFileSync(envPath, 'utf8') : undefined },
      createAuditHost(nodeRunner, REPO_ROOT),
      (line) => console.log(`ok    ${line}`),
      (line) => console.log(`note  ${line}`),
    )
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`${result.tag}: ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log(`${result.tag}: audited, no problem found`)
  } catch (error) {
    console.error(reason(error))
    process.exit(1)
  }
}
