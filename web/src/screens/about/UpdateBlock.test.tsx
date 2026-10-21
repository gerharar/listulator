// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { setActiveLanguage } from '../../locale/index.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { UpdateBlock, showsUpdateNotice, updateNoticeText, type UpdateBlockState, type UpdatePlatform } from './UpdateBlock.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

function renderBlock(state: UpdateBlockState, over: { next?: string; onCheck?: () => void; onDownload?: () => void; platform?: UpdatePlatform } = {}) {
  const props = { onCheck: vi.fn(), onDownload: vi.fn(), current: '1.0.0', ...over }
  render(
    <OverlayManagerProvider>
      <UpdateBlock state={state} {...props} />
    </OverlayManagerProvider>,
  )

  return props
}

/** What a reader sees in one slot: the stacked variants that are not hidden. */
const shown = (stack: Element) => [...stack.children].filter((variant) => variant.getAttribute('aria-hidden') !== 'true')

const status = () => screen.getByRole('status')
const stacks = () => [...document.querySelectorAll('.q-about-stack')]

describe('the update-status block, in English', () => {
  const cases: [UpdateBlockState, { status: string; version: string; button: string; disabled: boolean }][] = [
    ['latest', { status: 'Listulator is up to date', version: 'Version 1.0.0', button: 'Check For Updates', disabled: false }],
    ['checking', { status: 'Checking…', version: 'Version 1.0.0', button: 'Checking…', disabled: true }],
    ['available', { status: 'An update is available', version: 'Version 1.0.0 → 1.1.0', button: 'Download Update', disabled: false }],
    ['error', { status: "Couldn't check for updates", version: 'Version 1.0.0', button: 'Try Again', disabled: false }],
    ['unavailable', { status: 'Checking for updates is yet TBD', version: 'Version 1.0.0', button: 'Check For Updates', disabled: true }],
    ['installError', { status: "Couldn't install the update", version: 'Version 1.0.0 → 1.1.0', button: 'Try Again', disabled: false }],
    ['installStuck', { status: 'Close Listulator and try again', version: 'Version 1.0.0 → 1.1.0', button: 'Try Again', disabled: false }],
    ['downloading', { status: 'Downloading update…', version: 'Version 1.0.0 → 1.1.0', button: 'Downloading…', disabled: true }],
    ['installing', { status: 'Installing update…', version: 'Version 1.0.0 → 1.1.0', button: 'Installing…', disabled: true }],
    ['restarting', { status: 'Restarting…', version: 'Version 1.0.0 → 1.1.0', button: 'Restarting…', disabled: true }],
  ]

  it.each(cases)('says what the %s state says', (state, expected) => {
    renderBlock(state, { next: '1.1.0' })

    const statusLine = shown(stacks()[0]!)[0]!.textContent
    const versionLine = shown(stacks()[1]!)[0]!.querySelector('.q-about-version-text')!.textContent
    expect(statusLine).toBe(expected.status)
    expect(versionLine).toBe(expected.version)
    const button = screen.getByRole('button', { name: expected.button }) as HTMLButtonElement
    expect(button.disabled).toBe(expected.disabled)
  })

  it('puts the status and the version in one status region, so a reader hears them together', () => {
    renderBlock('latest')

    expect(within(status()).getByText('Listulator is up to date')).toBeTruthy()
    expect(within(status()).getByText('Version 1.0.0')).toBeTruthy()
  })
})

describe('the changelog link (owner, 2026-10-05)', () => {
  it('sits on the version line after a separator, and opens the repository’s CHANGELOG.md in a new tab', () => {
    renderBlock('unavailable')

    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link.getAttribute('href')).toBe('https://github.com/gerharar/listulator/blob/main/CHANGELOG.md')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    const line = link.closest('.q-about-version-line')!
    expect(line.querySelector('.q-about-sep')?.getAttribute('aria-hidden')).toBe('true')
    expect(line.querySelector('.q-about-sep')?.textContent).toBe('·')
  })

  it('is one link to a reader: the copy that keeps the update line’s room is hidden', () => {
    renderBlock('latest')

    expect(screen.getAllByRole('link', { name: 'Changelog' })).toHaveLength(1)
    const copies = document.querySelectorAll('.q-about-version-line a')
    expect(copies).toHaveLength(2)
    expect(copies[1]!.closest('.off')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is translated', () => {
    setActiveLanguage('ru')
    renderBlock('unavailable')

    expect(screen.getByRole('link', { name: 'Изменения' })).toBeTruthy()
  })
})

