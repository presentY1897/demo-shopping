'use client'

/**
 * A checkbox, with an optional label.
 *
 * Radix supplies the tri-state (`true | false | 'indeterminate'`), the hidden
 * native input that makes the control submit with a form, and the Space-key
 * handling on a non-`<input>` element.
 *
 * **The hit area and the drawn box are different sizes.** The visible square is
 * 20px because a 44px checkbox looks broken; the button around it carries
 * `touch-target`, so what the finger has to find is the 44px box the design
 * system promises at every density step (DECISIONS 1장). The label is tied with
 * `htmlFor`, which makes the text a second, much larger hit area.
 */

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { CheckIcon, MinusIcon } from './icons'

export type CheckboxState = boolean | 'indeterminate'

export interface CheckboxProps {
  readonly checked?: CheckboxState
  readonly defaultChecked?: CheckboxState
  readonly onCheckedChange?: (checked: CheckboxState) => void
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly required?: boolean
  readonly name?: string
  readonly value?: string
  readonly id?: string
  /** Rendered next to the box and tied to it. Omit it and pass `aria-label`. */
  readonly label?: ReactNode
  /** Secondary line under the label. */
  readonly description?: ReactNode
  readonly 'aria-label'?: string
  readonly 'aria-describedby'?: string
  readonly className?: string
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  invalid = false,
  required,
  name,
  value,
  id,
  label,
  description,
  className,
  ...aria
}: CheckboxProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <div className={cx('flex items-center gap-1', className)}>
      <CheckboxPrimitive.Root
        aria-invalid={invalid || undefined}
        checked={checked}
        className={cx(
          'touch-target group inline-flex shrink-0 items-center justify-center rounded-md',
          FOCUS_RING,
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={controlId}
        name={name}
        onCheckedChange={onCheckedChange}
        required={required}
        value={value}
        {...aria}
      >
        <span
          className={cx(
            'flex size-5 items-center justify-center rounded-sm border transition-colors',
            invalid ? 'border-danger' : 'border-border-interactive',
            'group-data-[state=checked]:bg-primary group-data-[state=checked]:border-primary',
            'group-data-[state=indeterminate]:bg-primary group-data-[state=indeterminate]:border-primary',
          )}
        >
          <CheckboxPrimitive.Indicator className="text-primary-fg flex items-center justify-center">
            {checked === 'indeterminate' ? (
              <MinusIcon className="size-4" />
            ) : (
              <CheckIcon className="size-4" />
            )}
          </CheckboxPrimitive.Indicator>
        </span>
      </CheckboxPrimitive.Root>

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
