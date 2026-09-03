'use client'

/**
 * A panel that slides in from an edge.
 *
 * The same Radix Dialog as `Modal` — same focus trap, same Escape handling, same
 * background inerting — positioned against one side instead of centred. Kept as
 * a separate component rather than a `Modal` variant because the two are
 * different answers to different questions: a modal interrupts, a drawer holds a
 * secondary surface (filters, a cart, a mobile menu) alongside the page.
 *
 * `Modal`'s `ModalClose` closes this too; both are the same primitive.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { OVERLAY_STYLES, RAISED_SURFACE } from '../lib/styles'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

export const DRAWER_SIDES = ['left', 'right', 'top', 'bottom'] as const
export type DrawerSide = (typeof DRAWER_SIDES)[number]

/**
 * The vertical sides are capped by width and the horizontal ones by height, both
 * in spacing multiples so the panel follows the density step. `max-w-full`
 * keeps a 480px drawer from overflowing a 360px phone.
 */
const SIDE_STYLES: Readonly<Record<DrawerSide, string>> = {
  left: 'inset-y-0 left-0 h-full w-full max-w-120 border-r',
  right: 'inset-y-0 right-0 h-full w-full max-w-120 border-l',
  top: 'inset-x-0 top-0 max-h-full w-full border-b',
  bottom: 'inset-x-0 bottom-0 max-h-full w-full border-t',
}

export interface DrawerProps {
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly trigger?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly children?: ReactNode
  readonly footer?: ReactNode
  /** Accessible name of the × button, from the app's catalog. */
  readonly closeLabel: string
  readonly side?: DrawerSide
  readonly dismissible?: boolean
  readonly className?: string
}

export function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  closeLabel,
  side = 'right',
  dismissible = true,
  className,
}: DrawerProps) {
  const block = dismissible
    ? undefined
    : (event: Event) => {
        event.preventDefault()
      }

  /** See `Modal` — the same acknowledgement of Radix's description warning. */
  const describedBy = description === undefined ? { 'aria-describedby': undefined } : {}

  return (
    <DialogPrimitive.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
      {trigger === undefined ? null : (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY_STYLES} />

        <DialogPrimitive.Content
          className={cx(
            RAISED_SURFACE,
            'fixed z-50 flex flex-col overflow-hidden shadow-overlay outline-none',
            SIDE_STYLES[side],
            className,
          )}
          onEscapeKeyDown={block}
          onInteractOutside={block}
          {...describedBy}
        >
          <header className="flex items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description === undefined ? null : (
                <DialogPrimitive.Description className="text-fg-muted text-sm">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} size="sm" variant="ghost">
                <CloseIcon className="size-4" />
              </IconButton>
            </DialogPrimitive.Close>
          </header>

          {children === undefined ? null : (
            <div className="text-fg flex-1 overflow-y-auto px-4 text-sm">{children}</div>
          )}

          {footer === undefined ? null : (
            <footer className="flex flex-wrap items-center justify-end gap-2 p-4">{footer}</footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
