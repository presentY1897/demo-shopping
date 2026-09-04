/**
 * The seller console's double, driven through the real client.
 *
 * Every check here is one TASK-0116 names as a completion criterion, asserted
 * at the level where it is actually decidable: paging cannot repeat a row (F5),
 * an adjustment that would go below zero is refused **and changes nothing**
 * (F9), a bulk change of five ids answers with five rows (F4). A screen spec
 * can only observe these through the mock, so if the mock is wrong the screen
 * spec passes while the screen is wrong.
 */

import type {
  ProductBulkStatusResponse,
  ProductResponse,
  SellerProductListResponse,
  SellerVariantListResponse,
  StockAdjustResponse,
  StockLedgerResponse,
} from '@shopping/shared'
import {
  createApiClient,
  isApiClientError,
  LOW_STOCK_THRESHOLD,
  productBulkStatusResponseSchema,
  productResponseSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
  stockAdjustResponseSchema,
  stockLedgerResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { sellerConsoleSnapshot } from './handlers/seller-console'
import { SELLER_PRODUCT_COUNT, productId, variantId } from './handlers/seller-console-catalogue'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

function list(search = ''): Promise<SellerProductListResponse> {
  return client.request({
    path: `/seller/products${search}`,
    schema: sellerProductListResponseSchema,
  })
}

function variantsOf(id: string): Promise<SellerVariantListResponse> {
  return client.request({
    path: `/seller/products/${id}/variants`,
    schema: sellerVariantListResponseSchema,
  })
}

function adjust(
  id: string,
  body: { delta: number; type: 'INBOUND' | 'ADJUST'; reason?: string },
): Promise<StockAdjustResponse> {
  return client.request({
    path: `/variants/${id}/stock-adjustments`,
    method: 'POST',
    body,
    schema: stockAdjustResponseSchema,
  })
}

describe('the list', () => {
  it('answers a first page and a cursor', async () => {
    const page = await list()

    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBe(page.items[19]?.id)
  })

  it('walks all 100 rows with no duplicate and no gap (F5)', async () => {
    const seen: string[] = []
    let cursor: string | null = null

    for (let page = 0; page < 10; page += 1) {
      const answer: SellerProductListResponse = await list(
        cursor === null ? '?limit=10' : `?limit=10&cursor=${cursor}`,
      )

      seen.push(...answer.items.map((item) => item.id))
      cursor = answer.nextCursor
      if (cursor === null) break
    }

    expect(seen).toHaveLength(SELLER_PRODUCT_COUNT)
    expect(new Set(seen).size).toBe(SELLER_PRODUCT_COUNT)
  })

  it('filters by status', async () => {
    const page = await list('?status=DRAFT&limit=100')

    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((item) => item.status === 'DRAFT')).toBe(true)
  })

  it('filters by 품절 and 품절 임박, as the server defines them (F3 · F10)', async () => {
    const out = await list('?stock=out&limit=100')
    const low = await list('?stock=low&limit=100')

    expect(out.items.every((item) => item.totalStock === 0)).toBe(true)
    expect(low.items.every((item) => item.isLowStock)).toBe(true)
    // The two are disjoint: 품절 is not 임박, which is what makes them separate
    // filters rather than one slider.
    expect(low.items.some((item) => item.totalStock === 0)).toBe(false)
  })

  it('puts the badge on the threshold and not one above it (F10)', async () => {
    const page = await list('?limit=100')
    const atThreshold = page.items.find((item) => item.totalStock === LOW_STOCK_THRESHOLD)
    const justAbove = page.items.find((item) => item.totalStock === LOW_STOCK_THRESHOLD + 1)

    expect(atThreshold?.isLowStock).toBe(true)
    expect(justAbove?.isLowStock).toBe(false)
  })

  it('searches by name', async () => {
    const page = await list('?q=002&limit=100')

    expect(page.items.every((item) => item.name.includes('002'))).toBe(true)
  })
})

