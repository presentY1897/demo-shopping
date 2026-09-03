/**
 * `Modal` — the clearest case for Radix in the whole package.
 *
 * A correct dialog traps Tab at both ends, moves focus in on open and back to
 * the trigger on close, closes on Escape, hides the rest of the page from
 * assistive technology, locks the background scroll without the page shifting,
 * and wires `aria-labelledby` / `aria-describedby` to the right nodes. Every one
 * of those is a bug people actually ship.
 *
 * `title` is required: `Dialog.Title` is what gives the dialog its accessible
 * name, and a nameless dialog is announced as nothing at all.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, Modal, ModalClose, MODAL_SIZES } from '../../src/components'
import { Row } from '../support/layout'

const meta = {
  title: 'Components/Modal',
  component: Modal,
  tags: ['autodocs'],
  args: {
    closeLabel: 'Close',
    description: 'The seller will be notified and the payment released.',
    size: 'md',
    title: 'Confirm delivery',
    trigger: <Button variant="outline">Open</Button>,
    children: <p>Confirm only after the parcel has arrived. This cannot be undone.</p>,
    footer: (
      <>
        <ModalClose>
          <Button variant="outline">Cancel</Button>
        </ModalClose>
        <ModalClose>
          <Button>Confirm</Button>
        </ModalClose>
      </>
    ),
  },
  argTypes: {
    size: { control: 'inline-radio', options: [...MODAL_SIZES] },
  },
} satisfies Meta<typeof Modal>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Open on load, so the dialog itself is what the accessibility checker sees. */
export const Open: Story = {
  args: { defaultOpen: true },
}

export const Sizes: Story = {
  render: (args) => (
    <Row>
      {MODAL_SIZES.map((size) => (
        <Modal
          {...args}
          key={size}
          size={size}
          title={`Confirm delivery · ${size}`}
          trigger={<Button variant="outline">{size}</Button>}
        />
      ))}
    </Row>
  ),
}

/**
 * `dismissible={false}` blocks Escape and the outside click. For a decision the
 * user has to make explicitly — never as a way to keep them on a screen.
 */
export const NotDismissible: Story = {
  args: {
    defaultOpen: true,
    dismissible: false,
    title: 'Payment in progress',
    description: 'Do not close this window until the payment finishes.',
  },
}

/** No description, and a body long enough that the dialog scrolls itself. */
export const EdgeCases: Story = {
  args: {
    defaultOpen: true,
    description: undefined,
    children: (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 30 }, (_, index) => (
          <p key={index}>{`Line ${String(index + 1)} of a body that outgrows the viewport.`}</p>
        ))}
      </div>
    ),
  },
}
