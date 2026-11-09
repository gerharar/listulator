import { useRef, useState } from 'react'
import { Popover } from '../Popover/Popover.js'
import { ExzedSkinSwatch, SkinSwatch } from '../SkinSwatch/SkinSwatch.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'
import { Triangle } from '../Triangle/Triangle.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { copy } from '../../../locale/index.js'
import { SKINS, type Skin } from '../../../lib/preferences/skin.js'
import { EXZED_SKINS, EXZED_SKIN_NAMES, type ExzedSkin } from '../../../lib/preferences/exzedSkins.js'

export interface SkinButtonProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  /** eX-Zed's own skin and its setter (X-003): the button and its menu show the skins of the theme in force. */
  exzedSkin: ExzedSkin
  onExzedSkinChange: (skin: ExzedSkin) => void
}

/**
 * The skin button + its menu (design-system/components/SkinSwatch): picking a row applies the skin, closes the menu, and announces the new skin's label in
 * the live region. Quantum: the hexagon and the five skins in a 220px menu. eX-Zed (49.9, design X-003): the half-bucket swatch of its skin and the six skins
 * in a 288px menu, the picked one marked; the width is the token `--skin-menu-w`, which the popover's CSS reads.
 */
export function SkinButton({ skin, onSkinChange, exzedSkin, onExzedSkinChange }: SkinButtonProps) {
  const exzed = useTheme() === 'exzed'
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const { announce } = useLiveRegion()

  function pick(next: Skin) {
    onSkinChange(next)
    setOpen(false)
    announce(copy.quantum.skin.changed(copy.quantum.skin.labels[next]))
  }

  function pickExzed(next: ExzedSkin) {
    onExzedSkinChange(next)
    setOpen(false)
    announce(copy.quantum.skin.changed(EXZED_SKIN_NAMES[next]))
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="q-skin-btn"
        aria-label={copy.quantum.skin.button}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {exzed ? <ExzedSkinSwatch skin={exzedSkin} /> : <SkinSwatch skin={skin} />}
        <Triangle kind="picker" className="q-skin-caret" />
      </button>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onDismiss={() => setOpen(false)}
        width={220}
      >
        <span className="q-kicker">{copy.quantum.skin.kicker}</span>
        <div className="q-pop-menu">
          {exzed
            ? EXZED_SKINS.map((id) => (
                <button key={id} type="button" aria-current={id === exzedSkin} onClick={() => pickExzed(id)}>
                  <ExzedSkinSwatch skin={id} />
                  {EXZED_SKIN_NAMES[id]}
                </button>
              ))
            : SKINS.map((id) => (
                <button key={id} type="button" aria-current={id === skin} onClick={() => pick(id)}>
                  <SkinSwatch skin={id} small />
                  {copy.quantum.skin.labels[id]}
                </button>
              ))}
        </div>
      </Popover>
    </>
  )
}
