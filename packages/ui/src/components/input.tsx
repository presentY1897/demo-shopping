/**
 * A single-line text field.
 *
 * Server-renderable: a plain `<input>` needs no hook and no browser API.
 *
 * The native `size` attribute (a character count) is dropped so that `size` can
 * mean what it means on every other component here. Nobody has ever wanted the
 * native one, and two meanings for one prop name is worse than losing it.
 */

import type { InputHTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export const INPUT_SIZES = ['sm', 'md', 'lg'] as const
export type InputSize = (typeof INPUT_SIZES)[number]

const SIZE_STYLES: Readonly<Record<InputSize, string>> = {
  sm: 'h-control-sm px-3 text-sm',
  md: 'h-control-md px-3 text-base',
  lg: 'h-control-lg px-4 text-base',
}

/**
 * Shared by `Input`, `Textarea` and the `Select` trigger so the three line up
 * when they sit in the same form row.
 */
export const FIELD_STYLES = cx(
  'bg-surface text-fg placeholder:text-fg-subtle w-full rounded-md border transition-colors',
  FOCUS_RING,
  'disabled:bg-surface-muted disabled:text-fg-subtle disabled:cursor-not-allowed',
)

/**
 * The border carries the error, and `aria-invalid` carries it to a screen
 * reader. Colour alone would fail WCAG 1.4.1; the message itself is TASK-0017's
 * job, and this is the hook it will attach to.
 */
export function fieldBorderClassName(invalid: boolean): string {
  return invalid
    ? 'border-danger focus-visible:outline-danger'
    : 'border-border-interactive hover:border-fg-subtle'
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  readonly size?: InputSize
  /** Renders the error treatment and sets `aria-invalid`. */
  readonly invalid?: boolean
}

export function Input({ size = 'md', invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(FIELD_STYLES, fieldBorderClassName(invalid), SIZE_STYLES[size], className)}
      data-invalid={invalid || undefined}
      {...props}
    />
  )
}
