// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { setActiveLanguage } from '../../locale/index.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { UpdateBlock, type UpdateBlockState } from './UpdateBlock.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

function renderBlock(state: UpdateBlockState, over: { next?: string; onCheck?: () => void; onDownload?: () => void } = {}) {
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
    ['error', { status: 'Couldn’t check for updates', version: 'Version 1.0.0', button: 'Try Again', disabled: false }],
    ['unavailable', { status: 'Checking for updates is yet TBD', version: 'Version 1.0.0', button: 'Check For Updates', disabled: true }],
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

    expect(screen.getByRole('link', { name: 'Список изменений' })).toBeTruthy()
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
      'Couldn’t check for updates',
      'Checking for updates is yet TBD',
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
    ])
  })

  it.each(['latest', 'checking', 'available', 'error', 'unavailable'] as const)(
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
  it('checks again from the up to date state and from the error state', () => {
    for (const [state, label] of [['latest', 'Check For Updates'], ['error', 'Try Again']] as const) {
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

  it('does nothing while checking or while there is nothing to check', () => {
    for (const [state, label] of [['checking', 'Checking…'], ['unavailable', 'Check For Updates']] as const) {
      const props = renderBlock(state)

      fireEvent.click(screen.getByRole('button', { name: label }))

      expect(props.onCheck).not.toHaveBeenCalled()
      expect(props.onDownload).not.toHaveBeenCalled()
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
