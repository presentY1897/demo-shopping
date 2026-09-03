'use client'

/**
 * Transient notifications.
 *
 * Radix owns the hard parts: the live region that announces a toast without
 * stealing focus, the F6 hotkey that lets a keyboard user jump to the toast
 * list and back, pausing the dismiss timer while the pointer is over a toast or
 * the window is blurred, and swipe-to-dismiss. Our part is the queue, the
 * styling and the imperative API.
 *
 * The API is a hook rather than a rendered component because the caller is
 * usually an event handler ("주문이 취소되었습니다" after a mutation resolves),
 * and threading a boolean through state to render a `<Toast>` is how a
 * notification ends up firing twice on a re-render.
 *
 * Both labels are required props. `packages/ui` cannot see an app's message
 * catalog, and an aria-label is user-facing text like any other — a default of
 * "Notification" would be an English string shipped to a Korean screen reader.
 */

import * as ToastPrimitive from '@radix-ui/react-toast'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { cx } from '../lib/cx'
import { RAISED_SURFACE } from '../lib/styles'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

export const TOAST_VARIANTS = ['neutral', 'success', 'warning', 'danger'] as const
export type ToastVariant = (typeof TOAST_VARIANTS)[number]

/**
 * The accent is a left edge rather than a filled background: a toast covers the
 * page, and four saturated panels would read as four different surfaces. The
 * text stays `--color-fg` on `--color-surface-raised`, a pair the contrast test
 * already holds at AA.
 */
const VARIANT_STYLES: Readonly<Record<ToastVariant, string>> = {
  neutral: 'border-l-border-strong',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
}

export interface ToastOptions {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly variant?: ToastVariant
  /** Milliseconds. `Infinity` keeps the toast until it is dismissed. */
  readonly duration?: number
}

interface ToastRecord extends ToastOptions {
  readonly id: string
}

export interface ToastContextValue {
  /** Queues a toast and returns its id, so it can be dismissed early. */
  readonly toast: (options: ToastOptions) => string
  readonly dismiss: (id: string) => void
  readonly dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export interface ToastProviderProps {
  readonly children: ReactNode
  /** Accessible name of each toast's × button. */
  readonly closeLabel: string
  /** Announced with every toast — "알림" or the equivalent. */
  readonly regionLabel: string
  /** Default dismiss delay in milliseconds; a toast may override it. */
  readonly duration?: number
  readonly className?: string
}

export function ToastProvider({
  children,
  closeLabel,
  regionLabel,
  duration = 5000,
  className,
}: ToastProviderProps) {
  const [records, setRecords] = useState<readonly ToastRecord[]>([])

  // A counter rather than a random id: the value only has to be unique within
  // this provider, and a deterministic one keeps a server render and the first
  // client render identical.
  const nextId = useRef(0)

  const dismiss = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id))
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (options: ToastOptions) => {
        nextId.current += 1
        const id = `toast-${String(nextId.current)}`
        setRecords((current) => [...current, { ...options, id }])
        return id
      },
      dismiss,
      dismissAll: () => {
        setRecords([])
      },
    }),
    [dismiss],
  )

  return (
    <ToastPrimitive.Provider duration={duration} label={regionLabel} swipeDirection="right">
      <ToastContext value={value}>{children}</ToastContext>

      {records.map((record) => (
        <ToastPrimitive.Root
          className={cx(
            RAISED_SURFACE,
            'flex items-start gap-3 rounded-md border-l-4 p-3 shadow-lg',
            VARIANT_STYLES[record.variant ?? 'neutral'],
          )}
          duration={record.duration}
          key={record.id}
          onOpenChange={(open) => {
            // Radix drives this on a timeout, a swipe and the close button
            // alike, so removal has one path regardless of how it was dismissed.
            if (!open) dismiss(record.id)
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <ToastPrimitive.Title className="text-fg text-sm font-semibold">
              {record.title}
            </ToastPrimitive.Title>
            {record.description === undefined ? null : (
              <ToastPrimitive.Description className="text-fg-muted text-sm">
                {record.description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close asChild>
            <IconButton label={closeLabel} size="sm" variant="ghost">
              <CloseIcon className="size-4" />
            </IconButton>
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}

      <ToastPrimitive.Viewport
        className={cx(
          'fixed right-0 bottom-0 z-50 m-0 flex w-full max-w-100 list-none flex-col gap-2 p-4 outline-none',
          className,
        )}
      />
    </ToastPrimitive.Provider>
  )
}

/**
 * Throws outside a provider rather than returning a no-op: a notification that
 * silently never appears is far harder to notice than one that fails the first
 * time it is called.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (value === null) {
    throw new Error('useToast() must be called inside <ToastProvider>.')
  }
  return value
}
