'use client'

/**
 * A button that may be inert, and says why (TASK-0023).
 *
 * The rule it exists for: **an action the reader is not allowed to take is shown
 * disabled with a reason, not hidden.** Hiding it makes the product look like it
 * has fewer features than it does, which for a portfolio demo is the opposite of
 * what the screen is for; showing it greyed out with nothing to read makes the
 * reader think the app is broken.
 *
 * **Why not `disabled`.** A natively disabled button leaves the tab order, and a
 * control a keyboard user cannot reach is a control they are never told about —
 * neither that it exists nor why it will not work. So this uses `aria-disabled`
 * plus a guarded handler, exactly as {@link Button} already does for `loading`,
 * and the two look identical because `DISABLED_STYLES` covers both attributes.
 *
 * **Why the reason is in the DOM and not only in the tooltip.** A tooltip is not
 * a label (see `Tooltip`): it never appears on touch, and it is not read in
 * forms mode. The sentence therefore lives in a visually hidden element the
 * button points at with `aria-describedby`, and the tooltip is the sighted
 * reader's copy of the same words. It sits *beside* the button rather than
 * inside it so that it describes the control instead of renaming it.
 *
 * Nothing here knows what a permission is. `reason` is a sentence the app hands
 * over, like every other string in this package.
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { useId } from 'react'

import { cx } from '../lib/cx'
import type { ButtonStyleOptions } from './button'
import { Button, buttonClassName } from './button'
import { Tooltip } from './tooltip'
import type { TooltipSide } from './tooltip'

interface GuardedButtonBaseProps
  extends
    ButtonStyleOptions,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-disabled' | 'aria-describedby'> {
  readonly children?: ReactNode
  /** Where the hint opens. Only meaningful while blocked. */
  readonly reasonSide?: TooltipSide
}

/**
 * `reason` is required by the type whenever `blocked` is set.
 *
 * The same shape `ErrorState` uses for its retry pair, and for the same reason:
 * a blocked control with no sentence is the defect this component exists to
 * prevent, and a compile error catches it now rather than an axe run catching it
 * later.
 */
type BlockedProps =
  | { readonly blocked: true; readonly reason: string }
  | { readonly blocked?: false; readonly reason?: undefined }

export type GuardedButtonProps = GuardedButtonBaseProps & BlockedProps

export function GuardedButton({
  blocked = false,
  reason,
  reasonSide = 'top',
  variant,
  size,
  fullWidth,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: GuardedButtonProps) {
  const reasonId = useId()

  if (!blocked) {
    return (
      <Button
        className={className}
        fullWidth={fullWidth}
        onClick={onClick}
        size={size}
        type={type}
        variant={variant}
        {...props}
      >
        {children}
      </Button>
    )
  }

  return (
    <>
      <Tooltip content={reason} side={reasonSide}>
        <button
          aria-describedby={reasonId}
          aria-disabled="true"
          className={cx(buttonClassName({ fullWidth, size, variant }), className)}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            // Cancels both the handler and, for a submit button, the form post.
            event.preventDefault()
            event.stopPropagation()
          }}
          type={type}
          {...props}
        >
          {children}
        </button>
      </Tooltip>

      {/*
        A sibling, not a child: inside the button this text would join the
        accessible name and the control would announce as "삭제 이 역할은…"
        instead of "삭제, 이 역할은…" as a description.
      */}
      <span className="sr-only" id={reasonId}>
        {reason}
      </span>
    </>
  )
}
