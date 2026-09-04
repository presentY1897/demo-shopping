'use client'

import { Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { CategoryChoice } from '@/lib/attributes/categories'
import type { AttributeMessages } from '@/messages'

interface AttributeCategoryPickerProps {
  readonly choices: readonly CategoryChoice[]
  readonly value: number | null
  readonly messages: AttributeMessages
  readonly onChange: (categoryId: number) => void
}

/**
 * Which category's definitions are being looked at.
 *
 * A `Select` and not a tree (TASK-0031 4.1). The category is a filter here, not
 * the thing being edited, so TASK-0029's tree would bring forty tab stops and
 * five operations none of which this screen can perform. The structure it would
 * have shown is carried by the label instead: `여성 › 아우터 › 코트`.
 *
 * Retired categories stay in the list, marked. Definitions attached to one are
 * still live and still inherited downwards, so leaving them out would make them
 * uneditable and invisible at the same time.
 */
export function AttributeCategoryPicker({
  choices,
  value,
  messages,
  onChange,
}: AttributeCategoryPickerProps) {
  const labelId = useId()

  // Nothing to offer yet — either the tree is still arriving or the catalogue is
  // empty. Mounting the control now would also make it uncontrolled for one
  // render and controlled for the next, which React rightly complains about.
  if (choices.length === 0) return null

  const options = choices.map((choice) => ({
    value: String(choice.id),
    label:
      choice.path.join(messages.categorySeparator) +
      (choice.isActive ? '' : messages.categoryInactiveSuffix),
  }))

  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-muted text-sm" id={labelId}>
        {messages.categoryLabel}
      </span>
      <Select
        aria-labelledby={labelId}
        onValueChange={(next) => {
          onChange(Number(next))
        }}
        options={options}
        placeholder={messages.categoryPlaceholder}
        value={value === null ? undefined : String(value)}
      />
    </div>
  )
}
