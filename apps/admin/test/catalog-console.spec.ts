/**
 * 전체 상품·주문 화면의 순수 판단 (TASK-0095).
 *
 * 여기 있는 것은 전부 **틀려도 조용한** 것들이다 — 초안 옆의 「내리기」는 눌리기
 * 전까지 멀쩡해 보이고, 뒤집힌 기간은 200 과 빈 목록으로 답이 온다. 그래서
 * `vitest.config.mjs` 가 세 파일을 분기 100% 로 잡고 있고, 이 파일이 그 값을 채운다.
 */

import { ApiClientError, apiFailure } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  catalogApprovedAt,
  catalogCount,
  catalogDateTime,
  catalogMoney,
  catalogPrice,
} from '@/lib/catalog/format'
import type { OrderFilters } from '@/lib/catalog/order-console'
import {
  EMPTY_ORDER_FILTERS,
  orderIssuesOf,
  orderQueryOf,
  ordersNarrowed,
} from '@/lib/catalog/order-console'
import type { ProductFilters } from '@/lib/catalog/product-console'
import {
  categoryChoices,
  EMPTY_PRODUCT_FILTERS,
  moderationActionFor,
  productQueryOf,
  productRefusalOf,
  productsNarrowed,
} from '@/lib/catalog/product-console'

import { CATALOG_CATEGORY_ID, CATALOG_SELLER_ID, categoryTree } from './support/catalog'

const BUYER_ID = '019596e0-0041-7000-8000-000000000001'

function productFilters(overrides: Partial<ProductFilters> = {}): ProductFilters {
  return { ...EMPTY_PRODUCT_FILTERS, ...overrides }
}

function orderFilters(overrides: Partial<OrderFilters> = {}): OrderFilters {
  return { ...EMPTY_ORDER_FILTERS, ...overrides }
}

/** 서버가 답한 실패 하나. `createApiClient` 가 만드는 모양 그대로. */
function refusal(status: number, code: string): ReturnType<typeof apiFailure> {
  return apiFailure(
    new ApiClientError({
      kind: 'http',
      message: 'for the log',
      status,
      body: { error: { code, message: '서버 문장', details: [], requestId: 'req-1' } },
    }),
  )
}

describe('상품 필터 → 질의', () => {
  it('sends nothing when nothing is narrowed', () => {
    expect(productQueryOf(EMPTY_PRODUCT_FILTERS)).toEqual({})
  })

  it('carries each axis once it is chosen', () => {
    expect(
      productQueryOf(
        productFilters({
          sellerId: CATALOG_SELLER_ID,
          categoryId: CATALOG_CATEGORY_ID,
          status: 'SUSPENDED',
        }),
      ),
    ).toEqual({
      sellerId: CATALOG_SELLER_ID,
      categoryId: CATALOG_CATEGORY_ID,
      status: 'SUSPENDED',
    })
  })

  it('knows an empty list is "nothing at all" until something is narrowed', () => {
    expect(productsNarrowed(EMPTY_PRODUCT_FILTERS)).toBe(false)
    expect(productsNarrowed(productFilters({ sellerId: CATALOG_SELLER_ID }))).toBe(true)
    expect(productsNarrowed(productFilters({ categoryId: 1 }))).toBe(true)
    expect(productsNarrowed(productFilters({ status: 'DRAFT' }))).toBe(true)
  })
})

describe('카테고리 목록', () => {
  /**
   * 이름은 가지마다 겹칠 수 있다 — 「여성 › 아우터」와 「남성 › 아우터」. 이어 붙이지
   * 않으면 셀렉트에 같은 글자가 두 줄 서고, 찍어서 고른 조건이 목록을 조용히 다른
   * 것으로 바꾼다.
   */
  it('joins each name onto its ancestors', () => {
    const choices = categoryChoices(categoryTree().nodes)

    expect(choices.map((choice) => choice.label)).toEqual(['여성', '여성 › 아우터'])
    expect(choices[1]?.id).toBe(CATALOG_CATEGORY_ID)
  })

  it('answers with nothing for an empty forest', () => {
    expect(categoryChoices([])).toEqual([])
  })
})

describe('내릴 수 있는 상태 (4.2)', () => {
  /**
   * `apps/api` 의 `admin-catalog.service.ts` 를 비추는 거울이다. 닿지 않은 분기 하나가
   * 초안 옆에 「내리기」를 그리고, 그 버튼은 눌려도 409 를 받는다.
   */
  it('offers 내리기 only for a listing that is on sale', () => {
    expect(moderationActionFor('ACTIVE')).toBe('hide')
  })

  it('offers 다시 올리기 only for one that was pulled', () => {
    expect(moderationActionFor('SUSPENDED')).toBe('restore')
  })

  it('offers nothing for a draft or a listing the seller took down themselves', () => {
    expect(moderationActionFor('DRAFT')).toBeNull()
    expect(moderationActionFor('INACTIVE')).toBeNull()
  })
})

