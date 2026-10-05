// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { LocalSettings } from '../../lib/config/localConfig.js'
import type { KeySource, KeyTestResult } from '../../lib/config/keyTest.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { setActiveLanguage } from '../../locale/index.js'
import { en } from '../../locale/en.js'
import { ru } from '../../locale/ru.js'
import { de } from '../../locale/de.js'
import { ApiKeysSection, saveAndReload } from './ApiKeysSection.js'
import { updateLocalSettings } from '../../lib/config/localConfig.js'
import { resetLocalMediaTypes } from '../../lib/ingestion/localMediaTypes.js'
import { notifyRegistryChanged } from '../../lib/registryChanges.js'

vi.mock('../../lib/config/localConfig.js', () => ({ getLocalSettings: vi.fn(async () => ({})), updateLocalSettings: vi.fn(async () => {}) }))
vi.mock('../../lib/ingestion/localMediaTypes.js', () => ({ resetLocalMediaTypes: vi.fn() }))
vi.mock('../../lib/registryChanges.js', () => ({ notifyRegistryChanged: vi.fn() }))

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

function Providers({ children }: { children: ReactNode }) {
  return <OverlayManagerProvider>{children}</OverlayManagerProvider>
}

function setup(saved: LocalSettings = {}, result: KeyTestResult = 'working') {
  const save = vi.fn<(patch: Partial<LocalSettings>) => Promise<void>>(async () => {})
  const test = vi.fn<(source: KeySource, values: LocalSettings) => Promise<KeyTestResult>>(async () => result)
  const view = render(
    <Providers>
      <ApiKeysSection load={async () => saved} save={save} test={test} />
    </Providers>,
  )
  return { ...view, save, test }
}

async function ready() {
  await screen.findByText('API keys')
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Test' }).length).toBe(4))
}

const row = (name: string) => screen.getByText(name, { selector: '.q-key-name' }).closest('.q-key-row') as HTMLElement

