/**
 * `ErrorNotice` — the failure nobody on this screen can fix, and the number
 * that lets somebody else fix it.
 *
 * The rule it encodes (TASK-0117 4.4): a failure the reader can act on gets a
 * sentence and a next step on the field it is about, and **no** correlation id —
 * a UUID beside "다른 주소를 입력해 주세요" is noise. A failure they cannot act
 * on gets the id, because quoting it is the only useful thing left to do.
 *
 * The id is a copy button *and* selectable monospace text. The clipboard API is
 * unavailable on an insecure origin and can be denied, and a copy button that
 * silently does nothing is worse than no button at all — so the confirmation
 * only appears when the write actually succeeded.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, ErrorNotice } from '../../src/components'

const meta = {
  title: 'Components/ErrorNotice',
  component: ErrorNotice,
  tags: ['autodocs'],
  args: {
    title: 'A temporary problem came up. Please try again in a moment.',
  },
} satisfies Meta<typeof ErrorNotice>

export default meta

type Story = StoryObj<typeof meta>

/** No id: nothing here would help anybody look the request up. */
export const WithoutRequestId: Story = {
  args: {
    description: 'The request never reached the server, so there is nothing to quote.',
  },
}

/** The shape a 500 gets: what happened, why the number, the number, and copy. */
export const WithRequestId: Story = {
  args: {
    description: 'A temporary problem came up on our side.',
    requestId: '4f3c1a90-8e2b-4c7d-9a11-4d0b7f2ea7b2',
    requestIdLabel: 'Support reference',
    requestIdHint: 'Quoting this number when you get in touch makes it much faster to look up.',
    copyLabel: 'Copy',
    copiedLabel: 'Copied',
  },
}

/** Retrying is sometimes still worth offering, beside the reference. */
export const WithAction: Story = {
  args: {
    description: 'The catalogue could not be loaded.',
    requestId: '4f3c1a90-8e2b-4c7d-9a11-4d0b7f2ea7b2',
    requestIdLabel: 'Support reference',
    requestIdHint: 'Quoting this number when you get in touch makes it much faster to look up.',
    copyLabel: 'Copy',
    copiedLabel: 'Copied',
    action: <Button variant="outline">Try again</Button>,
  },
}

/**
 * A long id wraps instead of overflowing its container — the narrow console
 * column at 360px is where this breaks if it is going to (P4).
 */
export const Narrow: Story = {
  args: {
    description: 'A temporary problem came up on our side.',
    requestId: '4f3c1a90-8e2b-4c7d-9a11-4d0b7f2ea7b2',
    requestIdLabel: 'Support reference',
    requestIdHint: 'Quoting this number makes it faster to look up.',
    copyLabel: 'Copy',
    copiedLabel: 'Copied',
    className: 'max-w-72',
  },
}
