import './ThemeBackdrop.css'
import { Atmosphere } from '../Atmosphere/Atmosphere.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'

/**
 * The places eX-Zed's skin art goes (X-006 fills them; Phase 48.6 only names them): the ground behind the window, the separator under the header,
 * the strip at the bottom of the screen and the art at the window's sides. (A fifth slot, the bottom scene of Choose Your Fighter, was named here in 48.6 and left in
 * 50.8: that scene is not behind the shell but the last thing in the picker's own scroll area, `BottomScene`.)
 */
export const SLOTS = ['window', 'header', 'bottom', 'sides'] as const

/**
 * What is drawn behind the app shell. Quantum: the `Atmosphere` field, exactly as before. eX-Zed: the four slots, empty of content (their art is CSS backgrounds, `exzed-art.css`), and no Atmosphere, whose washes, rings and alpha are Quantum's look. The slots take no space: the wrapper is fixed and click-through
 * and each slot is absolute with no content.
 */
export function ThemeBackdrop() {
  const theme = useTheme()

  if (theme !== 'exzed') return <Atmosphere />

  return (
    <div className="q-backdrop" aria-hidden="true">
      {SLOTS.map((slot) => (
        <div key={slot} data-slot={slot} />
      ))}
    </div>
  )
}
