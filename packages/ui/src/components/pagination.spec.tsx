/**
 * TASK-0016 F2 · F3 — moving through a list that is changing underneath the
 * reader, with no duplicates and nothing skipped.
 *
 * The backend is a stand-in, per QUALITY-GATES: 프론트는 백엔드 모킹. It is a real
 * keyset scan though — "everything after this id" — because a fake that returned
 * canned pages would prove nothing about the property under test. The insertion
 * in the middle of the walk is the case an `OFFSET` would fail: every row shifts
 * by one, and the row that ended page 1 opens page 2.
 */

import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import type { CursorPage } from './cursor-pagination'
import { Pagination } from './pagination'
import { useCursorPagination } from './use-cursor-pagination'

interface Product {
  readonly id: string
  readonly name: string
}

function product(id: string): Product {
  return { id, name: `Product ${id}` }
}

/** Ordered by id, which is what the cursor is a position in. */
function createSource(ids: readonly string[]) {
  let items = ids.map(product)

  return {
    /** A product that sorts before everything already loaded. */
    prepend(id: string): void {
      items = [product(id), ...items]
    },
    page(cursor: string | null, size: number): CursorPage<Product> {
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

const PAGE_SIZE = 2

function ProductList({ source }: { readonly source: ReturnType<typeof createSource> }) {
  const [cursor, setCursor] = useState<string | null>(null)
  const page = source.page(cursor, PAGE_SIZE)

  const pagination = useCursorPagination({
    nextCursor: page.nextCursor,
    onCursorChange: setCursor,
  })

  return (
    <div>
      <ul aria-label="Products">
        {page.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <Pagination
        hasNext={pagination.hasNext}
        hasPrevious={pagination.hasPrevious}
        label="Product pages"
        nextLabel="Next"
        onNext={pagination.goNext}
        onPrevious={pagination.goPrevious}
        previousLabel="Previous"
        status={`Page ${String(pagination.pageIndex + 1)}`}
      />
    </div>
  )
}

/** The names currently on screen. */
function visibleProducts(): readonly string[] {
  return within(screen.getByRole('list', { name: 'Products' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe('cursor pagination through a list', () => {
  it('walks the whole list with no duplicate and nothing skipped', async () => {
    const user = setupUser()
    const source = createSource(['01', '02', '03', '04', '05'])
    render(<ProductList source={source} />)

    const seen: string[] = [...visibleProducts()]
    const next = screen.getByRole('button', { name: 'Next' })

    while (!next.hasAttribute('disabled')) {
      await user.click(next)
      seen.push(...visibleProducts())
    }

    expect(seen).toEqual(['Product 01', 'Product 02', 'Product 03', 'Product 04', 'Product 05'])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('goes back to exactly the previous page', async () => {
    const user = setupUser()
    const source = createSource(['01', '02', '03', '04', '05'])
    render(<ProductList source={source} />)

    const first = visibleProducts()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const second = visibleProducts()
    await user.click(screen.getByRole('button', { name: 'Previous' }))

    expect(second).not.toEqual(first)
    expect(visibleProducts()).toEqual(first)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('shows no duplicate when a row is inserted mid-walk', async () => {
    const user = setupUser()
    const source = createSource(['02', '03', '04', '05', '06'])
    render(<ProductList source={source} />)

    const first = visibleProducts()
    expect(first).toEqual(['Product 02', 'Product 03'])

    // Someone lists a new product while the reader is on page 1. With an offset
    // every row shifts by one and "Product 03" appears again on page 2.
    source.prepend('01')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(visibleProducts()).toEqual(['Product 04', 'Product 05'])
    expect(visibleProducts().some((name) => first.includes(name))).toBe(false)
  })

  it('picks the new row up when the reader goes back', async () => {
    const user = setupUser()
    const source = createSource(['02', '03', '04', '05', '06'])
    render(<ProductList source={source} />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    source.prepend('01')
    await user.click(screen.getByRole('button', { name: 'Previous' }))

    // Not stale: the first page is re-read, so the insertion is visible.
    expect(visibleProducts()).toEqual(['Product 01', 'Product 02'])
  })

  it('is operable from the keyboard alone', async () => {
    const user = setupUser()
    const source = createSource(['01', '02', '03', '04'])
    render(<ProductList source={source} />)

    // Previous is disabled on the first page, so Tab lands on Next.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(visibleProducts()).toEqual(['Product 03', 'Product 04'])

    // Previous is now reachable, and it is before Next in the tab order.
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveFocus()

    await user.keyboard(' ')
    expect(visibleProducts()).toEqual(['Product 01', 'Product 02'])
  })
})

describe('Pagination', () => {
  it('disables the ends of the list', () => {
    render(
      <Pagination
        hasNext={false}
        hasPrevious={false}
        label="Pages"
        nextLabel="Next"
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        previousLabel="Previous"
      />,
    )

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('blocks a second press while a page is in flight', async () => {
    const user = setupUser()
    const onNext = vi.fn()

    render(
      <Pagination
        busy
        hasNext
        hasPrevious
        label="Pages"
        nextLabel="Next"
        onNext={onNext}
        onPrevious={vi.fn()}
        previousLabel="Previous"
      />,
    )

    const next = screen.getByRole('button', { name: 'Next' })
    await user.click(next)

    expect(onNext).not.toHaveBeenCalled()
    // Still focusable, so the keyboard user is not thrown back to the top of
    // the document the moment they press it (QUALITY-GATES U3).
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).not.toBeDisabled()
  })

  it('names the navigation so more than one can sit on a page', () => {
    render(
      <Pagination
        hasNext
        hasPrevious={false}
        label="Order pages"
        nextLabel="Next"
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        previousLabel="Previous"
        status="Page 1"
      />,
    )

    const nav = screen.getByRole('navigation', { name: 'Order pages' })
    expect(within(nav).getByRole('status')).toHaveTextContent('Page 1')
  })
})
