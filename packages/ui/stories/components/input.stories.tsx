/**
 * `Input` — a single-line text field.
 *
 * The native `size` attribute (a character count) is dropped so `size` means
 * what it means on every other component here. Every story labels its field:
 * an unlabelled input is an axe violation, and `test/story-a11y.spec.tsx` fails
 * the build on one.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Input, INPUT_SIZES } from '../../src/components'
import { Field, Stack } from '../support/layout'

const meta = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  args: {
    placeholder: 'name@example.com',
    size: 'md',
    type: 'email',
  },
  argTypes: {
    size: { control: 'inline-radio', options: [...INPUT_SIZES] },
  },
  render: (args) => (
    <Field htmlFor="input-story" label="Email">
      <Input {...args} id="input-story" />
    </Field>
  ),
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: (args) => (
    <Stack>
      {INPUT_SIZES.map((size) => (
        <Field htmlFor={`input-${size}`} key={size} label={`Email · size="${size}"`}>
          <Input {...args} id={`input-${size}`} size={size} />
        </Field>
      ))}
    </Stack>
  ),
}

/**
 * The border carries the error and `aria-invalid` carries it to a screen
 * reader. Colour alone would fail WCAG 1.4.1; the message itself is the form
 * layer's job, and `aria-describedby` is the hook it attaches to.
 */
export const States: Story = {
  render: (args) => (
    <Stack>
      <Field htmlFor="input-invalid" label="Email · invalid">
        <Input
          {...args}
          aria-describedby="input-invalid-error"
          defaultValue="not-an-email"
          id="input-invalid"
          invalid
        />
        <p className="text-danger text-xs" id="input-invalid-error">
          Enter an email address.
        </p>
      </Field>
      <Field htmlFor="input-disabled" label="Email · disabled">
        <Input {...args} defaultValue="locked@example.com" disabled id="input-disabled" />
      </Field>
      <Field htmlFor="input-readonly" label="Email · read only">
        <Input {...args} defaultValue="fixed@example.com" id="input-readonly" readOnly />
      </Field>
    </Stack>
  ),
}

/** A value longer than the box, and one that is a single character. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Field htmlFor="input-long" label="Long value">
        <Input
          {...args}
          defaultValue="a-very-long-address-that-will-not-fit-inside-the-visible-box@example.com"
          id="input-long"
        />
      </Field>
      <Field htmlFor="input-short" label="One character">
        <Input {...args} defaultValue="1" id="input-short" />
      </Field>
    </Stack>
  ),
}
