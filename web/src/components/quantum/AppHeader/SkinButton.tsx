import { useRef, useState } from 'react'
import { Popover } from '../Popover/Popover.js'
import { SkinSwatch } from '../SkinSwatch/SkinSwatch.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { copy } from '../../../locale/index.js'
import { SKINS, type Skin } from '../../../lib/preferences/skin.js'

export interface SkinButtonProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
}

/**
 * The skin button + its 220px menu (design-system/components/SkinSwatch):
 * picking a row applies the skin, closes the menu, and announces the new
 * skin's label in the live region.
 */
export function SkinButton({ skin, onSkinChange }: SkinButtonProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const { announce } = useLiveRegion()

  function pick(next: Skin) {
    onSkinChange(next)
    setOpen(false)
    announce(copy.quantum.skin.changed(copy.quantum.skin.labels[next]))
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
        <SkinSwatch skin={skin} />
        <small>▼</small>
      </button>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onDismiss={() => setOpen(false)}
        width={220}
      >
        <span className="q-kicker">{copy.quantum.skin.kicker}</span>
        <div className="q-pop-menu">
          {SKINS.map((id) => (
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
