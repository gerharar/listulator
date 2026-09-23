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

  it('falls back to English for a key ru has not translated yet — mounting straight into ru', () => {
    function ReadsUntranslatedKey() {
      const copy = useCopy()
      return <span>{copy.overview.title}</span>
    }

    render(
      <LanguageProvider initialLanguage="ru">
        <ReadsUntranslatedKey />
      </LanguageProvider>,
    )

    expect(screen.getByText('Your lists')).not.toBeNull()
  })

  it('useLanguage throws outside a LanguageProvider — same guard as the other context hooks', () => {
    function Bare() {
      useLanguage()
      return null
    }

    expect(() => render(<Bare />)).toThrow('useLanguage must be used within a LanguageProvider')
  })
})
