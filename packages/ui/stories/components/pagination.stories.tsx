/**
 * `Pagination` — previous and next over a cursor, and nothing else.
 *
 * There is no "jump to page 7". A cursor names a row rather than an offset, so
 * the only pages reachable from one are the next one and the ones already
 * visited. That is the trade `docs/design/pages.md` 공통 규칙 makes deliberately:
 * an offset can jump, but it repeats and drops rows every time the list changes
 * underneath the reader — which for a product or order list is constantly.
 *
 * The live story below is the demonstration: the source is a real keyset scan,
 * and the button inserts a row *before* the current page while the reader is on
 * it.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button, Pagination, useCursorPagination } from '../../src/components'
import { Row, Stack } from '../support/layout'

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  args: {
    hasNext: true,
    hasPrevious: true,
    label: 'Product pages',
    nextLabel: 'Next',
    onNext: () => undefined,
    onPrevious: () => undefined,
    previousLabel: 'Previous',
    status: 'Page 2',
  },
} satisfies Meta<typeof Pagination>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The first page: there is nothing behind it, so back is genuinely unavailable. */
export const FirstPage: Story = {
  args: { hasPrevious: false, status: 'Page 1' },
}

export const LastPage: Story = {
  args: { hasNext: false, status: 'Page 6' },
}

/**
 * A page is in flight. Both buttons refuse the press but stay focusable —
 * `aria-disabled`, not `disabled` — so a keyboard user's focus is not thrown to
 * the top of the document the moment they press Next.
 */
export const Busy: Story = {
  args: { busy: true },
}

/** Without a status line, for a place where the count is already on screen. */
export const WithoutStatus: Story = {
  args: { status: undefined },
}

interface Product {
  readonly id: string
  readonly name: string
}

/** Ordered by id — which is what the cursor is a position in. */
function createSource(count: number) {
  let items: Product[] = Array.from({ length: count }, (_, index) => ({
    id: String(index + 10),
    name: `Product ${String(index + 10)}`,
  }))

  return {
    insertAtFront(): void {
      const id = String(Number(items[0]?.id ?? '10') - 1)
      items = [{ id, name: `Product ${id} (just listed)` }, ...items]
    },
    page(cursor: string | null, size: number) {
      const start = cursor === null ? 0 : items.findIndex((item) => item.id === cursor) + 1
      const slice = items.slice(start, start + size)
      const last = slice[slice.length - 1]
      return {
        items: slice,
        nextCursor: last !== undefined && start + size < items.length ? last.id : null,
      }
    },
  }
}

function LiveCursorList() {
  const [source] = useState(() => createSource(9))
  const [cursor, setCursor] = useState<string | null>(null)
  // The source is a mutable stand-in for a server, so an insertion has to be
  // announced to React by hand. A real screen refetches instead.
  const [, setRevision] = useState(0)
  const page = source.page(cursor, 3)

  const pagination = useCursorPagination({
    nextCursor: page.nextCursor,
    onCursorChange: setCursor,
  })

  return (
    <Stack>
      <ul aria-label="Products" className="flex flex-col gap-1">
        {page.items.map((item) => (
          <li className="text-fg text-sm" key={item.id}>
            {item.name}
          </li>
        ))}
      </ul>

      <Pagination
        hasNext={pagination.hasNext}
        hasPrevious={pagination.hasPrevious}
        label="Live product pages"
        nextLabel="Next"
        onNext={pagination.goNext}
        onPrevious={pagination.goPrevious}
        previousLabel="Previous"
        status={`Page ${String(pagination.pageIndex + 1)} · cursor ${pagination.cursor ?? '—'}`}
      />

      <Row>
        <Button
          onClick={() => {
            source.insertAtFront()
            setRevision((revision) => revision + 1)
          }}
          size="sm"
          variant="outline"
        >
          List a new product ahead of this page
        </Button>
      </Row>
    </Stack>
  )
}

/**
 * Walk forward, insert a product, keep walking. Nothing repeats and nothing is
 * skipped — the inserted row is simply behind the cursor, and it appears when
 * the reader goes back.
 */
export const LiveCursorWalk: Story = {
  render: () => <LiveCursorList />,
}
