import { createElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useTooltip } from './useTooltip.js'

type TipTag = 'span' | 'div' | 'b' | 'button'

export interface TipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The element to draw. */
  as?: TipTag
  /** The hover text, in place of a native `title`. Nothing: no tooltip. */
  text: string | undefined
  /** Also read out as the element's description (`aria-description`): for a control whose name is not this text. */
  describe?: boolean
  /** For a name that repeats what is written: a tooltip only when the text is cut off by an ellipsis. */
  whenClipped?: boolean
  children?: ReactNode
}

/**
 * An element with the app's own tooltip instead of a native `title` (11.20): the `Button` family has
 * it built in; this is for the spans, chips and bare buttons that are not one. Everything else passed
 * (class, handlers, aria, `type`, `disabled`) goes to the element as it is.
 */
export function Tip({ as = 'span', text, describe = false, whenClipped = false, children, ...rest }: TipProps) {
  const tip = useTooltip(text, { whenClipped })

  return (
    <>
      {createElement(as, tip.props({ ...rest, ...(describe && text ? { 'aria-description': text } : {}) }), children)}
      {tip.node}
    </>
  )
}
