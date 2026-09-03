'use client'

/**
 * A single-choice select.
 *
 * **Radix owns the behaviour.** A native `<select>` cannot be styled to match
 * the token system on every platform, and a hand-rolled listbox has to
 * reimplement roving focus, type-ahead, Home/End, PageUp/PageDown, typeahead
 * reset timing, the collision-aware popup position and the `aria-activedescendant`
 * bookkeeping — the exact list TASK-0015 4장 names as the reason the primitive
 * is worth a dependency. Everything visual below is ours.
 *
 * The options are a flat array rather than `<Select.Item>` children on purpose:
 * a story or a preview page can enumerate the states of an array prop
 * (TASK-0104), and cannot enumerate a `children` slot.
 */

import * as SelectPrimitive from '@radix-ui/react-select'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { RAISED_SURFACE } from '../lib/styles'
import { CheckIcon, ChevronDownIcon } from './icons'
import { FIELD_STYLES, fieldBorderClassName, type InputSize } from './input'

export const SELECT_SIZES = ['sm', 'md', 'lg'] as const

const SIZE_STYLES: Readonly<Record<InputSize, string>> = {
  sm: 'h-control-sm px-3 text-sm',
  md: 'h-control-md px-3 text-base',
  lg: 'h-control-lg px-4 text-base',
}

export interface SelectOption {
  readonly value: string
  readonly label: ReactNode
  readonly disabled?: boolean
}

export interface SelectProps {
  readonly options: readonly SelectOption[]
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  /** Shown until a choice is made. Comes from the app's catalog. */
  readonly placeholder?: string
  readonly size?: InputSize
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly required?: boolean
  /** Submitted with the surrounding form; Radix renders a hidden native input. */
  readonly name?: string
  readonly id?: string
  readonly 'aria-label'?: string
  readonly 'aria-labelledby'?: string
  readonly 'aria-describedby'?: string
  readonly className?: string
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  size = 'md',
  disabled = false,
  invalid = false,
  required,
  name,
  id,
  className,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      defaultValue={defaultValue}
      disabled={disabled}
      name={name}
      onValueChange={onValueChange}
      required={required}
      value={value}
    >
      <SelectPrimitive.Trigger
        aria-invalid={invalid || undefined}
        className={cx(
          FIELD_STYLES,
          fieldBorderClassName(invalid),
          SIZE_STYLES[size],
          'flex items-center justify-between gap-2 text-left',
          'data-[placeholder]:text-fg-subtle',
          className,
        )}
        data-invalid={invalid || undefined}
        id={id}
        {...aria}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon className="text-fg-subtle size-4 shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cx(
            RAISED_SURFACE,
            'z-50 overflow-hidden rounded-md shadow-lg',
            // Radix publishes both as custom properties on the content element;
            // reading them keeps the popup the width of its trigger and stops it
            // running off the bottom of a short viewport.
            'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width)',
          )}
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                className={cx(
                  'text-fg min-h-touch relative flex w-full cursor-default items-center gap-2 rounded-sm py-2 pr-2 pl-8 text-sm outline-none select-none',
                  'data-highlighted:bg-primary-surface data-highlighted:text-fg',
                  'data-disabled:pointer-events-none data-disabled:opacity-50',
                )}
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <CheckIcon className="text-primary size-4" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
