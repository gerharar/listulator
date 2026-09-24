import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

/** design-system/components/Button — one shape in four variants, plus a secondary/default fifth. */
export type ButtonVariant = 'secondary' | 'primary' | 'quiet' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** `.sm`: 9px 14px / 13px. Meaningful on `primary`; harmless elsewhere. */
  size?: 'sm'
  /** Swaps the label to a present participle and locks the control (e.g. "Importing…"). */
  busy?: boolean
  busyLabel?: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  secondary: '',
  primary: 'primary',
  quiet: 'quiet',
  ghost: 'ghost',
  danger: 'danger',
}

export function Button({
  variant = 'secondary',
  size,
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['q-btn', VARIANT_CLASS[variant], size === 'sm' ? 'sm' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    // `type="button"` unless asked otherwise: inside a form, a bare button is a
    // submit, which made ErrorStrip's Retry send the form a second time.
    <button type="button" className={classes} disabled={disabled || busy} {...rest}>
      {busy ? busyLabel : children}
    </button>
  )
}

/** design-system/components/Button's `.q-icon-btn` — glyph-only, always with `aria-label` and a `title`. */
export type IconButtonSize = 'header' | 'sq' | 'list' | 'rail' | 'row'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  /** Required — an icon button always carries an accessible name (README). */
  label: string
}

const ICON_SIZE_CLASS: Record<IconButtonSize, string> = {
  header: '',
  sq: 'sq',
  list: 'list',
  rail: 'rail',
  row: 'row',
}

export function IconButton({ size = 'header', label, title, className, children, ...rest }: IconButtonProps) {
  const classes = ['q-icon-btn', ICON_SIZE_CLASS[size], className].filter(Boolean).join(' ')

  return (
    <button className={classes} aria-label={label} title={title ?? label} {...rest}>
      {children}
    </button>
  )
}
