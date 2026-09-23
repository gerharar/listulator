import type { ButtonHTMLAttributes } from 'react'
import './ToggleChip.css'

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

export function ToggleChip({ pressed, variant = 'default', className, children, ...rest }: ToggleChipProps) {
  const classes = ['q-chip', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')

  return (
    <button className={classes} aria-pressed={pressed} {...rest}>
      {children}
    </button>
  )
}
