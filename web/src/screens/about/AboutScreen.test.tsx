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
    it('names the app and the version the build carries', () => {
      renderAbout()

      expect(screen.getByText('Listulator', { selector: '.q-about-name' })).toBeTruthy()
      expect(screen.getByText(`Version ${APP_VERSION}`)).toBeTruthy()
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('shows Check for updates as a placeholder: disabled, says why, and never claims the app is up to date', async () => {
      renderAbout()
      const check = screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement

      expect(check.disabled).toBe(true)
      expect(await hoverTooltip(check)).toBe('Checking for updates comes in a later version.')
      expect(screen.queryByText(/latest version/i)).toBeNull()
    })

    it('states the licences (app, lists, data), the author, and links the repository', () => {
      renderAbout()

      expect(screen.getByText(/PolyForm Noncommercial/)).toBeTruthy()
      expect(screen.getByText('Lists in the List Vault are shared under CC BY 4.0.')).toBeTruthy()
      expect(screen.getByText('Data from the sources below stays under each source’s own terms.')).toBeTruthy()
      expect(screen.getByText('gerharar')).toBeTruthy()
      const repo = screen.getByRole('link', { name: /github\.com\/neuroshaoh\/listulator/ })
      expect(repo.getAttribute('href')).toBe('https://github.com/neuroshaoh/listulator')
      expect(repo.getAttribute('target')).toBe('_blank')
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
      expect(within(rows[1]!).getByText('Albums and discographies')).toBeTruthy()
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
