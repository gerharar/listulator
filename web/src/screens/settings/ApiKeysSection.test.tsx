// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { LocalSettings } from '../../lib/config/localConfig.js'
import type { KeySource, KeyTestResult } from '../../lib/config/keyTest.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ApiKeysSection } from './ApiKeysSection.js'

afterEach(cleanup)

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

    for (const name of ['TMDB (The Movie Database)', 'IGDB (Internet Game Database)', 'Comic Vine', 'YouTube']) expect(row(name)).not.toBeNull()
  })

  it('shows what was saved, masked', async () => {
    setup({ tmdbApiKey: 'abc123' })
    await ready()

    const input = within(row('TMDB (The Movie Database)')).getByPlaceholderText('Your API key') as HTMLInputElement
    expect(input.value).toBe('abc123')
    expect(input.type).toBe('password')

    act(() => within(row('TMDB (The Movie Database)')).getByRole('button', { name: 'Show key' }).click())
    expect(input.type).toBe('text')
  })

  it('IGDB takes both a client ID and a secret', async () => {
    setup()
    await ready()

    expect(within(row('IGDB (Internet Game Database)')).getByPlaceholderText('Your Client ID')).not.toBeNull()
    expect(within(row('IGDB (Internet Game Database)')).getByPlaceholderText('Your Client Secret')).not.toBeNull()
  })

  it('typing saves the key at once, and resets the row to Untested', async () => {
    const { save } = setup()
    await ready()
    const tmdb = row('TMDB (The Movie Database)')

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

    expect((within(row('TMDB (The Movie Database)')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(row('YouTube')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('IGDB Test needs both fields', async () => {
    setup({ igdbClientId: 'id' })
    await ready()

    expect((within(row('IGDB (Internet Game Database)')).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true)
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
    const tmdb = row('TMDB (The Movie Database)')

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
    const tmdb = row('TMDB (The Movie Database)')
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

  it('the ⓘ says what the key is for, and How? gives the steps and the site', async () => {
    setup()
    await ready()
    const tmdb = row('TMDB (The Movie Database)')

    act(() => within(tmdb).getByRole('button', { name: 'What this key is used for' }).click())
    expect(screen.getByText('Used when you search for movies, TV, animation, documentaries.')).not.toBeNull()

    act(() => within(tmdb).getByRole('button', { name: 'Huh?' }).click())
    expect(screen.getByText('Getting Your Key')).not.toBeNull()
    expect(screen.getByText('themoviedb.org')).not.toBeNull()
    expect(screen.getByText('Request a Developer key (personal use is approved on the spot):')).not.toBeNull()
  })
})
