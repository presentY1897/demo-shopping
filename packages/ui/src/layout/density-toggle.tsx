'use client'

/**
 * The control the whole density system exists for.
 *
 * The tokens, the boot script and the external store all landed in TASK-0014,
 * and until now nothing on screen let a shopper actually change the value —
 * which made the headline feature of this storefront (DECISIONS 1장: 상품 표현
 * 3단계를 **사용자가 토글**) reachable only from devtools.
 *
 * **It is a radio group, not three buttons.** Picking one of three mutually
 * exclusive values is what a radio group is, and Radix's implementation brings
 * the part hand-written toggles always get wrong: the group is a single tab
 * stop and the arrow keys move between the steps, so putting this in the header
 * costs the keyboard user one stop rather than three (WAI-ARIA radio pattern).
 * Screen readers announce "2 of 3, selected" without this file arranging it.
 *
 * **No Korean here.** `packages/ui` cannot see an app's catalog, so every string
 * arrives as a prop — and `labels` is required, because the icon-only form has
 * no other accessible name.
 */

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import type { ComponentType } from 'react'

import { Tooltip } from '../components/tooltip'
import { DENSITY_LEVELS, parseDensityLevel, type DensityLevel } from '../density/density'
import { useDensity } from '../density/density-context'
import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { DensityMaximalIcon, DensityMinimalIcon, DensityStandardIcon } from './density-icons'

const ICONS: Readonly<Record<DensityLevel, ComponentType<{ readonly className?: string }>>> = {
  1: DensityMinimalIcon,
  2: DensityStandardIcon,
  3: DensityMaximalIcon,
}

export interface DensityToggleProps {
  /**
   * Names the group for assistive technology — "표시 밀도". Rendered visibly
   * only when `legendHidden` is false.
   */
  readonly legend: string
  /** One label per step. Becomes the accessible name of each option. */
  readonly labels: Readonly<Record<DensityLevel, string>>
  /**
   * Show the labels beside the icons.
   *
   * The header form is icon-only with a tooltip — the design brief asks for a
   * control that does not shout on a minimal storefront. The popover and the
   * settings form show the words, because there the space exists and a label a
   * touch device can never hover is not a label.
   */
  readonly showLabels?: boolean
  readonly legendHidden?: boolean
  readonly className?: string
}

export function DensityToggle({
  legend,
  labels,
  showLabels = false,
  legendHidden = true,
  className,
}: DensityToggleProps) {
  const { density, setDensity } = useDensity()

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span className={legendHidden ? 'sr-only' : 'text-fg-muted text-sm'} id={LEGEND_ID}>
        {legend}
      </span>

      <RadioGroupPrimitive.Root
        aria-labelledby={LEGEND_ID}
        className={cx(
          'bg-surface-muted inline-flex rounded-md p-1',
          showLabels ? 'flex-col gap-1' : 'flex-row gap-1',
        )}
        onValueChange={(value) => {
          const level = parseDensityLevel(value)
          // `null` cannot happen — the only values in the group are the three
          // steps — but the parser is the one place that decides what a density
          // is, and reaching for a cast here would be the first exception to it.
          if (level !== null) setDensity(level)
        }}
        orientation={showLabels ? 'vertical' : 'horizontal'}
        value={String(density)}
      >
        {DENSITY_LEVELS.map((level) => {
          const StepIcon = ICONS[level]

          const item = (
            <RadioGroupPrimitive.Item
              onFocus={(event) => {
                // **Arrow keys have to select, not just move.** That is the
                // WAI-ARIA radio pattern, and Radix implements it by clicking
                // the item its own focus handler receives — but that handler
                // reads a flag set by a listener on `document`, and with React
                // 19's root attached to the document the roving focus has
                // already moved before the flag is set. Measured in Chromium,
                // not assumed: the arrow moved the focus and left the value
                // behind (TASK-0018 6.1 F4).
                //
                // `:focus-visible` is what tells the two cases apart. A pointer
                // press does not match it — the click that follows selects on
                // its own — and tabbing in lands on the item that is already
                // checked, so selecting it again is a no-op.
                if (focusedFromKeyboard(event.currentTarget)) setDensity(level)
              }}
              // Icon-only, so the label has to come through ARIA; with the text
              // rendered, the text *is* the name and a second one would win over
              // it and hide the visible word from voice control.
              aria-label={showLabels ? undefined : labels[level]}
              className={cx(
                'min-h-touch text-fg-muted inline-flex shrink-0 items-center gap-2 rounded-sm transition-colors',
                showLabels ? 'w-full justify-start px-3' : 'touch-target justify-center px-3',
                'hover:text-fg',
                // The selected step reads as a raised chip on the group's
                // sunken track, which is how a segmented control says "this one"
                // without relying on colour alone at a glance.
                'data-[state=checked]:bg-surface-raised data-[state=checked]:text-fg data-[state=checked]:shadow-xs',
                FOCUS_RING,
              )}
              key={level}
              value={String(level)}
            >
              <StepIcon className="size-4 shrink-0" />
              {showLabels ? <span className="text-sm">{labels[level]}</span> : null}
            </RadioGroupPrimitive.Item>
          )

          // A tooltip is not a label (see `Tooltip`), which is why the item
          // already carries `aria-label`. This is the sighted-mouse half of the
          // same information, and it is pointless once the word is on screen.
          return showLabels ? (
            item
          ) : (
            <Tooltip content={labels[level]} key={level}>
              {item}
            </Tooltip>
          )
        })}
      </RadioGroupPrimitive.Root>
    </div>
  )
}

/**
 * Constant rather than `useId`: two density toggles are mounted at once only in
 * a story that deliberately compares them, and a duplicate id there is not worth
 * a hook in every header.
 */
const LEGEND_ID = 'density-toggle-legend'

/**
 * Whether this element is showing a focus ring — i.e. focus arrived from the
 * keyboard rather than from a press.
 *
 * jsdom does not implement the selector and throws on it; `false` there is the
 * honest answer, and the keyboard path is covered in a real browser instead.
 */
function focusedFromKeyboard(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return false
  }
}
