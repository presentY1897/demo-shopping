'use client'

/**
 * A centred dialog.
 *
 * **This is the clearest case for Radix in the whole package.** A correct modal
 * has to trap Tab and Shift+Tab inside itself and wrap at both ends, move focus
 * in on open and back to the trigger on close, close on Escape, hide the rest of
 * the page from assistive technology, lock the background scroll without the
 * page shifting as the scrollbar disappears, and wire `aria-labelledby` /
 * `aria-describedby` to the right nodes. Every one of those is a bug people
 * actually ship. Radix does all of it; the styling below is entirely ours
 * (TASK-0015 4장, D-056).
 *
 * `title` is required: `Dialog.Title` is what gives the dialog its accessible
 * name, and a nameless dialog is announced as nothing at all.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { OVERLAY_STYLES, RAISED_SURFACE } from '../lib/styles'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

export const MODAL_SIZES = ['sm', 'md', 'lg'] as const
export type ModalSize = (typeof MODAL_SIZES)[number]

/**
 * Widths are spacing multiples, so a modal is narrower at the maximal density
 * step in the same proportion as everything around it. A `max-w-md` from
 * Tailwind's container scale would be the one fixed measurement on the screen.
 */
const SIZE_STYLES: Readonly<Record<ModalSize, string>> = {
  sm: 'max-w-96',
  md: 'max-w-120',
  lg: 'max-w-160',
}

export interface ModalProps {
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** Wrapped in `Dialog.Trigger`; omit it for a modal opened from application state. */
  readonly trigger?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly children?: ReactNode
  /** Action row at the bottom. Wrap a confirm button in `ModalClose` to dismiss. */
  readonly footer?: ReactNode
  /** Accessible name of the × button, from the app's catalog. */
  readonly closeLabel: string
  readonly size?: ModalSize
  /**
   * Escape and an outside click close the dialog. Turn it off for a step the
   * user must answer — never as a default, because a dialog that ignores Escape
   * is a keyboard trap.
   */
  readonly dismissible?: boolean
  readonly className?: string
}

/** Closes the nearest modal or drawer. Wraps its child, so pass a `Button`. */
export function ModalClose({ children }: { readonly children: ReactNode }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>
}

export function Modal({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  closeLabel,
  size = 'md',
  dismissible = true,
  className,
}: ModalProps) {
  const block = dismissible
    ? undefined
    : (event: Event) => {
        event.preventDefault()
      }

  /**
   * With no `Dialog.Description` rendered, Radix warns in development that the
   * dialog is undescribed. Passing the attribute explicitly as `undefined` is
   * the documented acknowledgement: it removes the attribute Radix would
   * otherwise point at an element that does not exist.
   */
  const describedBy = description === undefined ? { 'aria-describedby': undefined } : {}

  return (
    <DialogPrimitive.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
      {trigger === undefined ? null : (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY_STYLES} />

        {/*
          A flex box over the whole viewport rather than a `top-1/2` translate:
          centring this way keeps `max-h-full` meaningful, so a long dialog
          scrolls its own body instead of running off the top of the screen on a
          short window. `pointer-events-none` lets a click in the padding reach
          the overlay underneath, which is what dismisses the dialog.
        */}
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Content
            className={cx(
              RAISED_SURFACE,
              'pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-lg shadow-overlay outline-none',
              SIZE_STYLES[size],
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
              <footer className="flex flex-wrap items-center justify-end gap-2 p-4">
                {footer}
              </footer>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
