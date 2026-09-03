'use client'

/**
 * A group of mutually exclusive choices.
 *
 * Radix implements the roving tab index: the group is *one* tab stop, and the
 * arrow keys move between options — which is what WAI-ARIA specifies for a radio
 * group and what a hand-written version invariably gets wrong by leaving every
 * radio in the tab order.
 *
 * `Radio` must be rendered inside `RadioGroup`; it reads the group's context.
 */

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export const RADIO_ORIENTATIONS = ['vertical', 'horizontal'] as const
export type RadioOrientation = (typeof RADIO_ORIENTATIONS)[number]

export interface RadioGroupProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  readonly orientation?: RadioOrientation
  readonly disabled?: boolean
  readonly required?: boolean
  readonly name?: string
  readonly id?: string
  /**
   * Renders the error treatment and sets `aria-invalid` on the group.
   *
   * On the group rather than on each `Radio`: the answer is invalid, not one
   * of the options, and it is the group that a form's error message describes.
   */
  readonly invalid?: boolean
  readonly 'aria-label'?: string
  readonly 'aria-labelledby'?: string
  readonly 'aria-describedby'?: string
  readonly className?: string
  readonly children?: ReactNode
}

export function RadioGroup({
  value,
  defaultValue,
  onValueChange,
  orientation = 'vertical',
  disabled = false,
  required,
  name,
  id,
  invalid = false,
  className,
  children,
  ...aria
}: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-invalid={invalid || undefined}
      className={cx(
        'flex gap-2',
        orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap items-center',
        className,
      )}
      data-invalid={invalid || undefined}
      defaultValue={defaultValue}
      disabled={disabled}
      id={id}
      name={name}
      onValueChange={onValueChange}
      orientation={orientation}
      required={required}
      value={value}
      {...aria}
    >
      {children}
    </RadioGroupPrimitive.Root>
  )
}

export interface RadioProps {
  readonly value: string
  readonly disabled?: boolean
  readonly id?: string
  readonly label?: ReactNode
  readonly description?: ReactNode
  readonly 'aria-label'?: string
  readonly className?: string
}

export function Radio({
  value,
  disabled = false,
  id,
  label,
  description,
  className,
  ...aria
}: RadioProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <div className={cx('flex items-center gap-1', className)}>
      <RadioGroupPrimitive.Item
        className={cx(
          'touch-target group inline-flex shrink-0 items-center justify-center rounded-md',
          FOCUS_RING,
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        disabled={disabled}
        id={controlId}
        value={value}
        {...aria}
      >
        <span className="border-border-interactive group-data-[state=checked]:border-primary flex size-5 items-center justify-center rounded-full border transition-colors">
          <RadioGroupPrimitive.Indicator className="bg-primary size-2.5 rounded-full" />
        </span>
      </RadioGroupPrimitive.Item>

      {label === undefined ? null : (
        <label
          className={cx(
            'text-fg flex cursor-pointer flex-col text-sm',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          htmlFor={controlId}
        >
          <span>{label}</span>
          {description === undefined ? null : (
            <span className="text-fg-subtle text-xs">{description}</span>
          )}
        </label>
      )}
    </div>
  )
}
