/**
 * The generated form, driven through the controls it generates.
 *
 * `field-def.spec.ts` already proves what the pure functions decide; this
 * proves that those decisions reach the screen — the right element per type
 * (F5), the right order, and errors that land on the generated field rather
 * than in a pile at the top.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '../components/button'
import { setupUser } from '../../test/support/ui'
import { DynamicForm } from './dynamic-form'
import type { FieldDef, FieldMessages, ResolvedField } from './field-def'
import { initialValuesForFields, schemaForFields } from './field-def'
import { Form } from './form'
import { useForm } from './use-form'

const messages: FieldMessages = {
  invalidChoice: (field: ResolvedField) => `${field.label}을(를) 다시 선택해주세요`,
  invalidNumber: (field: ResolvedField) => `${field.label}은(는) 숫자여야 합니다`,
  required: (field: ResolvedField) => `${field.label}을(를) 입력해주세요`,
}

const COLOURS = [
  { label: '검정', value: 'black' },
  { label: '베이지', value: 'beige' },
]

/** One definition of each of the five attribute types (TASK-0030). */
const ATTRIBUTES: readonly FieldDef[] = [
  { key: 'material', label: '소재', order: 1, required: true, type: 'text' },
  { hint: '그램', key: 'weight', label: '중량', order: 2, type: 'number' },
  {
    key: 'size',
    label: '사이즈',
    options: [
      { label: 'S', value: 's' },
      { label: 'M', value: 'm' },
    ],
    order: 3,
    required: true,
    type: 'select',
  },
  {
    key: 'colours',
    label: '색상',
    options: COLOURS,
    order: 4,
    required: true,
    type: 'multiselect',
  },
  { key: 'washable', label: '세탁 가능', order: 5, type: 'boolean' },
]

function AttributeForm({
  fields = ATTRIBUTES,
  onSubmit = vi.fn(),
}: {
  readonly fields?: readonly FieldDef[]
  readonly onSubmit?: (values: unknown) => void
}) {
  const form = useForm({
    initialValues: initialValuesForFields(fields),
    onSubmit,
    schema: schemaForFields(fields, messages),
  })

  return (
    <Form aria-label="속성" form={form}>
      <DynamicForm fields={fields} form={form} />
      <Button type="submit">저장</Button>
    </Form>
  )
}

describe('the five attribute types (F5)', () => {
  it('renders the control each type maps to', () => {
    render(<AttributeForm />)

    expect(screen.getByRole('textbox', { name: /소재/ })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '중량' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /사이즈/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '세탁 가능' })).toBeInTheDocument()

    const colours = screen.getByRole('group', { name: /색상/ })
    expect(within(colours).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('renders the fields in the order the definitions ask for', () => {
    render(
      <AttributeForm
        fields={[
          { key: 'third', label: '셋', order: 30, type: 'text' },
          { key: 'first', label: '하나', order: 10, type: 'text' },
          { key: 'second', label: '둘', order: 20, type: 'text' },
        ]}
      />,
    )

    expect(screen.getAllByRole('textbox').map((input) => input.getAttribute('id'))).toEqual(
      screen.getAllByText(/하나|둘|셋/).map((label) => label.getAttribute('for')),
    )
  })

  it('renders nothing at all for an empty definition list (U1 — the empty state)', () => {
    render(<AttributeForm fields={[]} />)

    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument()
  })
})

describe('validation over generated fields', () => {
  it('puts each message on its own generated field (U2)', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AttributeForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByRole('textbox', { name: /소재/ })).toHaveAccessibleDescription(
      '소재을(를) 입력해주세요',
    )
    expect(screen.getByRole('combobox', { name: /사이즈/ })).toHaveAccessibleDescription(
      '사이즈을(를) 입력해주세요',
    )
    expect(screen.getByRole('group', { name: /색상/ })).toHaveAccessibleDescription(
      '색상을(를) 입력해주세요',
    )
  })

  it('reads a number field as a number, and an empty optional one as nothing', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(
      <AttributeForm
        fields={[
          { key: 'weight', label: '중량', order: 1, type: 'number' },
          { key: 'length', label: '길이', order: 2, required: true, type: 'number' },
        ]}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: '저장' }))

    // The required one is named; the optional one is not.
    expect(await screen.findByRole('spinbutton', { name: /길이/ })).toHaveAccessibleDescription(
      '길이을(를) 입력해주세요',
    )
    expect(screen.getByRole('spinbutton', { name: '중량' })).not.toHaveAttribute('aria-invalid')

    await user.type(screen.getByRole('spinbutton', { name: /길이/ }), '120')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(onSubmit).toHaveBeenCalledWith({ length: 120, weight: undefined })
  })

  it('collects a multiselect into an array and a checkbox into a boolean', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AttributeForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: /소재/ }), '울')

    await user.click(screen.getByRole('combobox', { name: /사이즈/ }))
    await user.click(await screen.findByRole('option', { name: 'M' }))

    await user.click(screen.getByRole('checkbox', { name: '검정' }))
    await user.click(screen.getByRole('checkbox', { name: '베이지' }))
    await user.click(screen.getByRole('checkbox', { name: '검정' }))
    await user.click(screen.getByRole('checkbox', { name: '세탁 가능' }))

    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(onSubmit).toHaveBeenCalledWith({
      colours: ['beige'],
      material: '울',
      size: 'm',
      washable: true,
      weight: undefined,
    })
  })

  it('is operable from the keyboard alone (U5)', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(
      <AttributeForm
        fields={[{ key: 'material', label: '소재', order: 1, required: true, type: 'text' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.tab()
    expect(screen.getByRole('textbox', { name: /소재/ })).toHaveFocus()
    await user.keyboard('울{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ material: '울' })
  })
})
