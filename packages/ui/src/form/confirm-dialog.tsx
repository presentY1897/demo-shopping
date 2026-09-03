'use client'

/**
 * The confirmation step in front of a destructive action (TASK-0017 4.7).
 *
 * Built on `Modal`, so the focus trap, the Escape handling, the background
 * inertness and the `aria-labelledby` wiring are Radix's and are not
 * reimplemented here. What this adds is the *convention*:
 *
 * - the dialog is dismissible. A confirmation that swallows Escape is a
 *   keyboard trap, and cancelling has to be at least as easy as confirming;
 * - initial focus is not on the confirm button. Radix puts it on the close
 *   control in the header, so a stray Enter dismisses rather than destroys;
 * - the confirm button is `danger` when the action is destructive, and it uses
 *   `Button.loading` while the work runs, so a second Enter cannot fire it;
 * - every string is a prop. The dialog has no idea what it is asking.
 *
 * `useConfirm` turns the whole thing into one `await`: the destructive function
 * is never reached unless the person said yes, which is the shape TASK-0017 F6
 * asks for ("확인 없이는 실행되지 않음").
 */

import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '../components/button'
import type { ModalSize } from '../components/modal'
import { Modal, ModalClose } from '../components/modal'

export interface ConfirmDialogProps {
  /** Controlled open state. Leave it out to let the dialog manage its own. */
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly trigger?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Extra detail — what exactly is about to be deleted. */
  readonly children?: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel: string
  /** Accessible name of the × button. */
  readonly closeLabel: string
  /**
   * Runs only after the person confirms.
   *
   * Rejecting leaves the dialog open and reports nothing — showing the failure
   * is this function's own job, because it is the side that has the copy.
   */
  readonly onConfirm: () => void | Promise<void>
  /** Irreversible — paints the confirm button as `danger`. */
  readonly destructive?: boolean
  readonly size?: ModalSize
}

export function ConfirmDialog({
  open,
  defaultOpen = false,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  destructive = false,
  size = 'sm',
}: ConfirmDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [pending, setPending] = useState(false)

  /** Same reason as `useForm`'s: state is not visible to a second event in the same tick. */
  const busy = useRef(false)

  const isOpen = open ?? uncontrolledOpen

  const setOpen = useCallback(
    (next: boolean): void => {
      if (open === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, open],
  )

  const confirm = useCallback((): void => {
    if (busy.current) return
    busy.current = true
    setPending(true)

    void (async () => {
      try {
        await onConfirm()
        setOpen(false)
      } catch {
        // The dialog stays open so the person can try again or back out, and
        // it says nothing about what went wrong: it holds no copy, and the
        // failure belongs to the action. `onConfirm` is where the toast or the
        // form level message goes — it is the caller's own function and the
        // only side that knows what the failure means.
      } finally {
        busy.current = false
        setPending(false)
      }
    })()
  }, [onConfirm, setOpen])

  return (
    <Modal
      closeLabel={closeLabel}
      description={description}
      footer={
        <>
          <ModalClose>
            <Button variant="outline">{cancelLabel}</Button>
          </ModalClose>
          <Button loading={pending} onClick={confirm} variant={destructive ? 'danger' : 'primary'}>
            {confirmLabel}
          </Button>
        </>
      }
      onOpenChange={setOpen}
      open={isOpen}
      size={size}
      title={title}
      trigger={trigger}
    >
      {children}
    </Modal>
  )
}

export interface ConfirmGate {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Opens the dialog and resolves with the answer. */
  readonly request: () => Promise<boolean>
  /** Pass as the dialog's `onConfirm`. */
  readonly confirm: () => void
}

/**
 * A confirmation as a promise.
 *
 * ```ts
 * const gate = useConfirm()
 * async function remove() {
 *   if (!(await gate.request())) return
 *   await deleteCategory(id)
 * }
 * ```
 *
 * Any close that is not a confirmation — Escape, the × button, the cancel
 * button, an outside click — resolves `false`, so the caller has exactly one
 * branch and no way to fall through into the destructive call.
 */
export function useConfirm(): ConfirmGate {
  const [open, setOpen] = useState(false)
  const answer = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = useCallback((confirmed: boolean): void => {
    const resolve = answer.current
    answer.current = null
    setOpen(false)
    resolve?.(confirmed)
  }, [])

  const request = useCallback(
    (): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A question that is still waiting when a second one is asked is
        // answered "no": leaving it pending would leak the promise for ever.
        answer.current?.(false)
        answer.current = resolve
        setOpen(true)
      }),
    [],
  )

  const onOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        setOpen(true)
        return
      }
      settle(false)
    },
    [settle],
  )

  const confirm = useCallback((): void => {
    settle(true)
  }, [settle])

  return { confirm, onOpenChange, open, request }
}
