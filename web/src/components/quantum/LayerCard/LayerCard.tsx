import './LayerCard.css'
import type { CSSProperties, ReactNode } from 'react'
import { copy } from '../../../locale/index.js'

export interface LayerCardProps {
  /** Fixed header block (`.q-layer-head`) — omitted while hosting an old screen, which draws its own. */
  head?: ReactNode
  /** The layer's one scroller. */
  children: ReactNode
  /** Veiled, with a LayerTab, once something else is on top of it. */
  covered?: boolean
  /** 1400px max-width, for a list or preview layer — the default is 1080px. */
  wide?: boolean
  /** The LayerTab's label when covered. */
  tabLabel?: string
  /** The tab is a back *target* — jumps straight to this layer, however many are on top of it. */
  onTabClick?: () => void
  /** The veil is a generic dismiss — always pops exactly one layer, regardless of how deep the click was. */
  onVeilClick?: () => void
  /** Where this layer sits in the stage — the stack's job (its depth), not this component's. */
  style?: CSSProperties
  /** Plays the drum-in (`q-drumIn`/`q-drumShadow`) once, right after this layer was pushed or replaced onto the top. */
  entering?: boolean
}

/**
 * The surface a layer draws on (design-system/components/LayerCard): a
 * fixed header, exactly one scrolling body, and — once covered — a veil
 * plus a LayerTab back target.
 */
export function LayerCard({
  head,
  children,
  covered = false,
  wide = false,
  tabLabel,
  onTabClick,
  onVeilClick,
  style,
  entering = false,
}: LayerCardProps) {
  const className = ['q-layer', covered && 'covered', wide && 'wide', entering && 'enter']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={style}>
      {head !== undefined && <div className="q-layer-head">{head}</div>}
      <div className="q-layer-body">{children}</div>
      {covered && (
        <>
          <button className="q-layer-tab" onClick={onTabClick} title={copy.quantum.common.backToLayer}>
            <span>{tabLabel}</span>
          </button>
          <div className="q-veil" onClick={onVeilClick} />
        </>
      )}
    </div>
  )
}