describe('상품 쓰기의 거절', () => {
  /** 카탈로그의 「권한이 없어요」는 **어느 자격이 어떻게 좁혀져 있는지**를 말하지 못한다. */
  it('names the 403 a demo administrator gets on a real account listing (F8)', () => {
    expect(productRefusalOf(refusal(403, 'FORBIDDEN'))).toBe('forbidden')
  })

  it('names a vanished product, whose next action is a re-read', () => {
    expect(productRefusalOf(refusal(404, 'NOT_FOUND'))).toBe('stale')
  })

  /**
   * 409 는 **카탈로그가 이미 문장을 갖고 있다** (`PRODUCT_NOT_MODERATABLE`). 여기서
   * 되풀이하면 같은 거절에 두 벌의 한국어가 생긴다.
   */
  it('leaves 409 to the catalog, and says nothing about a dead network', () => {
    expect(productRefusalOf(refusal(409, 'PRODUCT_NOT_MODERATABLE'))).toBeNull()
    expect(productRefusalOf({ kind: 'transport', reason: 'network' })).toBeNull()
  })
})

describe('주문 필터 → 질의', () => {
  it('sends nothing when nothing is narrowed', () => {
    expect(orderQueryOf(EMPTY_ORDER_FILTERS)).toEqual({})
  })

  /**
   * 주문번호는 정확히 일치로 찾는다 (4.3). 붙여 넣기에 딸려 온 공백 하나가 그 일치를
   * 어긋나게 하면, 그것은 **아무 주문도 없는 것**이 된다.
   */
  it('trims the order number before it goes out', () => {
    expect(orderQueryOf(orderFilters({ orderNumber: '  20260906-000123 ' })).orderNumber).toBe(
      '20260906-000123',
    )
  })

  it('carries every axis once it is set', () => {
    expect(
      orderQueryOf(
        orderFilters({
          orderNumber: 'A-1',
          buyerId: BUYER_ID,
          sellerId: CATALOG_SELLER_ID,
          from: '2026-09-01',
          to: '2026-09-07',
        }),
      ),
    ).toEqual({
      orderNumber: 'A-1',
      buyerId: BUYER_ID,
      sellerId: CATALOG_SELLER_ID,
      from: '2026-09-01',
      to: '2026-09-07',
    })
  })

  it('treats whitespace as "not narrowed" for both text fields', () => {
    const filters = orderFilters({ buyerId: '   ', orderNumber: '  ' })

    expect(orderQueryOf(filters)).toEqual({})
    expect(ordersNarrowed(filters)).toBe(false)
  })

  it('is narrowed by any one of the five', () => {
    expect(ordersNarrowed(EMPTY_ORDER_FILTERS)).toBe(false)
    expect(ordersNarrowed(orderFilters({ orderNumber: 'A-1' }))).toBe(true)
    expect(ordersNarrowed(orderFilters({ buyerId: BUYER_ID }))).toBe(true)
    expect(ordersNarrowed(orderFilters({ sellerId: CATALOG_SELLER_ID }))).toBe(true)
    expect(ordersNarrowed(orderFilters({ from: '2026-09-01' }))).toBe(true)
    expect(ordersNarrowed(orderFilters({ to: '2026-09-07' }))).toBe(true)
  })
})

describe('보내기 전에 되돌려보내는 것', () => {
  it('lets an empty form through', () => {
    expect(orderIssuesOf(EMPTY_ORDER_FILTERS)).toEqual([])
  })

  it('refuses a buyer id that is not one, and accepts one that is', () => {
    expect(orderIssuesOf(orderFilters({ buyerId: 'hong' }))).toEqual(['buyerId'])
    expect(orderIssuesOf(orderFilters({ buyerId: BUYER_ID }))).toEqual([])
  })

  /**
   * 뒤집힌 기간은 서버가 **200 과 빈 목록**으로 답한다. 아무도 그것이 조건 탓이라고
   * 말해 주지 않고, CS 는 그 빈 목록을 「그런 주문 없음」으로 읽는다.
   */
  it('refuses a range whose start is after its end', () => {
    expect(orderIssuesOf(orderFilters({ from: '2026-09-07', to: '2026-09-01' }))).toEqual(['range'])
  })

  it('leaves a half-open range alone — it cannot be reversed', () => {
    expect(orderIssuesOf(orderFilters({ from: '2026-09-07' }))).toEqual([])
    expect(orderIssuesOf(orderFilters({ to: '2026-09-01' }))).toEqual([])
    expect(orderIssuesOf(orderFilters({ from: '2026-09-01', to: '2026-09-01' }))).toEqual([])
  })

  it('reports both at once', () => {
    expect(
      orderIssuesOf(orderFilters({ buyerId: 'hong', from: '2026-09-07', to: '2026-09-01' })),
    ).toEqual(['buyerId', 'range'])
  })
})

describe('전체 상품·주문의 서식', () => {
  /**
   * 조합이 없는 초안의 `minPrice` 는 `null` 이다. 0원으로 그리면 **공짜로 파는
   * 상품**이 목록에 서고, 그것이 관리자가 가장 먼저 눌러 볼 줄이다.
   */
  it('says nothing rather than 0원 for a listing with no price yet', () => {
    expect(catalogPrice(null)).toBeNull()
    expect(catalogPrice(189_000)).toContain('189,000')
  })

  it('says nothing rather than a blank for a payment that was never approved', () => {
    expect(catalogApprovedAt(null)).toBeNull()
    expect(catalogApprovedAt('2026-09-06T02:00:10.000Z')).toBe(
      catalogDateTime('2026-09-06T02:00:10.000Z'),
    )
  })

  it('writes money and counts', () => {
    expect(catalogMoney(189_000)).toContain('189,000')
    expect(catalogCount(1234)).toBe('1,234')
  })
})