describe('zero layout shift: every variant is in the page, only one is shown', () => {
  it('stacks all the status lines, both version lines and all the button labels', () => {
    renderBlock('latest', { next: '1.1.0' })
    const [statusStack, versionStack, buttonStack] = stacks()

    expect([...statusStack!.children].map((variant) => variant.textContent)).toEqual([
      'Listulator is up to date',
      'Checking…',
      'An update is available',
      "Couldn't check for updates",
      'Checking for updates is yet TBD',
      "Couldn't install the update",
      'Close Listulator and try again',
      'Downloading update…',
      'Installing update…',
      'Restarting…',
    ])
    expect([...versionStack!.children].map((variant) => variant.querySelector('.q-about-version-text')!.textContent)).toEqual([
      'Version 1.0.0',
      'Version 1.0.0 → 1.1.0',
    ])
    expect([...buttonStack!.children].map((variant) => variant.textContent)).toEqual([
      'Check For Updates',
      'Checking…',
      'Download Update',
      'Try Again',
      'Downloading…',
      'Installing…',
      'Restarting…',
    ])
  })

  it.each(['latest', 'checking', 'available', 'error', 'unavailable', 'installError', 'installStuck', 'downloading', 'installing', 'restarting'] as const)(
    'shows exactly one variant per slot in the %s state and hides the rest from assistive technology',
    (state) => {
      renderBlock(state, { next: '1.1.0' })

      for (const stack of stacks()) {
        expect(shown(stack)).toHaveLength(1)
        for (const hidden of [...stack.children].filter((variant) => !shown(stack).includes(variant))) {
          expect(hidden.getAttribute('aria-hidden')).toBe('true')
        }
      }
    },
  )

  it('keeps the arrow version line in the page when no update is known, so its width is already reserved', () => {
    renderBlock('latest')

    expect([...stacks()[1]!.children].map((variant) => variant.querySelector('.q-about-version-text')!.textContent)).toEqual([
      'Version 1.0.0',
      'Version 1.0.0 → 1.0.0',
    ])
  })
})

