/**
 * A text link.
 *
 * A plain `<a>` with token styling. Client-side navigation belongs to the app —
 * `packages/ui` must not depend on `next/link`, or the package stops being
 * usable from Storybook (TASK-0104) and from anything that is not a Next app —
 * so `linkClassName()` is exported for the case where the app supplies its own
 * anchor component and only wants the styling.
 */

import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export const LINK_VARIANTS = ['default', 'subtle', 'standalone'] as const
export type LinkVariant = (typeof LINK_VARIANTS)[number]

const VARIANT_STYLES: Readonly<Record<LinkVariant, string>> = {
  default: 'text-primary hover:text-primary-strong underline underline-offset-2',
  subtle: 'text-fg-muted hover:text-fg underline underline-offset-2',
  standalone: 'text-primary hover:text-primary-strong font-medium no-underline hover:underline',
}

export function linkClassName(variant: LinkVariant = 'default'): string {
  return cx(
    'inline-flex items-center gap-1 rounded-xs transition-colors',
    FOCUS_RING,
    VARIANT_STYLES[variant],
  )
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly variant?: LinkVariant
  /**
   * Opens in a new tab. `rel` is set with it, because `target="_blank"` without
   * `noopener` hands the opened page a reference back to this one.
   */
  readonly external?: boolean
  /**
   * Announced after the link text when `external` is set — "(새 창)" or the
   * equivalent. Optional because the copy belongs to the app, and a link with no
   * warning is better than a link labelled in the wrong language.
   */
  readonly externalLabel?: string
  readonly children?: ReactNode
}

export function Link({
  variant,
  external = false,
  externalLabel,
  className,
  children,
  rel,
  target,
  ...props
}: LinkProps) {
  return (
    <a
      className={cx(linkClassName(variant), className)}
      rel={external ? (rel ?? 'noreferrer noopener') : rel}
      target={external ? (target ?? '_blank') : target}
      {...props}
    >
      {children}
      {external && externalLabel !== undefined ? (
        <span className="sr-only">{externalLabel}</span>
      ) : null}
    </a>
  )
}
