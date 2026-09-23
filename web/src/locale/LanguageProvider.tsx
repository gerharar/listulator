import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { copy, setActiveLanguage } from './index.js'
import type { Locale } from './en.js'
import type { Language } from '../lib/preferences/language.js'

export interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
}

const LanguageReactContext = createContext<LanguageContextValue | null>(null)

export interface LanguageProviderProps {
  initialLanguage?: Language
  children: ReactNode
}

/**
 * The runtime half of language selection — `copy`'s static half (the
 * `Proxy`, `setActiveLanguage`) lives in `index.ts`. Mount once, above
 * anything that needs to switch live; not wired into `main.tsx` yet, same
 * as every Quantum primitive before its consuming screen lands (the
 * picker is task 10.30).
 *
 * Sets the active locale as a plain statement during render, not inside
 * `useEffect`: a child reading `copy` in *this same render pass* — on
 * first mount with a non-English `initialLanguage`, in particular — must
 * never see a stale word waiting for an effect to catch up. It's
 * idempotent (setting the same language twice is a no-op) and touches no
 * DOM, so it's safe as a render-body side effect where an effect would
 * actually be wrong here.
 */
export function LanguageProvider({ initialLanguage = 'en', children }: LanguageProviderProps) {
  const [language, setLanguage] = useState<Language>(initialLanguage)

  setActiveLanguage(language)

  const value = useMemo<LanguageContextValue>(() => ({ language, setLanguage }), [language])

  return <LanguageReactContext.Provider value={value}>{children}</LanguageReactContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageReactContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}

/**
 * For a component that only needs the words, not the switcher — reading
 * `copy` directly would work too, but wouldn't re-render on a language
 * change. This does, by subscribing to the same context.
 */
export function useCopy(): Locale {
  useLanguage()
  return copy
}
