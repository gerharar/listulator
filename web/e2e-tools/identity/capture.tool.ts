import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { diffDumps } from './diff.js'
import { dumpPage, type PageDump } from './dump.js'
import { SEED, STATES, ownedIds, type IdentityState } from './states.js'
import { THEMES } from './themes.js'

/**
 * One test per (theme, skin, state) in each engine. `IDENTITY_MODE=capture` writes the screenshot and the dump of the page under
 * baselines/<IDENTITY_BASELINE>/<theme>/<skin>/<engine>/; `compare` takes the same capture afresh and fails on every difference from the
 * baseline of that name. `IDENTITY_THEME` limits it to one theme (default: every theme in themes.ts), `IDENTITY_STATE` to one state.
 */
const mode = process.env['IDENTITY_MODE']
const label = process.env['IDENTITY_BASELINE']
const only = process.env['IDENTITY_THEME']
const onlyState = process.env['IDENTITY_STATE']
const root = new URL('../baselines/', import.meta.url).pathname

if (mode !== 'capture' && mode !== 'compare') throw new Error('Set IDENTITY_MODE to capture or compare.')
if (label === undefined || !/^[\w.-]+$/.test(label)) throw new Error('Set IDENTITY_BASELINE to a name for this capture, e.g. the commit it was taken at.')

const seeded = new Set<string>(Object.values(SEED))

/** What the app is told is the same on every run: the clock, the library, the dates of the lists. */
async function steady(page: Page, skin: string, seed: Readonly<Record<string, string>>) {
  await page.addInitScript(
    (entries) => {
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value)
      } catch {
        // A page that cannot store preferences is not what is being measured.
      }
    },
    Object.entries({ ...seed, skin, reducedMotion: 'true' }),
  )
  await page.clock.setFixedTime(new Date("2026-01-15T12:00:00Z"))
  // Not reachable from here and not what is measured: the community library is only read by Surprise Me and the Vault.
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  // Home lists the identity lists and whatever this test wrote itself, never what a parallel test is writing; the dates are fixed, not the day it was made.
  await page.route('**/api/lists', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const lists = (await response.json()) as { id: string; title: string; createdAt: string; updatedAt: string; stats: { lastConsumedAt: string | null } }[]
    const mine = lists
      .filter((list) => seeded.has(list.title) || ownedIds(page).has(list.id))
      .map((list) => ({
        ...list,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        stats: { ...list.stats, lastConsumedAt: list.stats.lastConsumedAt === null ? null : '2026-01-10T00:00:00.000Z' },
      }))
    return route.fulfill({ response, json: mine })
  })
}

/** Longer than any timer the app starts on its own (the longest, a layer's `enter` class, is 400ms or so). */
const QUIET_MS = 700

/** Nothing moving, fonts in, two frames drawn: the page the person would be looking at once it has come to rest. */
async function settle(page: Page) {
  // Each evaluation is serialised alone, so neither can use a helper defined outside it. A finished animation that holds its last frame
  // (fill: both) is still listed by getAnimations(); only one that is playing counts.
  // What the screen asked for has come back (the picker's counts arrive after the screen is drawn) before the page is judged quiet.
  await page.waitForLoadState('networkidle')
  // Some classes come off on a timer (a layer's `enter`): a quiet stretch with no change to the page at all, before anything is read.
  await page.evaluate(
    (quiet) =>
      new Promise<void>((resolve) => {
        let timer = setTimeout(done, quiet)
        const observer = new MutationObserver(() => {
          clearTimeout(timer)
          timer = setTimeout(done, quiet)
        })
        function done() {
          observer.disconnect()
          resolve()
        }
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
      }),
    QUIET_MS,
  )
  await page.evaluate(async () => {
    const playing = () => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending)
    await document.fonts.ready
    // Something that finishes can start the next (a toast that mounts again once the list has answered): wait until a pair of frames passes with nothing playing.
    for (let round = 0; round < 20; round++) {
      await Promise.all(playing().map((animation) => animation.finished.catch(() => undefined)))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (playing().length === 0) return
    }
  })
  const left = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running' || animation.pending)
      .map((animation) => `${(animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty} on ${(animation.effect as KeyframeEffect | null)?.target?.className}`),
  )
  expect(left, 'the page never came to rest').toEqual([])
}

