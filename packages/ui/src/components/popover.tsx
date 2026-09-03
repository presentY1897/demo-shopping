'use client'

/**
 * A panel anchored to a control.
 *
 * Unlike a tooltip it can hold focusable content, so it is a small non-modal
 * dialog: Radix moves focus into it on open, returns focus to the trigger on
 * close, closes on Escape and on an outside click, and computes a position that
 * flips and shifts away from the viewport edge. The page behind stays usable —
 * that is the difference from `Modal`.
 */

import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { RAISED_SURFACE } from '../lib/styles'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

export const POPOVER_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type PopoverSide = (typeof POPOVER_SIDES)[number]

export const POPOVER_ALIGNMENTS = ['start', 'center', 'end'] as const
export type PopoverAlign = (typeof POPOVER_ALIGNMENTS)[number]

/** Distance from the trigger, in px. A Radix layout prop, not a CSS length. */
const SIDE_OFFSET = 6

export interface PopoverProps {
  /** The control that opens the panel. Rendered as the trigger itself. */
  readonly trigger: ReactNode
  readonly children?: ReactNode
  readonly title?: ReactNode
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly side?: PopoverSide
  readonly align?: PopoverAlign
  /**
   * Accessible name of the × button. Omit it and no close button is drawn —
   * Escape and an outside click still close the panel.
   */
  readonly closeLabel?: string
  readonly className?: string
}

export function Popover({
  trigger,
  children,
  title,
  open,
  defaultOpen,
  onOpenChange,
  side = 'bottom',
  align = 'center',
  closeLabel,
  className,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          className={cx(
            RAISED_SURFACE,
            'z-50 flex w-full max-w-96 flex-col gap-2 rounded-lg p-4 text-sm shadow-lg outline-none',
            className,
          )}
          side={side}
          sideOffset={SIDE_OFFSET}
        >
          {title === undefined && closeLabel === undefined ? null : (
            <header className="flex items-start justify-between gap-2">
              {title === undefined ? (
                <span />
              ) : (
                <span className="text-base font-semibold">{title}</span>
              )}
              {closeLabel === undefined ? null : (
                <PopoverPrimitive.Close asChild>
                  <IconButton label={closeLabel} size="sm" variant="ghost">
                    <CloseIcon className="size-4" />
                  </IconButton>
                </PopoverPrimitive.Close>
              )}
            </header>
          )}
          {children}
          <PopoverPrimitive.Arrow className="fill-surface-raised" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
