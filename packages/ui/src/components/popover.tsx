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
import { useId } from 'react'

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

interface PopoverBaseProps {
  /** The control that opens the panel. Rendered as the trigger itself. */
  readonly trigger: ReactNode
  readonly children?: ReactNode
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

/**
 * The panel is a `role="dialog"`, and a dialog with no accessible name is
 * announced as nothing at all. The name comes from the heading when there is
 * one; when there is not, it has to be supplied. The two are a union rather than
 * two optional props so that the compiler asks for a name instead of a reviewer
 * noticing it is missing — the same trade `Tag` makes for its remove button.
 *
 * TASK-0104 is where this was found. The story sweep in
 * `test/story-a11y.spec.tsx` failed `aria-dialog-name` on a popover rendered
 * without a title: a defect this package had already shipped, and one nothing in
 * the repository would otherwise have caught.
 */
interface TitledPopoverProps extends PopoverBaseProps {
  readonly title: ReactNode
  readonly 'aria-label'?: string
}

interface LabelledPopoverProps extends PopoverBaseProps {
  readonly title?: undefined
  readonly 'aria-label': string
}

export type PopoverProps = TitledPopoverProps | LabelledPopoverProps

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
  ...aria
}: PopoverProps) {
  const titleId = useId()

  return (
    <PopoverPrimitive.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          aria-label={aria['aria-label']}
          aria-labelledby={title === undefined ? undefined : titleId}
          className={cx(
            RAISED_SURFACE,
            'z-50 flex w-full max-w-96 flex-col gap-2 rounded-lg p-4 text-sm shadow-lg outline-none',
            className,
          )}
          side={side}
          sideOffset={SIDE_OFFSET}
        >
          {title === undefined && closeLabel === undefined ? null : (
            // A `div`, not a `<header>`. The panel is portalled straight into
            // `<body>` and is *not* modal, so nothing hides the page behind it
            // — and a `<header>` that is not inside `article`/`aside`/`main`/
            // `nav`/`section` is a `banner` landmark. Beside an app that has a
            // real one, opening a popover produced two banners
            // (`landmark-no-duplicate-banner`). Found by the console shell's
            // axe run in TASK-0019; `Modal` and `Drawer` are unaffected because
            // Radix hides the rest of the page while they are open.
            <div className="flex items-start justify-between gap-2">
              {title === undefined ? (
                <span />
              ) : (
                <span className="text-base font-semibold" id={titleId}>
                  {title}
                </span>
              )}
              {closeLabel === undefined ? null : (
                <PopoverPrimitive.Close asChild>
                  <IconButton label={closeLabel} size="sm" variant="ghost">
                    <CloseIcon className="size-4" />
                  </IconButton>
                </PopoverPrimitive.Close>
              )}
            </div>
          )}
          {children}
          <PopoverPrimitive.Arrow className="fill-surface-raised" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
