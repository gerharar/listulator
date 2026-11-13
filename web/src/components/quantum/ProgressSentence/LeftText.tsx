import { useTheme } from '../DocumentTheme/ThemeContext.js'

/** The copy's "✓ All Done": a tick, a space, the words (every locale writes it so). */
const TICK = /^✓\s*/

export interface LeftTextProps {
  /** A list's or group's time left, or its "all done" label. */
  text: string
}

/**
 * The text of a time-left slot. Under eX-Zed the font has no ✓, so an "all done" label's tick is the `done` pixel icon (design's answer D19, drawn by `exzed-tags.css`) and
 * the words follow it; every other text, and every other theme, is the text as it is.
 */
export function LeftText({ text }: LeftTextProps) {
  const theme = useTheme()
  if (theme !== 'exzed' || !TICK.test(text)) return <>{text}</>

  return (
    <>
      <span className="q-done-icon" aria-hidden="true" />
      {text.replace(TICK, '')}
    </>
  )
}
