import { describe, expect, it } from 'vitest'
import { chooseLicence, npmShippedPackages, renderNotices, type Notice } from './generateThirdPartyNotices.js'

describe('chooseLicence', () => {
  it('takes a single licence as it is', () => {
    expect(chooseLicence('MIT')).toBe('MIT')
    expect(chooseLicence('Unicode-3.0')).toBe('Unicode-3.0')
  })

  it('picks MIT, then Apache-2.0, from a choice, and never a copyleft option', () => {
    expect(chooseLicence('Apache-2.0 OR MIT')).toBe('MIT')
    expect(chooseLicence('MIT/Apache-2.0')).toBe('MIT')
    expect(chooseLicence('(MIT OR Apache-2.0)')).toBe('MIT')
    expect(chooseLicence('Apache-2.0 OR BSL-1.0')).toBe('Apache-2.0')
    expect(chooseLicence('MIT OR Apache-2.0 OR LGPL-2.1-or-later')).toBe('MIT')
  })

  it('keeps an AND whole: every part applies', () => {
    expect(chooseLicence('(MIT OR Apache-2.0) AND Unicode-3.0')).toBe('(MIT OR Apache-2.0) AND Unicode-3.0')
  })
})

describe('npmShippedPackages', () => {
  // A package-lock shape: the web workspace, its dependencies (one nested under web/), a dev tool and a server package.
  const lock = {
    packages: {
      web: { dependencies: { react: '1', lib: '1' }, devDependencies: { vitest: '1' } },
      'node_modules/react': { version: '19.0.0', license: 'MIT', dependencies: { scheduler: '1' } },
      'node_modules/scheduler': { version: '0.25.0', license: 'MIT' },
      'web/node_modules/lib': { version: '2.0.0', license: 'ISC' },
      'node_modules/lib': { version: '1.0.0', license: 'ISC' },
      'node_modules/vitest': { version: '3.0.0', license: 'MIT', dev: true },
      'node_modules/fastify': { version: '5.0.0', license: 'MIT' },
    },
  }

  it('follows the web app’s own dependencies, resolving the copy nearest to it, and nothing else', () => {
    expect(npmShippedPackages(lock, 'web')).toEqual([
      { name: 'lib', version: '2.0.0', licence: 'ISC', path: 'web/node_modules/lib' },
      { name: 'react', version: '19.0.0', licence: 'MIT', path: 'node_modules/react' },
      { name: 'scheduler', version: '0.25.0', licence: 'MIT', path: 'node_modules/scheduler' },
    ])
  })
})

describe('renderNotices', () => {
  const notice = (name: string, text: string | null, licence = 'MIT'): Notice => ({ name, version: '1.0.0', licence, text })

  it('prints each distinct licence text once, under every package it covers, in name order', () => {
    const out = renderNotices('Listulator desktop', [
      notice('zeta', 'Copyright Z\n\nPermission is hereby granted'),
      notice('alpha', 'Copyright A\n\nPermission is hereby granted'),
      notice('beta', 'Copyright Z\n\nPermission is hereby granted'),
    ])

    expect(out.match(/Copyright Z/g)).toHaveLength(1)
    expect(out.indexOf('alpha 1.0.0')).toBeLessThan(out.indexOf('beta 1.0.0'))
    expect(out).toMatch(/beta 1\.0\.0 \(MIT\)\nzeta 1\.0\.0 \(MIT\)\n\nCopyright Z/)
  })

  it('says so where a package carries no licence file, rather than inventing one', () => {
    const out = renderNotices('Listulator desktop', [notice('bare', null, 'ISC')])

    expect(out).toContain('bare 1.0.0 (ISC)')
    expect(out).toContain('No licence file ships with this package; its licence is ISC: https://spdx.org/licenses/ISC.html')
  })
})
