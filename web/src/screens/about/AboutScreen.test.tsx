// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setActiveLanguage } from '../../locale/index.js'
import { LayerStackProvider, useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import type { AppUpdateChecker, UpdateResult } from '../../lib/appUpdate.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { AboutScreen } from './AboutScreen.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

/** About on top of a Home layer, and a way to read the stack's depth. */
function renderAbout(checker?: AppUpdateChecker) {
  const depth = { current: 0 }

  function Harness() {
    const stack = useLayerStack()
    depth.current = stack.stack.length
    useEffect(() => {
      stack.push({ id: 'about', kind: 'about', tabLabel: () => 'About', content: '' })
    }, [])
    return <AboutScreen {...(checker ? { checker } : {})} />
  }

  render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
          <Harness />
        </LayerStackProvider>
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )
  return depth
}

/** A checker the test answers when it likes. */
function controlledChecker(download?: AppUpdateChecker['download']) {
  const waiting: { resolve: (result: UpdateResult) => void; reject: (error: Error) => void }[] = []
  const check = vi.fn(
    () =>
      new Promise<UpdateResult>((resolve, reject) => {
        waiting.push({ resolve, reject })
      }),
  )
  const checker: AppUpdateChecker = { check, ...(download ? { download } : {}) }

  return { checker, check, answer: (result: UpdateResult) => waiting.shift()!.resolve(result), fail: () => waiting.shift()!.reject(new Error('offline')) }
}

/** The status line and the version line a reader hears: the stacked variants that are not hidden. */
const heard = () =>
  [...screen.getByRole('status').querySelectorAll('.q-about-stack')].map((stack) =>
    [...stack.children]
      .filter((variant) => variant.getAttribute('aria-hidden') !== 'true')
      .map((variant) => variant.textContent)
      .join(''),
  )
const spoken = () => document.querySelector('.q-live')?.textContent

