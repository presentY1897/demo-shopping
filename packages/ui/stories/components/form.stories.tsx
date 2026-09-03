/**
 * `Form`, `FormField`, `FieldError` and `FormError` — the error display
 * convention (TASK-0017 4.3).
 *
 * A form system cannot be shown one component at a time: what it decides is how
 * a label, a hint, a control and a message sit together, and what happens when
 * a submit fails. So the subject here is a small realistic form, and the
 * stories are its states — blank, invalid, in flight, and refused by the
 * server.
 *
 * Two of those are worth reading closely.
 *
 * **Invalid** shows the whole convention at once: the message under the
 * control, `aria-invalid` on the control, and `aria-describedby` naming the
 * hint and then the error — so a screen reader reads "Nickname, edit text, at
 * least two characters, enter a nickname". Colour is never the only signal.
 *
 * **Server error** is the one no form library provides. The 400 envelope's
 * `details` is turned into per-field messages by `serverFieldErrors`, and
 * anything that names no field lands in the `FormError` box at the top, which
 * is the only `role="alert"` in the form.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef } from 'react'
import { z } from 'zod'

import { Button, Checkbox, Input, Select, Textarea } from '../../src/components'
import { FieldError, Form, FormError, FormField, serverFieldErrors, useForm } from '../../src/form'

const PLANS = [
  { label: 'Standard', value: 'standard' },
  { label: 'Priority', value: 'priority' },
]

const schema = z.object({
  email: z.string().trim().min(1, 'Enter an email address.').regex(/@/, 'That is not an address.'),
  nickname: z.string().trim().min(2, 'Use at least two characters.'),
  note: z.string().trim(),
  plan: z.enum(['standard', 'priority'], { error: 'Choose a delivery plan.' }),
  terms: z.literal(true, { error: 'You have to accept the terms.' }),
})

const FIELDS = ['email', 'nickname', 'note', 'plan', 'terms']

const BLANK = { email: '', nickname: '', note: '', plan: '', terms: false }
const FILLED = {
  email: 'buyer@example.com',
  nickname: 'Buyer',
  note: '',
  plan: 'standard',
  terms: true,
}

/** Stands in for `ApiClientError`; carries what the error envelope carries. */
class Refused extends Error {
  constructor(readonly details: readonly unknown[]) {
    super('refused')
  }
}

const SCENARIOS = ['blank', 'invalid', 'submitting', 'serverError'] as const
type Scenario = (typeof SCENARIOS)[number]

function ProfileForm({ scenario }: { readonly scenario: Scenario }) {
  const form = useForm({
    initialValues: scenario === 'invalid' ? BLANK : FILLED,
    mapError: (error) =>
      error instanceof Refused ? serverFieldErrors(error.details, { fields: FIELDS }) : undefined,
    onSubmit: async () => {
      if (scenario === 'submitting') await new Promise<void>(() => undefined)
      if (scenario === 'serverError') {
        throw new Refused(['nickname is already taken.', 'The account is not verified yet.'])
      }
    },
    schema,
    submitErrorMessage: 'Could not save. Try again.',
  })

  const started = useRef(false)

  useEffect(() => {
    if (scenario === 'blank' || started.current) return
    started.current = true
    form.submit()
  }, [form, scenario])

  return (
    <Form aria-label="Profile" className="max-w-96" form={form}>
      <FormError errors={form.formErrors} title="The profile was not saved" />

      <FormField form={form} label="Email" name="email" required>
        <Input {...form.text('email')} placeholder="name@example.com" type="email" />
      </FormField>

      <FormField
        form={form}
        hint="At least two characters"
        label="Nickname"
        name="nickname"
        required
      >
        <Input {...form.text('nickname')} />
      </FormField>

      <FormField form={form} label="Delivery plan" name="plan" required>
        <Select {...form.choice('plan')} options={PLANS} placeholder="Choose" />
      </FormField>

      <FormField form={form} hint="Shown to the seller" label="Note" name="note">
        <Textarea {...form.text('note')} />
      </FormField>

      <FormField form={form} label="I accept the terms" name="terms" required>
        <Checkbox {...form.toggle('terms')} />
      </FormField>

      <Button loading={form.submitting} type="submit">
        Save
      </Button>
    </Form>
  )
}

const meta = {
  title: 'Components/Form',
  component: ProfileForm,
  tags: ['autodocs'],
  args: { scenario: 'blank' },
  argTypes: {
    scenario: { control: 'inline-radio', options: [...SCENARIOS] },
  },
} satisfies Meta<typeof ProfileForm>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing filled in and nothing said. Press Save to see the rest. */
export const Default: Story = {}

/**
 * Submitted empty. Every message sits under its own control, the controls carry
 * `aria-invalid`, and focus has moved to the first of them.
 */
export const Invalid: Story = {
  args: { scenario: 'invalid' },
}

/**
 * A request is in flight. The button keeps its focus — it is `aria-disabled`,
 * not `disabled` — and the form is `aria-busy`. A second click, and **Enter in
 * any field**, are both refused by the form's own guard.
 */
export const Submitting: Story = {
  args: { scenario: 'submitting' },
}

/**
 * The API answered 400. `nickname is already taken.` names a field and lands on
 * it; the sentence that names none is shown in the alert at the top rather than
 * dropped.
 */
export const ServerError: Story = {
  args: { scenario: 'serverError' },
}

/**
 * The three message components on their own, which is what a screen that is not
 * a form reaches for — a filter panel, an inline rename.
 *
 * `FormError` is the only one with `role="alert"`. A `FieldError` per field
 * would announce ten messages at once on a failed submit, so instead the form
 * moves focus to the first invalid control and the message is read as that
 * control's description.
 */
export const Messages: Story = {
  render: () => (
    <div className="flex max-w-96 flex-col gap-4">
      <FormError
        errors={['The store is closed for maintenance.', 'Try again in a few minutes.']}
        title="Could not save"
      />

      <div className="flex flex-col gap-1">
        <label className="text-fg-muted text-sm" htmlFor="messages-email">
          Email
        </label>
        <Input aria-describedby="messages-email-error" id="messages-email" invalid />
        <FieldError id="messages-email-error">Enter an email address.</FieldError>
      </div>
    </div>
  ),
}
