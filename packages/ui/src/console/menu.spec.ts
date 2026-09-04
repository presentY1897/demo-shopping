/**
 * Which menu entry a path belongs to.
 *
 * Pure logic, so it is checked by input and output — every branch of the rule
 * in TASK-0019 4.8, including the two that only ever go wrong once: the root
 * lighting up everywhere, and source order deciding a nested match.
 */

import { describe, expect, it } from 'vitest'

import {
  activeConsoleMenuItem,
  consoleMenuItemAt,
  consoleMenuItems,
  filterConsoleMenu,
  isConsoleMenuItemActive,
  type ConsoleMenu,
} from './menu'

const MENU: ConsoleMenu = [
  { id: 'overview', items: [{ href: '/', label: 'dashboard' }] },
  {
    id: 'sales',
    label: 'sales',
    items: [
      { href: '/products', label: 'products' },
      { href: '/orders', label: 'orders' },
      { href: '/orders/returns', label: 'returns' },
    ],
  },
]

describe('consoleMenuItems', () => {
  it('flattens the sections in menu order', () => {
    expect(consoleMenuItems(MENU).map((item) => item.href)).toEqual([
      '/',
      '/products',
      '/orders',
      '/orders/returns',
    ])
  })
})

describe('isConsoleMenuItemActive', () => {
  it('matches a path exactly', () => {
    expect(isConsoleMenuItemActive('/products', '/products')).toBe(true)
  })

  it('matches a path inside the section', () => {
    expect(isConsoleMenuItemActive('/products', '/products/new')).toBe(true)
  })

  it('does not match a sibling that merely starts with the same letters', () => {
    // `/products-archive` is not inside `/products`, and a bare `startsWith`
    // would say it is.
    expect(isConsoleMenuItemActive('/products', '/products-archive')).toBe(false)
  })

  it('lights the root only on the root', () => {
    expect(isConsoleMenuItemActive('/', '/')).toBe(true)
    expect(isConsoleMenuItemActive('/', '/orders')).toBe(false)
  })
})

describe('activeConsoleMenuItem', () => {
  it('finds the section a sub-route belongs to', () => {
    expect(activeConsoleMenuItem(MENU, '/products/new')?.label).toBe('products')
  })

  it('prefers the longest match, whatever the menu order is', () => {
    // Both orders, because "the longest wins" is only worth anything if it does
    // not quietly mean "the last one wins".
    const reversed: ConsoleMenu = [
      { id: 'sales', items: [...MENU[1]!.items].reverse() },
      ...MENU.slice(0, 1),
    ]

    expect(activeConsoleMenuItem(MENU, '/orders/returns/3')?.label).toBe('returns')
    expect(activeConsoleMenuItem(reversed, '/orders/returns/3')?.label).toBe('returns')
  })

  it('returns the dashboard on the root', () => {
    expect(activeConsoleMenuItem(MENU, '/')?.label).toBe('dashboard')
  })

  it('returns nothing for a path outside the menu', () => {
    expect(activeConsoleMenuItem(MENU, '/components')).toBeNull()
  })
})

describe('consoleMenuItemAt', () => {
  it('reads a title out of the definition instead of repeating it', () => {
    expect(consoleMenuItemAt(MENU, '/orders')?.label).toBe('orders')
  })

  it('answers nothing when the path is not a menu entry', () => {
    expect(consoleMenuItemAt(MENU, '/orders/returns/3')).toBeNull()
  })
})

describe('filterConsoleMenu', () => {
  const GATED: ConsoleMenu = [
    { id: 'overview', items: [{ href: '/', label: 'dashboard' }] },
    {
      id: 'money',
      label: 'settlement',
      items: [
        { href: '/settlements', label: 'settlements', permission: 'settlement.read' },
        { href: '/coupons', label: 'coupons', permission: 'coupon.read' },
      ],
    },
  ]

  it('keeps an entry that names no permission', () => {
    const filtered = filterConsoleMenu(GATED, () => false)

    expect(consoleMenuItems(filtered).map((item) => item.href)).toEqual(['/'])
  })

  it('drops the entries the reader may not reach', () => {
    const filtered = filterConsoleMenu(GATED, (permission) => permission === 'coupon.read')

    expect(consoleMenuItems(filtered).map((item) => item.href)).toEqual(['/', '/coupons'])
  })

  it('drops a section once it has nothing left, rather than leaving a bare heading', () => {
    const filtered = filterConsoleMenu(GATED, () => false)

    expect(filtered.map((section) => section.id)).toEqual(['overview'])
  })

  it('changes nothing when every permission is held', () => {
    expect(filterConsoleMenu(GATED, () => true)).toEqual(GATED)
  })
})
