/**
 * `ConfirmDialog` — the step in front of something irreversible.
 *
 * Built on `Modal`, so the focus trap, Escape, the background inertness and the
 * accessible name are Radix's. What this adds is the convention: the dialog is
 * dismissible, initial focus is **not** on the confirm button, the confirm
 * button is `danger` when the action is destructive and `loading` while it
 * runs, and every string is a prop.
 *
 * `useConfirm` turns it into one `await`, which is what makes "the destructive
 * function is not reached unless the person said yes" a property of the code
 * rather than of the reviewer's attention:
 *
 * ```ts
 * const gate = useConfirm()
 * if (!(await gate.request())) return
 * await deleteCategory(id)
 * ```
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '../../src/components'
import { ConfirmDialog, useConfirm } from '../../src/form'

const meta = {
  title: 'Components/Confirm dialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  args: {
    cancelLabel: 'Keep it',
    closeLabel: 'Close',
    confirmLabel: 'Delete',
    description: 'The category and its 12 products lose their link. This cannot be undone.',
    destructive: true,
    onConfirm: () => undefined,
    title: 'Delete this category?',
    trigger: <Button variant="danger">Delete category</Button>,
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Open on load, so the dialog itself is what the accessibility checker sees. */
export const Open: Story = {
  args: { defaultOpen: true },
}

/**
 * Not every confirmation is destructive. Without `destructive` the confirm
 * button is the ordinary primary one, which keeps `danger` meaning something.
 */
export const NotDestructive: Story = {
  args: {
    cancelLabel: 'Back',
    confirmLabel: 'Publish',
    defaultOpen: true,
    description: 'The product becomes visible to buyers straight away.',
    destructive: false,
    title: 'Publish this product?',
    trigger: <Button>Publish</Button>,
  },
}

/** Extra detail in the body — exactly what is about to be lost. */
export const WithDetail: Story = {
  args: {
    children: (
      <ul className="list-disc pl-4">
        <li>Outerwear · 12 products</li>
        <li>Outerwear / Coats · 5 products</li>
      </ul>
    ),
    defaultOpen: true,
  },
}

function GatedDelete() {
  const gate = useConfirm()
  const [log, setLog] = useState<readonly string[]>([])

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={() => {
          void (async () => {
            const confirmed = await gate.request()
            setLog((entries) => [...entries, confirmed ? 'deleted' : 'cancelled'])
          })()
        }}
        variant="danger"
      >
        Delete category
      </Button>

      <ul className="text-fg-muted text-sm">
        {log.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>

      <ConfirmDialog
        cancelLabel="Keep it"
        closeLabel="Close"
        confirmLabel="Delete"
        description="This cannot be undone."
        destructive
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title="Delete this category?"
      />
    </div>
  )
}

/**
 * `useConfirm` in use. Every way out that is not the confirm button — Escape,
 * the ×, Keep it, a click outside — logs `cancelled`.
 */
export const AsAPromise: Story = {
  render: () => <GatedDelete />,
}
