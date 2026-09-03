'use client'

/**
 * Fields rendered from definitions.
 *
 * The renderer holds no rules. Ordering, defaults and the type → control
 * mapping are `field-def.ts`'s pure functions, which is what lets the same five
 * decisions be tested exhaustively and be reused by the server side generator's
 * counterpart in TASK-0030. What is left here is which component each control
 * name maps to.
 *
 * M05 uses this twice: the admin attribute screen previews a definition it is
 * still editing (TASK-0031 F4), and the seller product editor renders the
 * effective attributes of the chosen category (TASK-0114). Both get the same
 * form because both call this.
 */

import { Checkbox } from '../components/checkbox'
import { Input } from '../components/input'
import { Select } from '../components/select'
import { cx } from '../lib/cx'
import type { FieldDef, ResolvedField } from './field-def'
import { resolveFields } from './field-def'
import { fieldIds } from './field-ids'
import { FormField } from './form-field'
import type { FormApi } from './use-form'

export interface DynamicFormProps {
  readonly form: FormApi
  readonly fields: readonly FieldDef[]
  readonly className?: string
}

function DynamicField({ field, form }: { readonly field: ResolvedField; readonly form: FormApi }) {
  const common = {
    form,
    hint: field.hint,
    label: field.label,
    name: field.key,
    required: field.required,
  }

  switch (field.control) {
    case 'input':
      return (
        <FormField {...common}>
          <Input {...form.text(field.key)} placeholder={field.placeholder} type="text" />
        </FormField>
      )

    case 'number-input':
      return (
        <FormField {...common}>
          {/*
            `inputMode` as well as `type`: the numeric keypad is what a phone
            reads, and `type="number"` alone gives a keyboard with a comma on
            some Android builds.
          */}
          <Input
            {...form.text(field.key)}
            inputMode="decimal"
            placeholder={field.placeholder}
            type="number"
          />
        </FormField>
      )

    case 'select':
      return (
        <FormField {...common}>
          <Select
            {...form.choice(field.key)}
            options={field.options}
            placeholder={field.placeholder}
          />
        </FormField>
      )

    case 'checkbox': {
      // No `label` on the `Checkbox`: `FormField` renders the label and ties it
      // with `htmlFor`, and two labels for one control is an axe violation.
      return (
        <FormField {...common}>
          <Checkbox {...form.toggle(field.key)} />
        </FormField>
      )
    }

    default: {
      // `checkbox-group` — a fieldset, because the accessible name of a set of
      // checkboxes comes from its legend and from nowhere else.
      const multi = form.multi(field.key)

      return (
        <FormField {...common} variant="group">
          <div className="flex flex-col gap-1">
            {field.options.map((option) => (
              <Checkbox
                checked={multi.isSelected(option.value)}
                id={`${fieldIds(form.id, field.key).control}-${option.value}`}
                invalid={multi.invalid}
                key={option.value}
                label={option.label}
                onCheckedChange={(checked) => {
                  multi.setSelected(option.value, checked === true)
                }}
                value={option.value}
              />
            ))}
          </div>
        </FormField>
      )
    }
  }
}

export function DynamicForm({ form, fields, className }: DynamicFormProps) {
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      {resolveFields(fields).map((field) => (
        <DynamicField field={field} form={form} key={field.key} />
      ))}
    </div>
  )
}
