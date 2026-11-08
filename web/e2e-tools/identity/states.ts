import type { Page } from '@playwright/test'
import { en } from '../../src/locale/en.js'

/**
 * The screens and held-still moments every theme is captured in. One list for all themes: a new screen is added here once and every theme
 * and skin gets it (Phase 48.0). A state may only read; the few that need a write (a toast, a drag) make a list of their own and remove it.
 */
const q = en.quantum

/** What Preview and Surprise Me read from the network, answered the same every time. */
const previewItems = Array.from({ length: 12 }, (_, n) => ({ title: `Preview track ${n + 1}`, timeToConsumeMinutes: 3 + (n % 4), group: n < 6 ? 'Side A' : 'Side B' }))

/** The lists the seed makes. Their titles are the only thing the states and the Home filter need. */
export const SEED = {
  saga: 'Identity Saga',
  tunes: 'Identity Tunes',
  show: 'Identity Show',
  games: 'Identity Games',
} as const

export const SEED_YAML: Record<keyof typeof SEED, string> = {
  saga: [
    `title: ${SEED.saga}`,
    'category: movie',
    'description: A fixed list for the identity tool.',
    'items:',
    ...['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'].map(
      (name, n) => `  - { title: "Saga ${name}", minutes: ${60 + n * 15}, group: "Part ${n < 3 ? 1 : n < 6 ? 2 : 3}" }`,
    ),
    '',
  ].join('\n'),
  tunes: [`title: ${SEED.tunes}`, 'category: music', 'items:', ...['Intro', 'Verse', 'Chorus', 'Outro'].map((name, n) => `  - { title: "Track ${name}", minutes: ${3 + n} }`), ''].join('\n'),
  games: [`title: ${SEED.games}`, 'category: game', 'items:', ...['Alpha', 'Beta'].map((name) => `  - { title: "Game ${name}", minutes: 600, group: "Campaign" }`), ''].join('\n'),
  show: [`title: ${SEED.show}`, 'category: tv', 'items:', ...['Pilot', 'Second', 'Third'].map((name, n) => `  - { title: "Episode ${name}", minutes: ${40 + n}, group: "Season 1" }`), ''].join('\n'),
}

export interface IdentityState {
  id: string
  viewport?: { width: number; height: number }
  /** Leave the pointer where the setup put it (a hover, a drag); every other state parks it in the corner so nothing is hovered. */
  keepPointer?: boolean
  /** Brings the app to the state. May return a function that undoes what it wrote. */
  setup(page: Page): Promise<(() => Promise<void>) | void>
}

const home = async (page: Page) => {
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const openList = async (page: Page, title: string) => {
  await home(page)
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const newList = async (page: Page, category: string) => {
  await home(page)
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: new RegExp(`^${category}`) }).click()
}

const owned = new WeakMap<Page, Set<string>>()

/** The ids of the lists a state wrote on this page: Home shows them beside the seed lists and shows no one else's. */
export const ownedIds = (page: Page): Set<string> => {
  const ids = owned.get(page) ?? new Set<string>()
  owned.set(page, ids)
  return ids
}

/** A list of its own, for the states that write; removed by the returned function. */
const ownList = async (page: Page, title: string, items: number) => {
  const rows = Array.from({ length: items }, (_, n) => `  - { title: "Own ${n + 1}", minutes: 30, group: "Own group" }`)
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  const { id } = (await made.json()) as { id: string }
  ownedIds(page).add(id)
  return { id, remove: async () => void (await page.request.delete(`/api/lists/${id}`)) }
}

