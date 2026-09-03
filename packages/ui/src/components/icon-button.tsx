/**
 * A square button whose content is a glyph.
 *
 * `label` is required rather than optional. An icon button with no accessible
 * name is the single most common accessibility defect in a component library,
 * and the only reliable fix is to make the compiler ask for one — a lint rule
 * would not survive `aria-label={someVariable}`.
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'

import { cx } from '../lib/cx'
import { DISABLED_STYLES, FOCUS_RING } from '../lib/styles'
import { BUTTON_SIZES, BUTTON_VARIANTS, type ButtonSize, type ButtonVariant } from './button'

export { BUTTON_SIZES as ICON_BUTTON_SIZES, BUTTON_VARIANTS as ICON_BUTTON_VARIANTS }

const VARIANT_STYLES: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-strong',
  secondary: 'bg-surface-muted text-fg hover:bg-border',
  outline: 'border-border-interactive bg-surface text-fg hover:bg-surface-muted border',
  ghost: 'text-fg hover:bg-surface-muted',
  danger: 'bg-danger text-danger-fg hover:bg-danger-strong',
}

/**
 * `size-control-*` is already at or above the 44px floor at every density step,
 * and `touch-target` restates the floor so that a future size named here — a
 * genuinely small glyph in a dense table — cannot fall through it.
 */
const SIZE_STYLES: Readonly<Record<ButtonSize, string>> = {
  sm: 'size-control-sm text-sm',
  md: 'size-control-md text-base',
  lg: 'size-control-lg text-lg',
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-disabled' | 'aria-label'
> {
  /** The accessible name. Comes from the app's message catalog, never from here. */
  readonly label: string
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** See `Button.loading` — same reasoning, same `aria-disabled` treatment. */
  readonly loading?: boolean
  readonly children?: ReactNode
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  children,
  onClick,
  type = 'button',
  disabled = false,
  ...props
}: IconButtonProps) {
  const inert = loading || disabled

  return (
    <button
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      aria-label={label}
      className={cx(
        'touch-target inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        FOCUS_RING,
        DISABLED_STYLES,
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      data-loading={loading || undefined}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onClick?.(event)
      }}
      type={type}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        children
      )}
    </button>
  )
}
