/**
 * TASK-0016 F4b — the table scrolls sideways and the first column stays put,
 * and the page itself does not scroll.
 *
 * jsdom has no layout, so none of this is observable by rendering. What *is*
 * observable is the CSS the browser will apply, and that is what this file
 * asserts: the classes come off the rendered table and are compiled with the
 * real preset, so `overflow-x: auto` and `position: sticky` are declarations
 * rather than substrings.
 *
 * The rendered geometry was measured in a browser besides (TASK 6장), but a
 * measurement taken once is not a gate. This is the gate.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Table, type TableColumn } from '../src/components/table'
import { evaluateLength } from './support/css-tokens'
import { classNamesIn, compileClasses, declarationFor } from './support/tailwind'

interface Order {
  readonly id: string
  readonly buyer: string
  readonly total: number
}

const COLUMNS: readonly TableColumn<Order>[] = [
  { cell: (order) => order.id, header: 'Order', key: 'id', sortable: true },
  { cell: (order) => order.buyer, header: 'Buyer', key: 'buyer' },
  { align: 'end', cell: (order) => String(order.total), header: 'Total', key: 'total' },
]

const ROWS: readonly Order[] = [{ buyer: 'Han', id: '20260903-0001', total: 12000 }]

function renderTable(props: Partial<React.ComponentProps<typeof Table<Order>>> = {}) {
  const { container } = render(
    <Table
      caption="Orders"
      columns={COLUMNS}
      rowKey={(order) => order.id}
      rows={ROWS}
      stickyHeader
      {...props}
    />,
  )
  return container
}

/** A length whose only variable is the spacing unit, evaluated in px. */
function lengthWithUnit(value: string, unit: number): number {
  return evaluateLength(value.replaceAll('var(--space-unit)', `${String(unit)}px`))
}

function classesOf(element: Element): readonly string[] {
  return [...element.classList]
}

describe('the horizontal scroll', () => {
  it('is contained by the table wrapper, not by the page', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const region = screen.getByRole('region', { name: 'Orders' })

    // The overflow has to be *somewhere*. On the document it means every screen
    // in the app inherits a horizontal scrollbar the moment one table is wide.
    expect(classesOf(region)).toContain('overflow-x-auto')
    expect(declarationFor(rules, 'overflow-x-auto', 'overflow-x')).toBe('auto')

    // And the wrapper never widens past its parent, which is what keeps the
    // page from scrolling with it.
    expect(classesOf(region)).toContain('w-full')
    expect(declarationFor(rules, 'w-full', 'width')).toBe('100%')
  })

  it('lets the table grow past the wrapper so there is something to scroll', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const table = screen.getByRole('table', { name: 'Orders' })

    expect(classesOf(table)).toContain('min-w-full')
    expect(declarationFor(rules, 'min-w-full', 'min-width')).toBe('100%')

    // Cells that wrapped would reflow into a tall table instead of a wide one,
    // and there would be no scroll to pin a column against.
    expect(declarationFor(rules, 'whitespace-nowrap', 'white-space')).toBe('nowrap')
    expect(classesOf(screen.getAllByRole('cell')[0] as Element)).toContain('whitespace-nowrap')
  })
})

describe('the pinned first column', () => {
  it('is stuck to the inline start', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const [rowHeader] = screen.getAllByRole('rowheader')

    expect(classesOf(rowHeader as Element)).toEqual(expect.arrayContaining(['sticky', 'start-0']))
    expect(declarationFor(rules, 'sticky', 'position')).toBe('sticky')

    const start = declarationFor(rules, 'start-0', 'inset-inline-start')
    expect(start).toBeDefined()
    // Logical, not `left`: the offset is 0 at either writing direction.
    expect(lengthWithUnit(start ?? '', 4)).toBe(0)
  })

  it('paints over the columns scrolling underneath it', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const [rowHeader] = screen.getAllByRole('rowheader')

    // A transparent sticky cell shows the scrolled content through itself,
    // which looks like corrupted rendering. The row carries the colour and the
    // cell inherits it, so the hover state stays one declaration.
    expect(classesOf(rowHeader as Element)).toContain('bg-inherit')
    expect(declarationFor(rules, 'bg-inherit', 'background-color')).toBe('inherit')

    const row = rowHeader?.closest('tr')
    expect(row).not.toBeNull()
    expect(classesOf(row as Element)).toContain('bg-surface')
    expect(declarationFor(rules, 'bg-surface', 'background-color')).toBe('var(--color-surface)')
  })

  it('can be turned off for a table narrow enough not to need it', () => {
    renderTable({ pinFirstColumn: false })

    expect(classesOf(screen.getAllByRole('rowheader')[0] as Element)).not.toContain('sticky')
  })
})

describe('the sticky header', () => {
  it('is stuck to the block start', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const [first] = screen.getAllByRole('columnheader')

    expect(classesOf(first as Element)).toEqual(expect.arrayContaining(['sticky', 'top-0']))

    const top = declarationFor(rules, 'top-0', 'top')
    expect(top).toBeDefined()
    expect(lengthWithUnit(top ?? '', 4)).toBe(0)
  })

  it('puts the corner cell above both the header row and the pinned column', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const headers = screen.getAllByRole('columnheader')
    const [rowHeader] = screen.getAllByRole('rowheader')

    const corner = Number(declarationFor(rules, 'z-30', 'z-index'))
    const header = Number(declarationFor(rules, 'z-20', 'z-index'))
    const column = Number(declarationFor(rules, 'z-10', 'z-index'))

    expect(classesOf(headers[0] as Element)).toContain('z-30')
    expect(classesOf(headers[1] as Element)).toContain('z-20')
    expect(classesOf(rowHeader as Element)).toContain('z-10')

    // Both axes are stuck at once in that cell; below either neighbour it would
    // be scrolled over by the very rows it is meant to label.
    expect(corner).toBeGreaterThan(header)
    expect(header).toBeGreaterThan(column)
  })

  it('separates the borders so a sticky cell keeps its edge', async () => {
    const container = renderTable()
    const rules = await compileClasses(classNamesIn(container))
    const table = screen.getByRole('table', { name: 'Orders' })

    // With `border-collapse: collapse` the table owns the borders, and a sticky
    // cell scrolls out from under its own right edge.
    expect(classesOf(table)).toContain('border-separate')
    expect(declarationFor(rules, 'border-separate', 'border-collapse')).toBe('separate')
    expect(classesOf(table)).toContain('border-spacing-0')
  })

  it('is off unless it is asked for', () => {
    renderTable({ stickyHeader: false })

    expect(classesOf(screen.getAllByRole('columnheader')[1] as Element)).not.toContain('sticky')
  })
})
