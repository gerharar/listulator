import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUTHOR } from './dataSources.js'

/**
 * The desktop app may only open the addresses its capability lists: an external link the screens
 * offer but the scope refuses does nothing when clicked, and nothing in a browser run or a unit
 * test would show it. Renaming the GitHub handle left the repo link on the old address while the
 * code moved on; this keeps the two together.
 */
const capabilities = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
) as { permissions: (string | { identifier: string; allow?: { url: string }[] })[] }

const openerAllows = capabilities.permissions
  .flatMap((permission) => (typeof permission === 'object' && permission.identifier === 'opener:allow-open-url' ? (permission.allow ?? []) : []))
  .map((entry) => entry.url)

/** Tauri's scope patterns: `*` stands for any run of characters. */
const allowed = (url: string): boolean =>
  openerAllows.some((pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url))

describe('the desktop opener scope', () => {
  it('lets the About screen open the repository', () => {
    expect(allowed(AUTHOR.repoUrl)).toBe(true)
  })

  it('lets a link reach the repository’s own pages, such as its licensing and notices', () => {
    expect(allowed(`${AUTHOR.repoUrl}/blob/main/NOTICE.md`)).toBe(true)
  })

  it('does not open other people’s repositories on the same host', () => {
    expect(allowed('https://github.com/someone-else/listulator')).toBe(false)
  })
})