describe('bulk status (F4)', () => {
  it('changes every id it was given, in one request', async () => {
    const ids = [productId(0), productId(1), productId(2), productId(4), productId(5)]
    const answer: ProductBulkStatusResponse = await client.request({
      path: '/seller/products/status',
      method: 'POST',
      body: { productIds: ids, status: 'DRAFT' },
      schema: productBulkStatusResponseSchema,
    })

    expect(answer.items.map((item) => item.id)).toEqual(ids)
    expect(answer.items.every((item) => item.status === 'DRAFT')).toBe(true)

    const page = await list('?limit=100')

    expect(
      page.items.filter((item) => ids.includes(item.id)).every((i) => i.status === 'DRAFT'),
    ).toBe(true)
  })
})

describe('stock adjustment', () => {
  it('applies a delta and answers the balance after it (F2)', async () => {
    const before = (await variantsOf(productId(3))).variants[0]

    if (before === undefined) throw new Error('조합이 없습니다.')

    const answer = await adjust(before.id, { delta: 5, type: 'INBOUND', reason: '입고' })

    expect(answer.balanceAfter).toBe(before.stock + 5)
    expect(answer.delta).toBe(5)
  })

  it('refuses to go below zero and leaves the number alone (F9)', async () => {
    const before = (await variantsOf(productId(0))).variants[0]

    if (before === undefined) throw new Error('조합이 없습니다.')

    const error = await adjust(before.id, { delta: -1, type: 'ADJUST' }).catch(
      (thrown: unknown) => thrown,
    )

    expect(isApiClientError(error) && error.status).toBe(400)
    // The screen must be able to show the refusal on the field that caused it.
    expect(isApiClientError(error) && error.details[0]).toMatchObject({ field: 'delta' })

    const after = (await variantsOf(productId(0))).variants[0]

    expect(after?.stock).toBe(before.stock)
  })

  it('writes the entry that explains the number (F7)', async () => {
    const variant = (await variantsOf(productId(3))).variants[0]

    if (variant === undefined) throw new Error('조합이 없습니다.')

    await adjust(variant.id, { delta: 3, type: 'ADJUST', reason: '실사 조정' })

    const ledger: StockLedgerResponse = await client.request({
      path: `/variants/${variant.id}/ledger`,
      schema: stockLedgerResponseSchema,
    })

    expect(ledger.entries[0]).toMatchObject({ type: 'ADJUST', quantity: 3, reason: '실사 조정' })
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'INBOUND', seq: 1 })
    expect(ledger.variant.stock).toBe(ledger.entries[0]?.balanceAfter)
  })

  it('moves the listing total with the combination', async () => {
    // R2: the list column and the stock screen must not disagree after a change.
    const before = (await list('?limit=100')).items.find((item) => item.id === productId(3))
    const variant = (await variantsOf(productId(3))).variants[0]

    if (before === undefined || variant === undefined) throw new Error('상품이 없습니다.')

    await adjust(variant.id, { delta: 7, type: 'INBOUND' })

    const after = (await list('?limit=100')).items.find((item) => item.id === productId(3))

    expect(after?.totalStock).toBe(before.totalStock + 7)
  })
})

describe('duplication (F6)', () => {
  it('answers a copy that is always a draft', async () => {
    const answer: ProductResponse = await client.request({
      path: `/seller/products/${productId(0)}/duplicate`,
      method: 'POST',
      schema: productResponseSchema,
    })

    expect(answer.product.status).toBe('DRAFT')
    expect(answer.product.name).toContain('복사본')
  })

  it('adds the copy to the catalogue', async () => {
    // Counted from the store rather than from a page: `PRODUCT_LIST_MAX_LIMIT`
    // is 100, so the 101st listing is exactly the one a single page cannot show.
    const before = sellerConsoleSnapshot().length

    await client.request({
      path: `/seller/products/${productId(1)}/duplicate`,
      method: 'POST',
      schema: productResponseSchema,
    })

    expect(sellerConsoleSnapshot()).toHaveLength(before + 1)
    expect(sellerConsoleSnapshot().at(-1)).toMatchObject({ status: 'DRAFT' })
  })
})

describe('the store resets between specs', () => {
  it('is back to a hundred untouched listings', async () => {
    // The previous describe duplicated two. If this fails, every count in every
    // screen spec depends on the order the files happened to run in.
    const page = await list('?limit=100')

    expect(page.items).toHaveLength(SELLER_PRODUCT_COUNT)
    expect(page.items[0]?.totalStock).toBe(0)
    expect(variantId(0)).toContain('2a710000')
  })
})