describe('ApiKeysSection', () => {
  it('has a row for each keyed source: TMDB, IGDB, Comic Vine, YouTube', async () => {
    setup()
    await ready()

    for (const name of ['TMDB', 'IGDB', 'Comic Vine', 'YouTube']) expect(row(name)).not.toBeNull()
  })

  it('shows what was saved, masked', async () => {
    setup({ tmdbApiKey: 'abc123' })
    await ready()

    const input = within(row('TMDB')).getByPlaceholderText('Your API key') as HTMLInputElement
    expect(input.value).toBe('abc123')
    expect(input.type).toBe('password')

    act(() => within(row('TMDB')).getByRole('button', { name: 'Show key' }).click())
    expect(input.type).toBe('text')
  })

  it('IGDB takes both a client ID and a secret', async () => {
    setup()
    await ready()

    expect(within(row('IGDB')).getByPlaceholderText('Your Client ID')).not.toBeNull()
    expect(within(row('IGDB')).getByPlaceholderText('Your Client Secret')).not.toBeNull()
  })

  it('typing saves the key at once, and resets the row to Untested', async () => {
    const { save } = setup()
    await ready()
    const tmdb = row('TMDB')

    const input = within(tmdb).getByPlaceholderText('Your API key')
    act(() => {
      // React needs the native setter for a controlled input.
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'newkey')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(save).toHaveBeenLastCalledWith({ tmdbApiKey: 'newkey' })
    expect(within(tmdb).getByRole('status').textContent).toBe('Untested')
  })

  it('Test is off while the key is blank', async () => {
    setup({ tmdbApiKey: 'abc123' })
    await ready()

    expect((within(row('TMDB')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(row('YouTube')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('IGDB Test needs both fields', async () => {
    setup({ igdbClientId: 'id' })
    await ready()

    expect((within(row('IGDB')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['working', 'Working'],
    ['rejected', 'Rejected'],
    ['unreachable', 'Offline'],
    ['failed', 'Failed'],
  ] as const)('a %s test shows the pill %s, and sends the key as saved', async (result, pill) => {
    const { test } = setup({ comicVineApiKey: 'cv' }, result)
    await ready()
    const comic = row('Comic Vine')

    act(() => within(comic).getByRole('button', { name: 'Test' }).click())

    await waitFor(() => expect(within(comic).getByRole('status').textContent).toBe(pill))
    expect(test).toHaveBeenCalledWith('comicVine', expect.objectContaining({ comicVineApiKey: 'cv' }))
  })

  it('shows Testing while the answer is pending', async () => {
    let finish: (value: KeyTestResult) => void = () => {}
    const test = vi.fn(() => new Promise<KeyTestResult>((resolve) => (finish = resolve)))
    render(
      <Providers>
        <ApiKeysSection load={async () => ({ tmdbApiKey: 'k' })} save={async () => {}} test={test} />
      </Providers>,
    )
    await ready()
    const tmdb = row('TMDB')

    act(() => within(tmdb).getByRole('button', { name: 'Test' }).click())
    expect(within(tmdb).getByRole('status').textContent).toBe('Testing')

    await act(async () => finish('working'))
    expect(within(tmdb).getByRole('status').textContent).toBe('Working')
  })

  it('ignores an answer for a key that was edited while the test ran', async () => {
    let finish: (value: KeyTestResult) => void = () => {}
    const test = vi.fn(() => new Promise<KeyTestResult>((resolve) => (finish = resolve)))
    render(
      <Providers>
        <ApiKeysSection load={async () => ({ tmdbApiKey: 'k' })} save={async () => {}} test={test} />
      </Providers>,
    )
    await ready()
    const tmdb = row('TMDB')
    act(() => within(tmdb).getByRole('button', { name: 'Test' }).click())

    const input = within(tmdb).getByPlaceholderText('Your API key')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'other')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => finish('working'))

    expect(within(tmdb).getByRole('status').textContent).toBe('Untested')
  })

  it('the ⓘ says what the key is for', async () => {
    setup()
    await ready()
    const tmdb = row('TMDB')

    act(() => within(tmdb).getByRole('button', { name: 'What this key is used for' }).click())
    expect(screen.getByText('TMDB (The Movie Database)')).not.toBeNull()
    expect(screen.getByText('Used when you search for movies, TV, animation, documentaries')).not.toBeNull()
  })

  it('How? is a link out of the app to that source’s guide, marked with ↗, and opens no popover', async () => {
    setup()
    await ready()

    for (const [name, file] of [
      ['TMDB', 'tmdb-key.md'],
      ['IGDB', 'igdb-key.md'],
      ['Comic Vine', 'comic-vine-key.md'],
      ['YouTube', 'youtube-key.md'],
    ] as const) {
      const how = within(row(name)).getByRole('link', { name: /^How\?/ })
      expect(how.getAttribute('href')).toBe(`https://github.com/gerharar/listulator/blob/main/guides/${file}`)
      expect(how.getAttribute('target')).toBe('_blank')
      expect(how.getAttribute('rel')).toContain('noopener')
      expect(how.textContent).toBe('How?↗')
      expect(how.querySelector('[aria-hidden="true"]')?.textContent).toBe('↗')
    }

    act(() => within(row('TMDB')).getByRole('link', { name: /^How\?/ }).click())
    expect(screen.queryByText('Getting Your Key')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("sizes every status pill to the longest status label of the current language, not of all of them", async () => {
    const widest = (locale: { quantum: { settings: { keys: { status: Record<string, string> } } } }) =>
      Math.max(...Object.values(locale.quantum.settings.keys.status).map((label) => label.length))

    for (const [language, locale] of [['en', en], ['ru', ru], ['de', de]] as const) {
      setActiveLanguage(language)
      const { container, unmount } = setup()
      await waitFor(() => expect(container.querySelector('.q-key-rows')).not.toBeNull())

      const rows = container.querySelector('.q-key-rows') as HTMLElement
      expect(rows.style.getPropertyValue('--pill-chars'), language).toBe(String(widest(locale)))
      unmount()
    }
    expect(widest(en)).toBeLessThan(widest(de))
  })
})

describe('saving a key (16.5 finding)', () => {
  it('writes it, rebuilds the registry, and tells the app so every screen asks again what can be searched and previewed', async () => {
    await saveAndReload({ tmdbApiKey: 'k' } as Partial<LocalSettings>)

    expect(updateLocalSettings).toHaveBeenCalledWith({ tmdbApiKey: 'k' })
    expect(resetLocalMediaTypes).toHaveBeenCalledOnce()
    expect(notifyRegistryChanged).toHaveBeenCalledOnce()
    expect(vi.mocked(resetLocalMediaTypes).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(notifyRegistryChanged).mock.invocationCallOrder[0]!,
    )
  })
})
