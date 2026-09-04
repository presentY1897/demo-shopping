/**
 * The Variant table's rows and the request they become
 * (QUALITY-GATES Q5 — 순수 로직 분기 100%, TASK-0114 F4 · F4b · F7).
 *
 * 「저장을 누르면 무엇이 나가는가」 is what every completion criterion about
 * this screen is really asking, and these two modules are where that is
 * decided. Asking a function directly is worth more than driving the whole form
 * to find out, because the request is the thing the API sees.
 */

import { productWithOptions } from '@shopping/api-mocks'
import type { CreateProductRequest, UpdateProductRequest } from '@shopping/shared'
import { createProductRequestSchema, updateProductRequestSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { attributeFields } from '@/lib/products/attribute-values'
import type { EditorSubmission } from '@/lib/products/product-request'
import { createRequestFrom, updateRequestFrom } from '@/lib/products/product-request'
import {
  applyBulk,
  axesOf,
  EMPTY_BULK,
  patchRow,
  rowsFor,
  rowsFromProduct,
  storedCombinationsOf,
  variantDefaultsFrom,
  variantInputsFrom,
} from '@/lib/products/variant-rows'

const STORED = productWithOptions.product

const FIELDS = attributeFields([
  { key: 'brand', label: '브랜드', type: 'TEXT', options: [], isRequired: true },
  { key: 'wool_ratio', label: '울 혼용률', type: 'NUMBER', options: [], isRequired: false },
])

function submission(overrides: Partial<EditorSubmission> = {}): EditorSubmission {
  return {
    values: {
      name: '코트',
      description: '',
      maxPurchaseQuantity: '',
      'attributes.brand': '루미에르',
    },
    fields: FIELDS,
    categoryId: 3,
    axes: [],
    rows: rowsFor([], []),
    bulk: { ...EMPTY_BULK, price: '10000' },
    images: [],
    ...overrides,
  }
}

describe('the rows an axis calls for', () => {
  it('is one row for a product with no options', () => {
    expect(rowsFor([], [])).toHaveLength(1)
    expect(rowsFor([], [])[0]?.values).toEqual([])
  })

  it('is one row per combination', () => {
    expect(rowsFor([{ name: '색상', values: ['블랙', '흰색'] }], [])).toHaveLength(2)
  })

  it('keeps what the seller typed when a choice is added to the first axis', () => {
    // Addressed by combination, not by position: adding to the first axis
    // renumbers every row after it, so an index would carry 블랙/M's price over
    // to 아이보리/M.
    const before = rowsFor(
      [
        { name: '색상', values: ['블랙'] },
        { name: '사이즈', values: ['S', 'M'] },
      ],
      [],
    )
    const priced = patchRow(before, before[1]?.key ?? '', { price: '19000' })
    const after = rowsFor(
      [
        { name: '색상', values: ['아이보리', '블랙'] },
        { name: '사이즈', values: ['S', 'M'] },
      ],
      priced,
    )

    expect(after).toHaveLength(4)
    expect(after.find((row) => row.values.join() === '블랙,M')?.price).toBe('19000')
    expect(after.find((row) => row.values.join() === '아이보리,M')?.price).toBe('')
  })

  it('forgets a row whose combination has gone', () => {
    const before = patchRow(rowsFor([{ name: '사이즈', values: ['S', 'M'] }], []), 'M', {
      price: '19000',
    })
    const after = rowsFor([{ name: '사이즈', values: ['S'] }], before)

    expect(after).toHaveLength(1)
  })
})

describe('reading a stored listing back into the table', () => {
  it('fills every cell from the server, SKU included', () => {
    const rows = rowsFromProduct(STORED)

    expect(rows).toHaveLength(12)
    // A blank SKU would be a request for a generated one, and the seller would
    // find their labelled stock renamed by a save they thought changed a price.
    expect(rows[0]?.sku).toBe(STORED.variants[0]?.sku)
    expect(rows[0]?.price).toBe(String(STORED.variants[0]?.price))
    expect(rows[0]?.variantId).toBe(STORED.variants[0]?.id)
  })

  it('shows a null cap as an empty box rather than as zero', () => {
    expect(rowsFromProduct(STORED)[0]?.maxPurchaseQuantity).toBe('')
  })

  it('recovers each combination in axis order', () => {
    const stored = storedCombinationsOf(STORED)

    expect(stored[0]?.values).toEqual(['블랙', 'S'])
    expect(stored.at(-1)?.values).toEqual(['카멜', 'XL'])
  })

  it('recovers the axes the option editor starts from', () => {
    expect(axesOf(STORED)).toEqual([
      { name: '색상', values: ['블랙', '아이보리', '카멜'] },
      { name: '사이즈', values: ['S', 'M', 'L', 'XL'] },
    ])
  })
})

describe('the bulk row', () => {
  const rows = rowsFor([{ name: '사이즈', values: ['S', 'M', 'L'] }], [])

  it('writes one value into every row', () => {
    expect(applyBulk(rows, 'price', '12000').map((row) => row.price)).toEqual([
      '12000',
      '12000',
      '12000',
    ])
  })

  it('overwrites rows that already hold a number', () => {
    // 「전체 가격 동일 적용」 is the seller saying what the price is. Skipping
    // the filled rows would leave exactly the ones they meant to correct.
    const typed = patchRow(rows, 'S', { price: '9000' })

    expect(applyBulk(typed, 'price', '12000').map((row) => row.price)).toEqual([
      '12000',
      '12000',
      '12000',
    ])
  })

  it('does nothing at all when the bulk box is empty', () => {
    const typed = patchRow(rows, 'S', { price: '9000' })

    expect(applyBulk(typed, 'price', '  ')).toBe(typed)
  })

  it('applies a purchase cap to every row (F4b)', () => {
    expect(
      applyBulk(rows, 'maxPurchaseQuantity', '2').map((row) => row.maxPurchaseQuantity),
    ).toEqual(['2', '2', '2'])
  })
})

describe('the defaults new combinations start from', () => {
  it('carries only the boxes that were filled', () => {
    expect(variantDefaultsFrom({ ...EMPTY_BULK, price: '10000' })).toEqual({ price: 10_000 })
  })

  it('carries every box that was', () => {
    expect(
      variantDefaultsFrom({
        price: '10000',
        listPrice: '14000',
        stock: '5',
        maxPurchaseQuantity: '2',
      }),
    ).toEqual({ price: 10_000, listPrice: 14_000, stock: 5, maxPurchaseQuantity: 2 })
  })

  it('reads a number that is not an integer as no answer at all', () => {
    expect(variantDefaultsFrom({ ...EMPTY_BULK, price: '10000', stock: '3.5' })).toEqual({
      price: 10_000,
    })
  })
})

describe('every row as an override', () => {
  it('sends the combination and the switch even for an untouched row', () => {
    // The table is what the seller is looking at, so what it says is what
    // should be stored. A subset would mean a cell they cleared quietly kept
    // its old value.
    expect(variantInputsFrom(rowsFor([{ name: '사이즈', values: ['S'] }], []))).toEqual([
      { optionValues: ['S'], listPrice: null, maxPurchaseQuantity: null, isActive: true },
    ])
  })

  it('spells a cleared purchase cap as null rather than leaving it out', () => {
    // Omitting it would inherit the bulk value the seller just cleared.
    const rows = applyBulk(rowsFor([{ name: '사이즈', values: ['S'] }], []), 'price', '1000')

    expect(variantInputsFrom(rows)[0]?.maxPurchaseQuantity).toBeNull()
  })

  it('carries a per-row answer', () => {
    const rows = patchRow(rowsFor([{ name: '사이즈', values: ['S'] }], []), 'S', {
      sku: ' TEE-S ',
      price: '19000',
      stock: '4',
      maxPurchaseQuantity: '2',
      isActive: false,
    })

    expect(variantInputsFrom(rows)[0]).toEqual({
      optionValues: ['S'],
      sku: 'TEE-S',
      price: 19_000,
      listPrice: null,
      stock: 4,
      maxPurchaseQuantity: 2,
      isActive: false,
    })
  })
})

describe('the create request', () => {
  it('passes the contract it will be validated against', () => {
    const request = createRequestFrom(submission(), 'DRAFT')

    // The same schema `apps/api` validates with. A field this screen invented
    // would fail here rather than as a 400 nobody could read (C1).
    expect(createProductRequestSchema.safeParse(request).success).toBe(true)
  })

  it('leaves options out for a product that has none', () => {
    // The absent form is what "이 상품은 옵션이 없다" means in the contract; an
    // empty array reads in a log as axes that were lost.
    expect(createRequestFrom(submission(), 'DRAFT').options).toBeUndefined()
  })

  it('carries the axes and one variant entry per combination', () => {
    const axes = [
      { name: '색상', values: ['블랙', '아이보리', '카멜'] },
      { name: '사이즈', values: ['S', 'M', 'L', 'XL'] },
    ]
    const request = createRequestFrom(submission({ axes, rows: rowsFor(axes, []) }), 'DRAFT')

    expect(request.options).toHaveLength(2)
    expect(request.variants).toHaveLength(12)
  })

  it('puts the purchase cap into every variant of the body (F4b)', () => {
    const axes = [{ name: '사이즈', values: ['S', 'M', 'L'] }]
    const rows = applyBulk(rowsFor(axes, []), 'maxPurchaseQuantity', '2')
    const request = createRequestFrom(submission({ axes, rows }), 'DRAFT')

    expect(request.variants?.map((variant) => variant.maxPurchaseQuantity)).toEqual([2, 2, 2])
  })

  it('drops a blank description rather than sending an empty string', () => {
    expect(createRequestFrom(submission(), 'DRAFT').description).toBeUndefined()
  })

  it('trims an axis name and its choices', () => {
    const axes = [{ name: ' 색상 ', values: [' 블랙 '] }]
    const request = createRequestFrom(submission({ axes, rows: rowsFor(axes, []) }), 'DRAFT')

    expect(request.options?.[0]).toEqual({ name: '색상', values: [{ value: '블랙' }] })
  })

  it('carries the attributes the fields ask about', () => {
    expect(createRequestFrom(submission(), 'ACTIVE').attributes).toEqual({ brand: '루미에르' })
  })

  it('carries the gallery in the order the widget answered with', () => {
    const images = [
      { url: 'https://cdn.test.invalid/a.jpg' },
      { url: 'https://cdn.test.invalid/b.jpg' },
    ]

    expect(createRequestFrom(submission({ images }), 'DRAFT').images).toEqual(images)
  })
})

describe('the update request', () => {
  const stored = submission({
    axes: axesOf(STORED),
    rows: rowsFromProduct(STORED),
    bulk: { ...EMPTY_BULK, price: '189000' },
  })

  it('passes the contract it will be validated against', () => {
    const request: UpdateProductRequest = updateRequestFrom(stored, STORED.version, 'ACTIVE')

    expect(updateProductRequestSchema.safeParse(request).success).toBe(true)
  })

  it('carries the version it was written against', () => {
    expect(updateRequestFrom(stored, 3, 'ACTIVE').version).toBe(3)
  })

  it('spells a cleared description and cap as null rather than omitting them', () => {
    // A partial request would mean a field the seller cleared kept its old
    // value, which looks exactly like a save that did not happen.
    const request = updateRequestFrom(stored, 3, 'ACTIVE')

    expect(request.description).toBeNull()
    expect(request.maxPurchaseQuantity).toBeNull()
  })

  it('sends every stored row with the stock the table is showing (F7)', () => {
    const request = updateRequestFrom(stored, 3, 'ACTIVE')

    expect(request.variants).toHaveLength(12)
    expect(request.variants?.map((variant) => variant.stock)).toEqual(
      STORED.variants.map((variant) => variant.stock),
    )
  })

  it('carries a choice the seller added, without changing the axes', () => {
    const axes = [
      { name: '색상', values: ['블랙', '아이보리', '카멜'] },
      { name: '사이즈', values: ['S', 'M', 'L', 'XL', 'XXL'] },
    ]
    const request = updateRequestFrom(
      { ...stored, axes, rows: rowsFor(axes, rowsFromProduct(STORED)) },
      3,
      'ACTIVE',
    )

    expect(request.options?.map((option) => option.name)).toEqual(['색상', '사이즈'])
    expect(request.variants).toHaveLength(15)
  })

  it('is a create request away from a listing with no options', () => {
    const request: CreateProductRequest = createRequestFrom(submission(), 'DRAFT')

    expect(request.variants).toHaveLength(1)
  })
})
