// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, useCopy, useLanguage } from './LanguageProvider.js'

afterEach(cleanup)

function Demo() {
  const copy = useCopy()
  const { setLanguage } = useLanguage()
  return (
    <div>
      <span>{copy.app.loading}</span>
      <button onClick={() => setLanguage('ru')}>Switch to Russian</button>
    </div>
  )
}

describe('LanguageProvider', () => {
  it('sets <html lang> to the language, and follows a switch — screen readers and hyphenation need it', () => {
    render(
      <LanguageProvider initialLanguage="de">
        <Demo />
      </LanguageProvider>,
    )
    expect(document.documentElement.lang).toBe('de')

    act(() => {
      screen.getByRole('button').click()
    })

    expect(document.documentElement.lang).toBe('ru')
  })

  it('re-renders a copy-reading component when the language changes — no reload', () => {
    render(
      <LanguageProvider>
        <Demo />
      </LanguageProvider>,
    )

    expect(screen.getByText('Loading…')).not.toBeNull()

    act(() => {
      screen.getByRole('button').click()
    })

    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('Загрузка…')).not.toBeNull()
  })

  it('mounting straight into ru reads Russian on the very first render — no flash of English', () => {
    function ReadsHomeTitle() {
      const copy = useCopy()
      return <span>{copy.quantum.home.title}</span>
    }

    render(
      <LanguageProvider initialLanguage="ru">
        <ReadsHomeTitle />
      </LanguageProvider>,
    )

    expect(screen.getByText('Мои списки')).not.toBeNull()
    expect(screen.queryByText('My Lists')).toBeNull()
  })

  it('useLanguage throws outside a LanguageProvider — same guard as the other context hooks', () => {
    function Bare() {
      useLanguage()
      return null
    }

    expect(() => render(<Bare />)).toThrow('useLanguage must be used within a LanguageProvider')
  })
})
