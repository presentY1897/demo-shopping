/**
 * `DynamicForm` — inputs generated from definitions.
 *
 * The five types are `AttributeDefinition.type` from TASK-0030 — `TEXT`,
 * `NUMBER`, `SELECT`, `MULTI_SELECT`, `BOOLEAN` — mapped one to one, so
 * anything an administrator can define here is something this can render. M05
 * uses it twice: the attribute admin screen previews the definition it is
 * editing, and the seller's product editor renders the effective attributes of
 * the chosen category. Both call this, so they cannot disagree.
 *
 * Ordering, defaults and the schema all come from the pure functions in
 * `field-def.ts`; this component only decides which control a type draws.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef } from 'react'

import { Button } from '../../src/components'
import type { FieldDef, FieldMessages, ResolvedField } from '../../src/form'
import { DynamicForm, Form, initialValuesForFields, schemaForFields, useForm } from '../../src/form'

const messages: FieldMessages = {
  invalidChoice: (field: ResolvedField) => `Choose a value for ${field.label}.`,
  invalidNumber: (field: ResolvedField) => `${field.label} has to be a number.`,
  required: (field: ResolvedField) => `${field.label} is required.`,
}

/** What an administrator defined for the "Coat" category. */
const COAT_ATTRIBUTES: readonly FieldDef[] = [
  {
    hint: 'As printed on the care label',
    key: 'material',
    label: 'Material',
    order: 10,
    placeholder: 'Wool 80%, nylon 20%',
    required: true,
    type: 'text',
  },
  { hint: 'Grams', key: 'weight', label: 'Weight', order: 20, placeholder: '820', type: 'number' },
  {
    key: 'fit',
    label: 'Fit',
    options: [
      { label: 'Regular', value: 'regular' },
      { label: 'Oversized', value: 'oversized' },
    ],
    order: 30,
    required: true,
    type: 'select',
  },
  {
    key: 'seasons',
    label: 'Seasons',
    options: [
      { label: 'Autumn', value: 'autumn' },
      { label: 'Winter', value: 'winter' },
      { label: 'Spring', value: 'spring' },
    ],
    order: 40,
    required: true,
    type: 'multiselect',
  },
  { key: 'washable', label: 'Machine washable', order: 50, type: 'boolean' },
]

function GeneratedForm({
  fields,
  submitOnLoad = false,
}: {
  readonly fields: readonly FieldDef[]
  readonly submitOnLoad?: boolean
}) {
  const form = useForm({
    initialValues: initialValuesForFields(fields),
    onSubmit: () => undefined,
    schema: schemaForFields(fields, messages),
  })

  const started = useRef(false)

  useEffect(() => {
    if (!submitOnLoad || started.current) return
    started.current = true
    form.submit()
  }, [form, submitOnLoad])

  return (
    <Form aria-label="Attributes" className="max-w-96" form={form}>
      <DynamicForm fields={fields} form={form} />
      <Button type="submit">Save</Button>
    </Form>
  )
}

const meta = {
  title: 'Components/Dynamic form',
  component: GeneratedForm,
  tags: ['autodocs'],
  args: { fields: COAT_ATTRIBUTES },
} satisfies Meta<typeof GeneratedForm>

export default meta

type Story = StoryObj<typeof meta>

/** One definition of every type, in the order the definitions ask for. */
export const Default: Story = {}

/**
 * Submitted empty. Each generated field carries its own message, including the
 * checkbox set — whose message belongs to the `fieldset`, because that is what
 * a screen reader announces the group by.
 */
export const Invalid: Story = {
  args: { submitOnLoad: true },
}

/**
 * A category with no attributes of its own. The generator renders nothing
 * rather than an empty box, so the surrounding screen decides what "no
 * attributes" looks like.
 */
export const NoDefinitions: Story = {
  args: { fields: [] },
}

/** Optional fields only — nothing is marked, and Save goes straight through. */
export const AllOptional: Story = {
  args: {
    fields: COAT_ATTRIBUTES.map((field) => ({ ...field, required: false })),
  },
}
