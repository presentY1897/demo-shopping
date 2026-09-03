'use client'

/**
 * A short hint attached to a control.
 *
 * Radix handles the parts that make a tooltip accessible rather than decorative:
 * it opens on keyboard focus as well as hover, closes on Escape, keeps one
 * global "a tooltip was just open" timer so moving along a toolbar does not
 * re-wait, and positions the bubble against the viewport edge.
 *
 * **A tooltip is not a label.** It disappears, it never appears on touch, and it
 * is not read in forms mode by every screen reader. Anything the user must have
 * belongs in the control's accessible name — which is why `IconButton` takes a
 * required `label` instead of relying on this.
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export const TOOLTIP_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type TooltipSide = (typeof TOOLTIP_SIDES)[number]

/** Distance from the trigger, in px. A Radix layout prop, not a CSS length. */
const SIDE_OFFSET = 6

/**
 * Optional. Wrap a screen (or a whole app) in it and the tooltips inside share
 * one delay timer, so the second hint in a toolbar opens instantly. A `Tooltip`
 * used on its own provides its own provider and works without this.
 */
export function TooltipProvider({
  children,
  delayDuration = 300,
  skipDelayDuration = 300,
}: {
  readonly children: ReactNode
  readonly delayDuration?: number
  readonly skipDelayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export interface TooltipProps {
  /** The control the hint belongs to. Rendered as the trigger itself, not wrapped. */
  readonly children: ReactNode
  readonly content: ReactNode
  readonly side?: TooltipSide
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly delayDuration?: number
  readonly className?: string
}

export function Tooltip({
  children,
  content,
  side = 'top',
  open,
  defaultOpen,
  onOpenChange,
  delayDuration = 300,
  className,
}: TooltipProps) {
  return (
    // Nesting a provider is legal in Radix and the inner one wins, so a tooltip
    // is self-contained by default and still joins a shared timer when an app
    // wraps a screen in `TooltipProvider`.
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={cx(
              'bg-surface-inverse text-fg-inverse z-50 max-w-96 rounded-md px-2 py-1 text-xs shadow-md',
              className,
            )}
            side={side}
            sideOffset={SIDE_OFFSET}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-surface-inverse" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