describe('the buttons', () => {
  it('checks again from the up to date state and from both error states', () => {
    for (const [state, label] of [['latest', 'Check For Updates'], ['error', 'Try Again'], ['installError', 'Try Again'], ['installStuck', 'Try Again']] as const) {
      const props = renderBlock(state)

      fireEvent.click(screen.getByRole('button', { name: label }))

      expect(props.onCheck).toHaveBeenCalledTimes(1)
      expect(props.onDownload).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('hands off to the update flow from the available state', () => {
    const props = renderBlock('available', { next: '1.1.0' })

    fireEvent.click(screen.getByRole('button', { name: 'Download Update' }))

    expect(props.onDownload).toHaveBeenCalledTimes(1)
    expect(props.onCheck).not.toHaveBeenCalled()
  })

  it('does nothing while checking, while there is nothing to check, or while the update is in progress', () => {
    for (const [state, label] of [
      ['checking', 'Checking…'],
      ['unavailable', 'Check For Updates'],
      ['downloading', 'Downloading…'],
      ['installing', 'Installing…'],
      ['restarting', 'Restarting…'],
    ] as const) {
      const props = renderBlock(state)

      fireEvent.click(screen.getByRole('button', { name: label }))

      expect(props.onCheck).not.toHaveBeenCalled()
      expect(props.onDownload).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('says the in-progress and install-error states in German and Russian, with no full stop and no guillemets', () => {
    for (const [language, state, line, button] of [
      ['de', 'downloading', 'Update wird heruntergeladen…', 'Lädt herunter…'],
      ['de', 'installing', 'Update wird installiert…', 'Installiert…'],
      ['de', 'restarting', 'Neustart…', 'Neustart…'],
      ['de', 'installError', 'Update konnte nicht installiert werden', 'Erneut versuchen'],
      ['de', 'installStuck', 'App schließen und erneut versuchen', 'Erneut versuchen'],
      ['ru', 'downloading', 'Скачиваем обновление…', 'Скачиваем…'],
      ['ru', 'installing', 'Устанавливаем обновление…', 'Устанавливаем…'],
      ['ru', 'restarting', 'Перезапускаем…', 'Перезапускаем…'],
      ['ru', 'installError', 'Не шмог обновить Listulator', 'Повторить'],
      ['ru', 'installStuck', 'Закрой Listulator и попробуй снова', 'Повторить'],
    ] as const) {
      setActiveLanguage(language)
      renderBlock(state, { next: '1.1.0' })

      expect(shown(stacks()[0]!)[0]!.textContent).toBe(line)
      expect(screen.getByRole('button', { name: button })).toBeTruthy()
      expect(line).not.toMatch(/[.«»]/)
      cleanup()
    }
  })

  it('explains the disabled button in the unavailable state with the owner’s wording', async () => {
    renderBlock('unavailable')

    expect(await hoverTooltip(screen.getByRole('button', { name: 'Check For Updates' }))).toBe('Checking for updates is yet TBD')
  })
})

describe('the skin wash', () => {
  it('sits behind the content as the helper windows’ wash, with no hatch', () => {
    renderBlock('latest')

    const plate = document.querySelector('.q-about-update-block > .q-plate.q-wash')
    expect(plate).not.toBeNull()
    expect(plate?.getAttribute('data-side')).toBe('left')
  })
})

describe('other languages', () => {
  it.each([
    ['de', 'Listulator ist auf dem neuesten Stand.', 'Version 1.0.0', 'Nach Updates suchen'],
    ['ru', 'Установлена последняя версия Listulator', 'Версия 1.0.0', 'Проверить обновления'],
  ] as const)('%s: says its own words for the status, the version and the button', (language, line, version, button) => {
    setActiveLanguage(language)
    renderBlock('latest')

    const statusLine = shown(stacks()[0]!)[0]!.textContent
    const versionLine = shown(stacks()[1]!)[0]!.querySelector('.q-about-version-text')!.textContent
    expect(statusLine).toBe(line)
    expect(versionLine).toBe(version)
    expect(screen.getByRole('button', { name: button })).toBeTruthy()
  })
})

describe('the notice row (canvas H-017): the window will close and reopen', () => {
  const STATES: UpdateBlockState[] = ['latest', 'checking', 'available', 'error', 'unavailable', 'installError', 'installStuck', 'downloading', 'installing', 'restarting']
  const notice = () => document.querySelector('.q-about-update-notice')

  it.each(STATES)('%s: is in the page exactly where an update is on offer or under way, and nowhere else', (state) => {
    renderBlock(state, { next: '1.1.0', platform: 'other' })

    const expected = ['available', 'downloading', 'installing', 'restarting'].includes(state)
    expect(notice() !== null).toBe(expected)
    expect(showsUpdateNotice(state)).toBe(expected)
  })

  it.each(['available', 'downloading', 'installing', 'restarting'] as const)('%s: says the same text, with the icon hidden from a reader', (state) => {
    renderBlock(state, { next: '1.1.0', platform: 'other' })

    expect(notice()!.textContent).toBe('Listulator will close for up to 15 seconds, then reopen by itself.')
    expect(notice()!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('stays out of the status region, so the status line keeps being read alone', () => {
    renderBlock('available', { next: '1.1.0', platform: 'other' })

    expect(status().contains(notice())).toBe(false)
    expect(within(status()).queryByText(/reopens by itself/)).toBeNull()
  })

  it('is not one of the stacked variants: it adds no hidden copy that could widen the card', () => {
    renderBlock('available', { next: '1.1.0', platform: 'other' })

    expect(notice()!.closest('.q-about-stack')).toBeNull()
    expect(stacks()).toHaveLength(3)
  })

  it.each([
    ['en', 'other', 'Listulator will close for up to 15 seconds, then reopen by itself.'],
    ['en', 'mac', 'Listulator will restart by itself.'],
    ['ru', 'other', 'Listulator закроется секунд на 10-15 и откроется сам.'],
    ['ru', 'mac', 'Listulator перезапустится сам.'],
    ['de', 'other', 'Das Fenster ist bis zu 15 Sekunden weg und kommt von selbst wieder.'],
    ['de', 'mac', 'Listulator startet von selbst neu.'],
  ] as const)('%s on %s: says design’s words', (language, platform, text) => {
    setActiveLanguage(language)
    renderBlock('available', { next: '1.1.0', platform })

    expect(notice()!.textContent).toBe(text)
    expect(updateNoticeText(platform)).toBe(text)
    expect(text).not.toMatch(/[«»]/)
  })

  it('takes the platform from the window when none is given: macOS restarts, anything else is Windows', () => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get')
    agent.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')
    expect(updateNoticeText()).toBe('Listulator will restart by itself.')
    agent.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')
    expect(updateNoticeText()).toBe('Listulator will close for up to 15 seconds, then reopen by itself.')
    agent.mockRestore()
  })
})