export const STATES: readonly IdentityState[] = [
  { id: 'home', setup: home },
  {
    id: 'picker',
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile').first().waitFor()
    },
  },
  { id: 'new-list-search', setup: (page) => newList(page, 'Movies') },
  {
    id: 'new-list-hand',
    setup: async (page) => {
      await newList(page, 'Movies')
      await page.getByRole('tab', { name: q.createList.handTab }).click()
    },
  },
  {
    id: 'new-list-import',
    setup: async (page) => {
      await newList(page, 'Movies')
      await page.getByRole('tab', { name: q.createList.importTab }).click()
    },
  },
  {
    id: 'vault',
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.getByRole('button', { name: q.vaultShelf.browse }).click()
      await page.locator('.q-vb-cat').first().waitFor()
    },
  },
  {
    id: 'settings',
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: 'Settings' }).click()
    },
  },
  {
    id: 'about',
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: 'About', exact: true }).click()
    },
  },
  { id: 'list', setup: (page) => openList(page, SEED.saga) },
  { id: 'list-2560', viewport: { width: 2560, height: 1200 }, setup: (page) => openList(page, SEED.saga) },
  { id: 'list-3440', viewport: { width: 3440, height: 1200 }, setup: (page) => openList(page, SEED.saga) },
  {
    id: 'list-more-menu',
    setup: async (page) => {
      await openList(page, SEED.saga)
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await page.locator('.q-pop').first().waitFor()
    },
  },
  {
    id: 'tooltip',
    keepPointer: true,
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: 'Settings' }).hover()
      await page.getByRole('tooltip').waitFor()
    },
  },
  {
    id: 'toast',
    setup: async (page) => {
      const own = await ownList(page, 'Identity Toast', 3)
      await openList(page, 'Identity Toast')
      await page.locator('.q-item', { hasText: 'Own 1' }).first().focus()
      await page.keyboard.press('Shift+ArrowDown')
      await page.locator('.q-toast').waitFor()
      return own.remove
    },
  },
  {
    id: 'preview',
    setup: async (page) => {
      await page.route('**/api/media-types/music/search**', (route) =>
        route.fulfill({ json: { sources: [{ externalRef: 'identity-1', title: 'Identity source', detail: 'Group · XX', itemCount: previewItems.length }] } }),
      )
      await page.route('**/api/media-types/music/expansion**', (route) =>
        route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: previewItems.length, status: 'complete', items: previewItems } : { itemCount: previewItems.length } }),
      )
      await newList(page, 'Music')
      await page.getByLabel(/^Search .* or List Vault$/).fill('identity')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.locator('.q-result').first().waitFor()
      await page.locator('.q-result').first().click()
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
      await page.locator('.q-preview-row').first().waitFor()
    },
  },
  {
    id: 'sheet',
    setup: async (page) => {
      await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [{ externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, description: 'Three volumes.', status: 'complete' }], reachable: true } }))
      await home(page)
      await page.getByRole('button', { name: 'Surprise Me' }).click()
      await page.locator('.q-sheet').waitFor()
    },
  },
  {
    id: 'item-edit-popover',
    setup: async (page) => {
      await openList(page, SEED.saga)
      await page.getByRole('button', { name: 'Edit Saga Three' }).click()
      await page.locator('.q-pop').first().waitFor()
    },
  },
  {
    id: 'group-combobox',
    setup: async (page) => {
      await openList(page, SEED.saga)
      await page.locator('.q-add-item').getByLabel('Group').click()
      await page.locator('.q-add-item').getByRole('listbox').waitFor()
    },
  },
  {
    id: 'platform-panel',
    setup: async (page) => {
      await openList(page, SEED.games)
      await page.locator('.q-add-plat').click()
      await page.locator('.q-pop').first().waitFor()
    },
  },
  {
    id: 'dragging-row',
    keepPointer: true,
    setup: async (page) => {
      await openList(page, SEED.saga)
      const handle = page.locator('.q-item', { hasText: 'Saga Three' }).locator('.q-handle')
      const from = (await handle.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 60, { steps: 6 })
      await page.locator('.q-dragging, [class*="dragging"]').first().waitFor()
      // Let go over the page's top corner on the way out, so nothing is saved.
      return async () => {
        await page.keyboard.press('Escape')
        await page.mouse.up()
      }
    },
  },
  {
    id: 'hover-primary',
    keepPointer: true,
    setup: async (page) => {
      await home(page)
      await page.getByRole('button', { name: q.home.newList }).hover()
    },
  },
  {
    id: 'hover-row',
    keepPointer: true,
    setup: async (page) => {
      await openList(page, SEED.saga)
      await page.locator('.q-item', { hasText: 'Saga Three' }).hover()
    },
  },
]
