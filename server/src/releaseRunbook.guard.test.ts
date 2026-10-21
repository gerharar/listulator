import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The release runbook (`docs/release-runbook.md`) names commands the owner types on release day (Phase 31, task 31.11). `docs/` is its own
 * private repository, so it is not there in CI or in someone else's clone: then these tests do not run. In the owner's checkout they stop
 * the runbook from naming a command that was renamed or never existed, and from leaving out a step of the routine.
 */

const ROOT = join(import.meta.dirname, '../..')
const RUNBOOK = join(ROOT, 'docs/release-runbook.md')
interface Manifest {
  name?: string
  scripts: Record<string, string>
}

const readManifest = (path: string) => JSON.parse(readFileSync(join(ROOT, path, 'package.json'), 'utf8')) as Manifest
const pkg = readManifest('.')
const workspaces = Object.fromEntries(['server', 'web', 'apps/desktop'].map((path) => [readManifest(path).name, readManifest(path)]))

/** The scripts a command runs: the root's, or the named workspace's when it says `-w <workspace>`. */
const scriptsOf = (rest: string) => workspaces[/ -w (\S+)/.exec(rest)?.[1] ?? '']?.scripts ?? pkg.scripts

/** The routine, in the order it is typed. Each is a command of the new release routine, and the runbook has to say when to type it. */
const ROUTINE = ['release:prepare', 'release:audit', 'release:ship', 'release:verify']

describe.skipIf(!existsSync(RUNBOOK))('the release runbook', () => {
  // The suite body also runs when the tests are skipped, so it must not fail where the file is absent.
  const text = existsSync(RUNBOOK) ? readFileSync(RUNBOOK, 'utf8') : ''
  const commands = [...text.matchAll(/npm run ([\w:.-]+)((?: [^\n`]*)?)/g)].map((match) => ({ script: match[1]!, rest: match[2] ?? '' }))

  it('names only npm scripts that exist', () => {
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.filter(({ script, rest }) => scriptsOf(rest)[script] === undefined).map(({ script }) => script)).toEqual([])
  })

  it.each(ROUTINE)('says when to run %s', (script) => {
    expect(commands.some((command) => command.script === script)).toBe(true)
  })

  it('has the commands in the order they are typed: prepare, audit, ship, verify', () => {
    const at = ROUTINE.map((script) => text.indexOf(`npm run ${script}`))

    expect(at.every((position) => position >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('uses only flags the tool knows', () => {
    const unknown: string[] = []
    for (const { script, rest } of commands) {
      if (/ -w /.test(rest)) continue
      const file = /tsx (\S+)/.exec(pkg.scripts[script] ?? '')?.[1]
      if (file === undefined) continue
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const flag of rest.match(/(?<=\s)--[a-z][\w-]*/g) ?? []) {
        if (!source.includes(flag)) unknown.push(`${script} ${flag}`)
      }
    }

    expect(unknown).toEqual([])
  })

  it('keeps the old manual way as the fallback when a tool is broken, with release:sign in it', () => {
    const fallback = text.slice(text.search(/^## .*fallback/im))

    expect(/^## .*fallback/im.test(text)).toBe(true)
    expect(fallback).toContain('npm run release:sign')
  })

  it('says who does every step of the routine: You, Claude or GitHub', () => {
    const sections = ['## Before you start', '## Make a release', '## Still by hand']
    const steps = sections.flatMap((heading) => {
      const start = text.indexOf(heading)
      const end = text.indexOf('\n## ', start + 1)

      return start < 0 ? [heading] : text.slice(start, end < 0 ? undefined : end).split('\n').filter((line) => /^\d+\. /.test(line))
    })

    expect(steps.length).toBeGreaterThan(10)
    expect(steps.filter((line) => !/^\d+\. \*\*(You|Claude|GitHub)\b/.test(line))).toEqual([])
  })

  it('has a legend for those names near the top', () => {
    expect(text.slice(0, text.indexOf('## Before you start'))).toMatch(/\*\*You\*\*[\s\S]*\*\*Claude\*\*[\s\S]*\*\*GitHub\*\*/)
  })

  it('says to look at the canary before a release, and what to do when GitHub has switched it off', () => {
    expect(text).toMatch(/canary/i)
    expect(text).toMatch(/60 days/)
  })
})
