'use client'

/**
 * Collapsible sections.
 *
 * Radix gives each header a real `<button>` inside a heading, wires
 * `aria-expanded` / `aria-controls`, and moves focus between headers with the
 * arrow keys — the part a `<details>` element does not do and a hand-rolled
 * version usually skips.
 *
 * `type` is a discriminated union rather than two booleans: with `'single'` the
 * value is one string, with `'multiple'` it is an array, and letting the
 * compiler enforce that is cheaper than validating it at runtime. `collapsible`
 * only exists for `'single'`, which is why it lives on that branch.
 */

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { ChevronDownIcon } from './icons'

export const ACCORDION_TYPES = ['single', 'multiple'] as const
export type AccordionType = (typeof ACCORDION_TYPES)[number]

export interface AccordionItemSpec {
  readonly value: string
  readonly title: ReactNode
  readonly content: ReactNode
  readonly disabled?: boolean
}

interface AccordionBaseProps {
  readonly items: readonly AccordionItemSpec[]
  readonly className?: string
}

interface SingleAccordionProps extends AccordionBaseProps {
  readonly type: 'single'
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  /** Allows the open section to be closed again, leaving none open. */
  readonly collapsible?: boolean
}

interface MultipleAccordionProps extends AccordionBaseProps {
  readonly type: 'multiple'
  readonly value?: readonly string[]
  readonly defaultValue?: readonly string[]
  readonly onValueChange?: (value: string[]) => void
}

export type AccordionProps = SingleAccordionProps | MultipleAccordionProps

function AccordionSections({ items }: { readonly items: readonly AccordionItemSpec[] }) {
  return (
    <>
      {items.map((item) => (
        <AccordionPrimitive.Item
          className="border-border border-b"
          key={item.value}
          value={item.value}
        >
          <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger
              className={cx(
                'text-fg min-h-touch group flex flex-1 items-center justify-between gap-2 py-2 text-left text-sm font-medium transition-colors',
                FOCUS_RING,
                'hover:text-primary disabled:cursor-not-allowed disabled:opacity-50',
              )}
              disabled={item.disabled}
            >
              {item.title}
              <ChevronDownIcon className="text-fg-subtle size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="text-fg-muted overflow-hidden pb-3 text-sm">
            {item.content}
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </>
  )
}

export function Accordion(props: AccordionProps) {
  const className = cx('border-border w-full border-t', props.className)

  // Two branches rather than one spread: Radix's own props are a discriminated
  // union, and narrowing it is what keeps `value` a string on one side and an
  // array on the other without a cast.
  if (props.type === 'multiple') {
    return (
      <AccordionPrimitive.Root
        className={className}
        defaultValue={props.defaultValue === undefined ? undefined : [...props.defaultValue]}
        onValueChange={props.onValueChange}
        type="multiple"
        value={props.value === undefined ? undefined : [...props.value]}
      >
        <AccordionSections items={props.items} />
      </AccordionPrimitive.Root>
    )
  }

  return (
    <AccordionPrimitive.Root
      className={className}
      collapsible={props.collapsible ?? true}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      type="single"
      value={props.value}
    >
      <AccordionSections items={props.items} />
    </AccordionPrimitive.Root>
  )
}
