'use client'

/**
 * A user or store image, with a text fallback.
 *
 * Radix is here for one reason: it tracks the image's load state and only swaps
 * in the fallback once loading has actually failed, so a slow avatar does not
 * flash initials and then replace them. Doing that by hand means an `onError`
 * handler, a piece of state and a client component anyway — the primitive is
 * the same cost with the edge cases already handled.
 *
 * `alt` is required. It is also where the default fallback comes from, so an
 * avatar cannot end up both unlabelled and blank.
 */

import * as AvatarPrimitive from '@radix-ui/react-avatar'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export const AVATAR_SIZES = ['sm', 'md', 'lg'] as const
export type AvatarSize = (typeof AVATAR_SIZES)[number]

const SIZE_STYLES: Readonly<Record<AvatarSize, string>> = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
}

export interface AvatarProps {
  readonly src?: string
  /** Describes the person or store. Never decorative — an avatar identifies someone. */
  readonly alt: string
  readonly size?: AvatarSize
  /** Overrides the initial derived from `alt`. */
  readonly fallback?: ReactNode
  readonly className?: string
}

/**
 * `Array.from` rather than `alt[0]`: a name may begin with an emoji or any other
 * character outside the BMP, and indexing a string would cut it in half.
 */
function initialOf(alt: string): string {
  return Array.from(alt.trim())[0] ?? ''
}

export function Avatar({ src, alt, size = 'md', fallback, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cx(
        'bg-surface-muted text-fg-muted relative inline-flex shrink-0 overflow-hidden rounded-full font-medium select-none',
        SIZE_STYLES[size],
        className,
      )}
    >
      <AvatarPrimitive.Image alt={alt} className="size-full object-cover" src={src} />
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center">
        {fallback ?? initialOf(alt)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
