// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { setActiveLanguage } from '../../locale/index.js'
import { LayerStackProvider, useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { AboutScreen } from './AboutScreen.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

/** About on top of a Home layer, and a way to read the stack's depth. */
function renderAbout() {
  const depth = { current: 0 }

  function Harness() {
    const stack = useLayerStack()
    depth.current = stack.stack.length
    useEffect(() => {
      stack.push({ id: 'about', kind: 'about', tabLabel: () => 'About', content: '' })
    }, [])
    return <AboutScreen />
  }

  render(
    <OverlayManagerProvider>
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
        <Harness />
      </LayerStackProvider>
    </OverlayManagerProvider>,
  )
  return depth
}

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

  describe('data sources', () => {
    it('lists the seven sources in the design’s order, TMDB last, each with what it powers and a link', () => {
      renderAbout()
      const rows = screen.getAllByRole('listitem')

      expect(rows.map((row) => row.querySelector('.q-about-source-name')?.textContent?.replace('▸', '').trim())).toEqual([
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
