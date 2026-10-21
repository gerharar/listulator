import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { isRunDirectly } from './runDirectly.js'
import { describeFindings, scanFiles } from './secretScan.js'
import { filesIn } from './updaterTestConfig.js'

/**
 * Looks at what a finished GitHub Actions run made PUBLIC, for anything that looks like a key or a secret (Phase 31, rule S7):
 *
 *   npm run secrets:scan-run -- <run id> [--expect <file name>,<file name>…]
 *
 * It downloads the run's whole log and its artifacts (to a temporary folder it removes afterwards) and runs the same scan the pushes get over
 * them. With --expect, the artifact must hold exactly those file names (any folder level) and nothing else. The log and the artifacts of a
 * public repository can be read by anyone, so a hit means treat it as published. It prints the rule, the file and the line, never the text.
 */

/** The differences between the files an artifact holds and the exact list it should hold; empty when they match. */
export function unexpectedFiles(found: string[], expected: string[]): string[] {
  const names = found.map((path) => ({ path, name: basename(path) }))
  const extra = names.filter(({ name }) => !expected.includes(name)).map(({ path }) => `unexpected file: ${path}`)
  const missing = expected.filter((name) => !names.some((entry) => entry.name === name)).map((name) => `missing file: ${name}`)

  return [...extra, ...missing]
}

/** Whether gh's failure to download means the run uploaded no artifacts (the canary uploads none, on purpose), not that something went wrong. */
export function hasNoArtifacts(message: string): boolean {
  return message.includes('no valid artifacts found to download')
}

/** Downloads the run's artifacts; a run that has none is fine (its log is still scanned), any other failure is not. */
function downloadArtifacts(runId: string, into: string): void {
  try {
    execFileSync('gh', ['run', 'download', runId, '-D', into], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
    if (!hasNoArtifacts(stderr)) throw error
  }
}

function main(args: string[]): number {
  const runId = args[0]
  if (runId === undefined || !/^\d+$/.test(runId)) {
    console.error('Usage: npm run secrets:scan-run -- <run id> [--expect <name>,<name>…]')

    return 1
  }
  const expectAt = args.indexOf('--expect')
  const expected = expectAt === -1 ? undefined : (args[expectAt + 1] ?? '').split(',').filter((name) => name !== '')

  const dir = mkdtempSync(join(tmpdir(), 'scan-run-'))
  try {
    const log = execFileSync('gh', ['run', 'view', runId, '--log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    writeFileSync(join(dir, 'run.log'), log)
    downloadArtifacts(runId, join(dir, 'artifacts'))

    const files = filesIn(dir).map((path) => relative(dir, path))
    const artifacts = files.filter((path) => path.startsWith('artifacts'))
    console.log(`Run ${runId}: the log is ${Math.round(log.length / 1024)} KiB; ${artifacts.length} artifact files:\n${artifacts.map((path) => `  ${path}`).join('\n')}`)

    const problems = expected === undefined ? [] : unexpectedFiles(artifacts, expected)
    const findings = scanFiles(dir, files)
    if (problems.length > 0 || findings.length > 0) {
      console.error(`Treat this run as having published something it should not (the text is not printed):\n${problems.join('\n')}\n${describeFindings(findings)}`)

      return 1
    }
    console.log('Nothing key-shaped or secret-shaped in the log or the artifacts' + (expected === undefined ? '.' : ', and the artifact holds exactly the expected files.'))

    return 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (isRunDirectly(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
