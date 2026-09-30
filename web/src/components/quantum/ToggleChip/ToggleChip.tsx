import type { ButtonHTMLAttributes } from 'react'
import './ToggleChip.css'
import { useTooltip } from '../Tooltip/useTooltip.js'

/** design-system/components/ToggleChip — lights solid `accent` when on. */
export interface ToggleChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean
  /** `help`: the help row (13px). `choice`: the larger Settings variant. */
  variant?: 'default' | 'help' | 'choice'
}

const VARIANT_CLASS: Record<NonNullable<ToggleChipProps['variant']>, string> = {
  default: '',
  help: 'help',
  choice: 'choice',
}

export function ToggleChip({ pressed, variant = 'default', className, title, children, ...rest }: ToggleChipProps) {
  const classes = ['q-chip', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
  // A title is the app's own tooltip (11.20), and still describes the chip to assistive tech.
  const tip = useTooltip(title)

  return (
    <>
      <button className={classes} aria-pressed={pressed} {...(title ? { 'aria-description': title } : {})} {...tip.props(rest)}>
        {children}
      </button>
      {tip.node}
    </>
  )
}
