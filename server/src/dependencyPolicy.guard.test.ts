import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * How dependencies are kept in check (security review, Phase 19, SR-043 and the install-script fix of 19.8;
 * docs/security-review.md). Nothing here is new behaviour: it holds today, and a change to any of it is a decision,
 * so it has to change this test too, with the reason in docs/DECISIONS.md.
 *
 * - No dependency may run an install script. npm 11 skips them unless `allowScripts` says yes; the policy is written
 *   down as an explicit `false` for each one (an older npm ignores the field, so the workflow also installs with
 *   `--ignore-scripts`).
 * - Every direct dependency is an exact version, and the lockfile holds only registry packages with an integrity hash.
 */

const ROOT = join(import.meta.dirname, '../..')
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>

const MANIFESTS = ['package.json', 'server/package.json', 'web/package.json', 'apps/desktop/package.json']
const EXACT = /^\d+\.\d+\.\d+(-[\w.]+)?$/

describe('install scripts', () => {
  it('are denied for every dependency, never allowed', () => {
    const allow = readJson('package.json')['allowScripts'] as Record<string, unknown> | undefined

    expect(allow).toBeDefined()
    expect(Object.keys(allow!).length).toBeGreaterThan(0)
    expect(Object.entries(allow!).filter(([, value]) => value !== false)).toEqual([])
  })

  it('are skipped by the workflow too: every npm install in it passes --ignore-scripts', () => {
    const workflow = loadYaml(readFileSync(join(ROOT, '.github/workflows/desktop-windows.yml'), 'utf8')) as {
      jobs: Record<string, { steps: { run?: string }[] }>
    }
    const installs = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .flatMap((step) => (step.run ?? '').split('\n'))
      .filter((line) => /\bnpm\s+(ci|install|i)\b/.test(line))

    expect(installs.length).toBeGreaterThan(0)
    expect(installs.filter((line) => !line.includes('--ignore-scripts'))).toEqual([])
  })

  it('are not switched back on by an .npmrc', () => {
    for (const rc of ['.npmrc', 'server/.npmrc', 'web/.npmrc', 'apps/desktop/.npmrc']) {
      const text = (() => {
        try {
          return readFileSync(join(ROOT, rc), 'utf8')
        } catch {
          return '' // no such file: nothing to switch the scripts back on
        }
      })()

      expect(text).not.toMatch(/^\s*(ignore-scripts\s*=\s*false|allow-scripts)/m)
    }
  })
})

describe('direct dependencies', () => {
  it.each(MANIFESTS)('%s names only exact versions', (path) => {
    const manifest = readJson(path)
    const specs = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((section) =>
      Object.entries((manifest[section] ?? {}) as Record<string, string>).map(([name, spec]) => `${name}@${spec}`),
    )

    expect(specs.length).toBeGreaterThan(0)
    expect(specs.filter((spec) => !EXACT.test(spec.slice(spec.lastIndexOf('@') + 1)))).toEqual([])
  })

  it('are overridden only where a package pins a vulnerable one (each override has a reason in DECISIONS)', () => {
    expect(readJson('package.json')['overrides']).toEqual({ 'shell-quote': '1.11.0' })
  })
})

describe('the lockfile', () => {
  const lock = readJson('package-lock.json') as { lockfileVersion: number; packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }> }
  // The packages under node_modules (the workspace folders themselves carry no source or hash).
  const packages = Object.entries(lock.packages).filter(([path]) => path.includes('node_modules/'))

  it('is version 3 and holds packages', () => {
    expect(lock.lockfileVersion).toBe(3)
    expect(packages.length).toBeGreaterThan(500)
  })

  it('takes every package from the npm registry (no git, http or file source)', () => {
    const elsewhere = packages
      .filter(([, entry]) => !entry.link)
      .filter(([, entry]) => !entry.resolved?.startsWith('https://registry.npmjs.org/'))
      .map(([path]) => path)

    expect(elsewhere).toEqual([])
  })

  it('gives every package an integrity hash', () => {
    const without = packages.filter(([, entry]) => !entry.link && !entry.integrity).map(([path]) => path)

    expect(without).toEqual([])
  })
})
