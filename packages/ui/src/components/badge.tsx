/**
 * A non-interactive status label — 판매중, 배송완료, 정산대기.
 *
 * Radix has no equivalent and does not need one (TASK-0015 R1): this is a
 * `<span>` with a colour role. Server-renderable.
 *
 * The variants map onto the semantic status tokens, so "success" is the same
 * green everywhere it appears and a redesign is a token edit.
 */

import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export const BADGE_VARIANTS = ['neutral', 'primary', 'success', 'warning', 'danger'] as const
export type BadgeVariant = (typeof BADGE_VARIANTS)[number]

export const BADGE_SIZES = ['sm', 'md'] as const
export type BadgeSize = (typeof BADGE_SIZES)[number]

/**
 * Text is `--color-fg` on the tinted surfaces rather than the accent colour on
 * white: `color-tokens.spec.ts` holds every one of those pairs at 4.5:1, and an
 * accent-on-tint pair would be the one combination nothing checks.
 */
const VARIANT_STYLES: Readonly<Record<BadgeVariant, string>> = {
  neutral: 'bg-surface-muted text-fg-muted',
  primary: 'bg-primary-surface text-fg',
  success: 'bg-success-surface text-fg',
  warning: 'bg-warning-surface text-fg',
  danger: 'bg-danger-surface text-fg',
}

const SIZE_STYLES: Readonly<Record<BadgeSize, string>> = {
  sm: 'px-1.5 py-0.5 text-2xs',
  md: 'px-2 py-0.5 text-xs',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: BadgeVariant
  readonly size?: BadgeSize
  readonly children?: ReactNode
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