describe('AboutScreen', () => {
  it('is headed About, and Close takes the layer off the stack', () => {
    const depth = renderAbout()
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy()
    const before = depth.current

    act(() => screen.getByRole('button', { name: 'Close' }).click())

    expect(depth.current).toBe(before - 1)
  })

  it('follows the app language', () => {
    setActiveLanguage('de')
    renderAbout()

    expect(screen.getByRole('heading', { level: 1, name: 'Über Listulator' })).toBeTruthy()
    expect(screen.getByText('Wrestling- und MMA-Events')).toBeTruthy()
  })

  describe('who and what', () => {
    it('names the app alone on its line, and shows the version the build carries in the update block', () => {
      renderAbout()

      const name = screen.getByText('Listulator', { selector: '.q-about-name' })
      expect(name.parentElement?.textContent).toBe('Listulator')
      expect(within(screen.getByRole('status')).getByText(`Version ${APP_VERSION}.`)).toBeTruthy()
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('shows the update block in its unavailable state: nothing claimed, the button disabled and explained', async () => {
      renderAbout()
      // The shipped checker answers on the next tick; until then the block says Checking….
      await act(async () => {})
      const check = screen.getByRole('button', { name: 'Check For Updates' }) as HTMLButtonElement

      expect(check.disabled).toBe(true)
      expect(await hoverTooltip(check)).toBe('Checking for updates is yet TBD.')
      // What a reader hears is the variants that are not hidden: never "up to date" without a check.
      const heard = [...screen.getByRole('status').querySelectorAll('.q-about-stack')].map((stack) =>
        [...stack.children]
          .filter((variant) => variant.getAttribute('aria-hidden') !== 'true')
          .map((variant) => variant.textContent)
          .join(''),
      )
      expect(heard).toEqual(['Checking for updates is yet TBD.', `Version ${APP_VERSION}.`])
      expect(document.querySelector('.q-about-update-block > .q-plate.q-wash')).not.toBeNull()
    })

    describe('the credits line', () => {
      const credits = () => document.querySelector('.q-about-credits') as HTMLElement

      it('is one line: the copyright, GitHub and Licensing and notices', () => {
        renderAbout()

        expect(credits().firstChild?.textContent).toBe('© 2026 Andrei Kugaevskii')
        expect([...credits().querySelectorAll('a')].map((link) => link.textContent?.replace('↗', '').trim())).toEqual([
          'GitHub',
          'Licensing and notices',
        ])
        expect(document.querySelectorAll('.q-about-credits')).toHaveLength(1)
      })

      it('opens GitHub and the licensing page in a new tab, safely', () => {
        renderAbout()
        const github = screen.getByRole('link', { name: 'GitHub' })
        const legal = screen.getByRole('link', { name: 'Licensing and notices' })

        expect(github.getAttribute('href')).toBe('https://github.com/gerharar/listulator')
        expect(legal.getAttribute('href')).toBe('https://github.com/gerharar/listulator/blob/main/NOTICE.md')
        for (const link of [github, legal]) {
          expect(link.getAttribute('target')).toBe('_blank')
          expect(link.getAttribute('rel')).toBe('noopener noreferrer')
        }
      })

      it('hides the separators and the arrows from screen readers', () => {
        renderAbout()

        expect([...credits().querySelectorAll('[aria-hidden="true"]')].map((mark) => mark.textContent)).toEqual([
          '·',
          '↗',
          '·',
          '↗',
        ])
      })

      it('replaces the author line and the licence sentence', () => {
        renderAbout()

        expect(screen.queryByText(/Made by/)).toBeNull()
        expect(screen.queryByText(/PolyForm/)).toBeNull()
        expect(screen.queryByText('gerharar')).toBeNull()
        expect(screen.queryByText(/github\.com\/gerharar\/listulator/)).toBeNull()
      })

      it('translates the licensing link and leaves the copyright and GitHub as they are', () => {
        setActiveLanguage('de')
        renderAbout()
        expect(screen.getByRole('link', { name: 'Lizenz und Hinweise' })).toBeTruthy()
        expect(screen.getByRole('link', { name: 'GitHub' })).toBeTruthy()
        expect(credits().firstChild?.textContent).toBe('© 2026 Andrei Kugaevskii')
        cleanup()

        setActiveLanguage('ru')
        renderAbout()
        expect(screen.getByRole('link', { name: 'Лицензия и уведомления' })).toBeTruthy()
        expect(screen.getByRole('link', { name: 'GitHub' })).toBeTruthy()
      })
    })
  })

  describe('the TMDB row’s expand arrow', () => {
    it('is the same ▶ the search results use, not the small ▸', () => {
      renderAbout()

      const chevron = document.querySelector('.q-about-chevron')!
      expect(chevron.textContent!.trim()).toBe('▶')
      expect(chevron.getAttribute('aria-hidden')).toBe('true')
    })
  })

  describe('data sources', () => {
    it('lists the seven sources in the design’s order, TMDB last, each with what it powers and a link', () => {
      renderAbout()
      const rows = screen.getAllByRole('listitem')

      expect(rows.map((row) => row.querySelector('.q-about-source-name')?.textContent?.replace('▶', '').trim())).toEqual([
        'IGDB',
        'MusicBrainz',
        'Open Library',
        'Comic Vine',
        'YouTube',
        'Wikipedia',
        'TMDB',
      ])
      expect(within(rows[1]!).getByText('Artists and bands')).toBeTruthy()
      expect(within(rows[5]!).getByText('Pro Wrestling and MMA events')).toBeTruthy()
      expect(within(rows[5]!).getByRole('link', { name: /wikipedia\.org/ }).getAttribute('href')).toBe(
        'https://www.wikipedia.org/',
      )
    })

    it('shows TMDB’s logo and its notice, word for word in English, open from the start', () => {
      setActiveLanguage('ru')
      renderAbout()
      const toggle = screen.getByRole('button', { name: /TMDB/ })

      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const notice = screen.getByText(
        'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
      )
      expect(notice.getAttribute('lang')).toBe('en')
      expect(screen.getByRole('img', { name: 'The Movie Database (TMDB)' })).toBeTruthy()
    })

    it('folds and unfolds the attribution from the name button or anywhere on the row, but not from its links', async () => {
      renderAbout()
      const toggle = screen.getByRole('button', { name: /TMDB/ })
      const row = toggle.closest('li')!
      const notice = /This application uses TMDB/

      act(() => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText(notice)).toBeNull()
      expect(await hoverTooltip(toggle)).toBe('Show attribution')

      fireEvent.click(within(row).getByText('Movies, TV series, animation and documentaries'))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')

      fireEvent.click(within(row).getByRole('link', { name: /themoviedb\.org/ }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')

      fireEvent.click(screen.getByText(notice))
      fireEvent.click(screen.getByRole('link', { name: 'The Movie Database (TMDB)' }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    })
  })
})

describe('checking for updates when About opens (task 13.3)', () => {
  it('asks once on opening, says Checking… meanwhile, and says up to date only after the answer', async () => {
    const { checker, check, answer } = controlledChecker()
    renderAbout(checker)

    expect(check).toHaveBeenCalledTimes(1)
    expect(heard()).toEqual(['Checking…', `Version ${APP_VERSION}.`])
    expect(screen.queryByText('Listulator is up to date.', { selector: '.q-about-stack > span:not(.off)' })).toBeNull()

    await act(async () => answer({ kind: 'latest' }))

    expect(heard()).toEqual(['Listulator is up to date.', `Version ${APP_VERSION}.`])
    expect((screen.getByRole('button', { name: 'Check For Updates' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('announces the result once, with the version, and checks again on request', async () => {
    const { checker, check, answer } = controlledChecker()
    renderAbout(checker)

    await act(async () => answer({ kind: 'latest' }))
    await waitFor(() => expect(spoken()).toBe(`Listulator is up to date. Version ${APP_VERSION}.`))

    fireEvent.click(screen.getByRole('button', { name: 'Check For Updates' }))
    expect(check).toHaveBeenCalledTimes(2)
    expect(heard()[0]).toBe('Checking…')
    await act(async () => answer({ kind: 'latest' }))
    await waitFor(() => expect(spoken()).toBe(`Listulator is up to date. Version ${APP_VERSION}.`))
  })

  it('shows Couldn’t check, announces it, and Try Again checks again', async () => {
    const { checker, check, fail, answer } = controlledChecker()
    renderAbout(checker)

    await act(async () => fail())
    expect(heard()[0]).toBe('Couldn’t check for updates.')
    await waitFor(() => expect(spoken()).toBe(`Couldn’t check for updates. Version ${APP_VERSION}.`))

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(check).toHaveBeenCalledTimes(2)
    await act(async () => answer({ kind: 'latest' }))
    expect(heard()[0]).toBe('Listulator is up to date.')
  })

  it('offers the update with both versions, announces it, and hands the download off', async () => {
    const download = vi.fn()
    const { checker, answer } = controlledChecker(download)
    renderAbout(checker)

    await act(async () => answer({ kind: 'available', version: '9.9.9' }))

    expect(heard()).toEqual(['An update is available.', `Version ${APP_VERSION} → 9.9.9.`])
    await waitFor(() => expect(spoken()).toBe(`An update is available. Version ${APP_VERSION} → 9.9.9.`))
    fireEvent.click(screen.getByRole('button', { name: 'Download Update' }))
    expect(download).toHaveBeenCalledExactlyOnceWith('9.9.9')
  })

  it('says nothing aloud when there is no updater to ask, and nothing about being up to date', async () => {
    const { checker, answer } = controlledChecker()
    renderAbout(checker)

    await act(async () => answer({ kind: 'unavailable' }))
    // The live region fills one animation frame after an announcement: wait that long before calling it silent.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    expect(heard()).toEqual(['Checking for updates is yet TBD.', `Version ${APP_VERSION}.`])
    expect(spoken()).toBe('')
  })
})

