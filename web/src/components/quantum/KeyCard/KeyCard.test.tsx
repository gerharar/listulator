// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KeySource } from '../../../lib/config/keyTest.js'
import { keyGuideUrl } from '../../../lib/guides.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ToastProvider } from '../Toast/Toast.js'
import { KeyCard } from './KeyCard.js'
import { en } from '../../../locale/en.js'

/** The key card (H-018, 33.2): one component for the first-run callout and the Create → Search card. */

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mount(source: KeySource = 'tmdb', save = vi.fn(async () => {}), onSaved = vi.fn()) {
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <KeyCard source={source} title="One free TMDB key unlocks four categories" save={save} onSaved={onSaved}>
          Getting a key takes about two minutes.
        </KeyCard>
      </ToastProvider>
    </LiveRegionProvider>,
  )

  return { save, onSaved }
}

const keyField = () => screen.getByPlaceholderText('Your API key') as HTMLInputElement
const form = () => document.querySelector('form') as HTMLFormElement

describe('KeyCard', () => {
  it('shows the title, the body, one key field, Save Key and the guide link for the source', () => {
    mount()

    expect(screen.getByText('One free TMDB key unlocks four categories')).toBeTruthy()
    expect(screen.getByText('Getting a key takes about two minutes.')).toBeTruthy()
    expect(keyField().type).toBe('password')
    expect(screen.getByRole('button', { name: en.quantum.keyCard.saveKey })).toBeTruthy()
    const link = screen.getByRole('link', { name: new RegExp(en.quantum.keyCard.how) })
    expect(link.getAttribute('href')).toBe(keyGuideUrl('tmdb'))
  })

  it('shows Client ID and Client Secret for IGDB, and the guide of that source', () => {
    mount('igdb')

    expect(screen.getByPlaceholderText('Your Client ID')).toBeTruthy()
    expect(screen.getByPlaceholderText('Your Client Secret')).toBeTruthy()
    expect(screen.getByRole('link', { name: new RegExp(en.quantum.keyCard.how) }).getAttribute('href')).toBe(keyGuideUrl('igdb'))
  })

  it('saves nothing when the field is empty: it is marked, says what is missing and has the cursor', () => {
    const { save, onSaved } = mount()

    fireEvent.submit(form())

    expect(save).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(keyField().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Paste the key first')).toBeTruthy()
    expect(document.activeElement).toBe(keyField())
  })

  it('says what is missing for IGDB: both, or the one that is empty', () => {
    const { save } = mount('igdb')

    fireEvent.submit(form())
    expect(screen.getByText('Paste the Client ID and Client Secret first')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Your Client ID'), { target: { value: 'an-id' } })
    fireEvent.submit(form())
    expect(screen.getByText('Paste the Client Secret first')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('treats a key of only spaces as empty', () => {
    const { save } = mount()

    fireEvent.change(keyField(), { target: { value: '   ' } })
    fireEvent.submit(form())

    expect(save).not.toHaveBeenCalled()
    expect(screen.getByText('Paste the key first')).toBeTruthy()
  })

  it('saves the key as Settings does (trimmed, in the source’s field), tells the app, toasts without the key, and goes', async () => {
    const { save, onSaved } = mount()

    fireEvent.change(keyField(), { target: { value: '  secret-token-123  ' } })
    fireEvent.submit(form())

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith({ tmdbApiKey: 'secret-token-123' })
    expect(screen.getByText('TMDB key saved. You can change it in Settings')).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret-token-123')
    expect(document.querySelector('form')).toBeNull()
  })

  it('saves both IGDB fields', async () => {
    const { save } = mount('igdb')

    fireEvent.change(screen.getByPlaceholderText('Your Client ID'), { target: { value: 'an-id' } })
    fireEvent.change(screen.getByPlaceholderText('Your Client Secret'), { target: { value: 'a-secret' } })
    fireEvent.submit(form())

    await waitFor(() => expect(save).toHaveBeenCalledWith({ igdbClientId: 'an-id', igdbClientSecret: 'a-secret' }))
    expect(screen.getByText('IGDB key saved. You can change it in Settings')).toBeTruthy()
  })

  it('stays, with what was typed, and says so when saving fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('disk full')
    })
    const { onSaved } = mount('tmdb', save)

    fireEvent.change(keyField(), { target: { value: 'abc' } })
    fireEvent.submit(form())

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(keyField().value).toBe('abc')
    expect(onSaved).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('disk full')
  })

  it('does not save twice while a save is under way', async () => {
    let finish: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    mount('tmdb', save)

    fireEvent.change(keyField(), { target: { value: 'abc' } })
    fireEvent.submit(form())
    fireEvent.submit(form())
    finish()

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })
})
