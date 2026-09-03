/**
 * `Textarea` — a multi-line field.
 *
 * `min-h-control-lg` rather than a fixed height: the floor follows the density
 * step like every other control, and the browser's resize handle takes it from
 * there.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Textarea } from '../../src/components'
import { Field, Stack } from '../support/layout'

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: { placeholder: 'Tell the seller what you need.' },
  render: (args) => (
    <Field htmlFor="textarea-story" label="Message">
      <Textarea {...args} id="textarea-story" />
    </Field>
  ),
} satisfies Meta<typeof Textarea>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const States: Story = {
  render: (args) => (
    <Stack>
      <Field htmlFor="textarea-invalid" label="Message · invalid">
        <Textarea
          {...args}
          aria-describedby="textarea-invalid-error"
          defaultValue=""
          id="textarea-invalid"
          invalid
        />
        <p className="text-danger text-xs" id="textarea-invalid-error">
          Enter a message.
        </p>
      </Field>
      <Field htmlFor="textarea-disabled" label="Message · disabled">
        <Textarea {...args} disabled id="textarea-disabled" />
      </Field>
    </Stack>
  ),
}

/** More rows than the default, and enough text to make it scroll. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Field htmlFor="textarea-rows" label="Eight rows">
        <Textarea {...args} id="textarea-rows" rows={8} />
      </Field>
      <Field htmlFor="textarea-full" label="Overflowing content">
        <Textarea
          {...args}
          defaultValue={Array.from({ length: 12 }, (_, index) => `Line ${String(index + 1)}`).join(
            '\n',
          )}
          id="textarea-full"
        />
      </Field>
    </Stack>
  ),
}