/** How many pixels differ and where, for a screenshot that is not byte-for-byte the baseline. Decoded in the page, so no image library is needed. */
async function pixelDifference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const load = async (base64: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [x, y] = await Promise.all([load(first!), load(second!)])
      if (x.width !== y.width || x.height !== y.height) return `size ${x.width}x${x.height} -> ${y.width}x${y.height}`
      let count = 0
      let left = x.width
      let top = x.height
      let right = -1
      let bottom = -1
      for (let at = 0; at < x.data.length; at += 4) {
        if (x.data[at] === y.data[at] && x.data[at + 1] === y.data[at + 1] && x.data[at + 2] === y.data[at + 2] && x.data[at + 3] === y.data[at + 3]) continue
        const px = (at / 4) % x.width
        const py = Math.floor(at / 4 / x.width)
        count++
        left = Math.min(left, px)
        right = Math.max(right, px)
        top = Math.min(top, py)
        bottom = Math.max(bottom, py)
      }
      return `${count} pixels differ, within x ${left}-${right}, y ${top}-${bottom}`
    },
    [a.toString('base64'), b.toString('base64')] as const,
  )
}

const themes = Object.entries(THEMES).filter(([name]) => only === undefined || only === name)
if (themes.length === 0) throw new Error(`No theme called ${only}.`)

for (const [themeName, theme] of themes) {
  for (const skin of theme.skins) {
    for (const state of STATES.filter((candidate: IdentityState) => onlyState === undefined || candidate.id === onlyState)) {
      test(`${themeName} / ${skin} / ${state.id}`, async ({ page, browserName }) => {
        if (state.viewport !== undefined) await page.setViewportSize(state.viewport)
        await steady(page, skin, theme.seed)
        const undo = await state.setup(page)
        try {
          if (state.keepPointer !== true) await page.mouse.move(0, 0)
          await settle(page)
          const picture = await page.screenshot({ caret: 'hide', animations: 'allow' })
          const dump = await dumpPage(page)

          const place = (base: string) => join(root, base, themeName, skin, browserName)
          const files = (base: string) => ({ png: join(place(base), `${state.id}.png`), json: join(place(base), `${state.id}.json`) })

          if (mode === 'capture') {
            const target = files(label!)
            mkdirSync(place(label!), { recursive: true })
            writeFileSync(target.png, picture)
            writeFileSync(target.json, JSON.stringify(dump))
            return
          }

          const was = files(label!)
          expect(existsSync(was.json) && existsSync(was.png), `no baseline called ${label} for ${themeName} / ${skin} / ${browserName} / ${state.id}`).toBe(true)
          const lines = diffDumps(JSON.parse(readFileSync(was.json, 'utf8')) as PageDump, dump)
          const pixels = readFileSync(was.png).equals(picture) ? '' : await pixelDifference(page, readFileSync(was.png), picture)
          if (lines.length > 0 || pixels !== '') {
            // Keep what was seen, to look at beside the baseline.
            mkdirSync(place('_current'), { recursive: true })
            writeFileSync(files('_current').png, picture)
            writeFileSync(files('_current').json, JSON.stringify(dump))
          }
          const shown = lines.slice(0, 12).join('\n')
          expect({ screenshot: pixels === '' ? 'same' : pixels, dump: lines.length === 0 ? 'same' : `${lines.length} differences\n${shown}${lines.length > 12 ? '\n…' : ''}` }).toEqual({ screenshot: 'same', dump: 'same' })
        } finally {
          await undo?.()
        }
      })
    }
  }
}
