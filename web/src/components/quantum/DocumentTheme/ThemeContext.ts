import { createContext, useContext } from 'react'
import type { Theme } from '../../../lib/preferences/theme.js'

/**
 * The theme the app is drawn in, for the few components whose DOM (not only their CSS) belongs to one theme: the backdrop and the header plates are
 * Quantum's and are not rendered at all under eX-Zed. `DocumentTheme` provides it; outside one (a component test) it is Quantum, the default.
 */
export const ThemeContext = createContext<Theme>('quantum')

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
