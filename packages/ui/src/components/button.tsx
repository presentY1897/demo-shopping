/**
 * The primary action control.
 *
 * No `'use client'`: nothing here touches a browser API or a hook, so a server
 * component can render a submit button inside a form without dragging a client
 * boundary — and a client component can still hand it an `onClick`. Only the
 * components that genuinely need browser behaviour opt into the client bundle.
 *
 * Radix is not involved. A `<button>` already has the keyboard behaviour
 * (Enter and Space activate, Tab reaches it) and the ARIA semantics; a
 * primitive would only add a wrapper. TASK-0015 4장 uses Radix where the
 * accessibility is hard — focus traps, listbox navigation, positioning — not
 * where the platform already does it.
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'

import { cx } from '../lib/cx'
import { DISABLED_STYLES, FOCUS_RING } from '../lib/styles'

/** Exported as arrays so a story or a preview page can enumerate them. */
export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const
export type ButtonSize = (typeof BUTTON_SIZES)[number]

const VARIANT_STYLES: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-strong',
  secondary: 'bg-surface-muted text-fg hover:bg-border',
  outline: 'border-border-interactive bg-surface text-fg hover:bg-surface-muted border',
  ghost: 'text-fg hover:bg-surface-muted',
  danger: 'bg-danger text-danger-fg hover:bg-danger-strong',
}

/**
 * Heights come from `--spacing-control-*`, whose `max(--touch-min, …)` keeps
 * every size at 44px or more at every density step. That is why no size here
 * mentions a height in pixels.
 */
const SIZE_STYLES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-control-sm gap-1.5 px-3 text-sm',
  md: 'h-control-md gap-2 px-4 text-sm',
  lg: 'h-control-lg gap-2 px-6 text-base',
}

const BASE_STYLES = cx(
  'inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium transition-colors',
  FOCUS_RING,
  DISABLED_STYLES,
)

export interface ButtonStyleOptions {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly fullWidth?: boolean
}

/** The class list on its own, for the rare caller that has to style an `<a>` as a button. */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: ButtonStyleOptions = {}): string {
  return cx(BASE_STYLES, VARIANT_STYLES[variant], SIZE_STYLES[size], fullWidth && 'w-full')
}

export interface ButtonProps
  extends ButtonStyleOptions, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-disabled'> {
  /**
   * A request is in flight. Blocks activation (QUALITY-GATES U3) and announces
   * the wait.
   *
   * Implemented as `aria-disabled` plus a guarded handler rather than the native
   * `disabled` attribute, on purpose: a natively disabled element drops out of
   * the tab order, so the moment a submit button starts working the keyboard
   * user's focus is thrown to the top of the document and they are never told
   * what happened. `aria-disabled` keeps the button focusable and readable while
   * the guard below makes it inert — including for a `type="submit"` button,
   * whose default form submission is what `preventDefault` cancels.
   */
  readonly loading?: boolean
  readonly children?: ReactNode
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  className,
  children,
  onClick,
  type = 'button',
  disabled = false,
  ...props
}: ButtonProps) {
  const inert = loading || disabled

  return (
    <button
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cx(buttonClassName({ variant, size, fullWidth }), className)}
      data-loading={loading || undefined}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          // Cancels both the handler and, for a submit button, the form post.
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
      ) : null}
      {children}
    </button>
  )
}
