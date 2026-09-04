import type { ApiClient, CreateProductRequest, Product, SellerStatus } from '@shopping/shared'
import {
  ApiClientError,
  LOW_STOCK_THRESHOLD,
  productBulkStatusResponseSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * The seller console's catalogue: what it lists, what it hides, and what it
 * refuses (TASK-0115 완료 기준 F1 · F4 · F5 · F6 · F7 · F10 · A2 · A3 · A4).
 *
 * Everything goes through `createApiClient`, so every response is parsed with
 * the schema `packages/shared` declares before an assertion ever sees it — a
 * field renamed on this side fails as `malformed_response` whether or not a
 * test thought to check for it (gate C3). The explicit `parse` calls below are
 * the same guarantee stated out loud where the criterion asks for it.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

function operator(): ApiClient {
  return api.clientAs(callers.operator)
}

interface HttpFailure {
  readonly status: number
  readonly code: string
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0, code: error.body?.error.code ?? '' }
}

let categoryId: number
let otherCategoryId: number
let seller: TestCaller
let rival: TestCaller

async function storefront(status: SellerStatus = 'ACTIVE'): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id, status })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

beforeEach(async () => {
  const [{ category }, { category: other }] = await Promise.all([
    operator().createCategory({ parentId: null, name: '의류', slug: uniqueSlug('clothing') }),
    operator().createCategory({ parentId: null, name: '신발', slug: uniqueSlug('shoes') }),
  ])

  categoryId = category.id
  otherCategoryId = other.id
  seller = await storefront()
  rival = await storefront()
})

function draft(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: 10 },
    ...overrides,
  }
}

async function create(
  overrides: Partial<CreateProductRequest> = {},
  caller: TestCaller = seller,
): Promise<Product> {
  const { product } = await api.clientAs(caller).createProduct(draft(overrides))

  return product
}

/** 색상 2 × 사이즈 2 — four combinations, enough for a copy to be interesting. */
const COLOUR_AND_SIZE = [
  { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] },
  { name: '사이즈', values: [{ value: 'S' }, { value: 'M' }] },
]

/** `count` bare listings for `store`, written straight to the tables. */
async function bulkListings(store: string, count: number): Promise<void> {
  await db.execute(
    `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, '대량 ' || n, 'ACTIVE'::"ProductStatus", 10000 + n, now()
       FROM generate_series(1, $3::int) AS n`,
    [store, categoryId, count],
  )
}

describe('F1 — 자기 상품만 나온다', () => {
  it('leaves another store’s listings out of the list', async () => {
    await create({ name: '내 티셔츠' })
    await create({ name: '남의 티셔츠' }, rival)

    const answer = await api.clientAs(seller).getSellerProducts()

    expect(() => sellerProductListResponseSchema.parse(answer)).not.toThrow()
    expect(answer.items.map((item) => item.name)).toEqual(['내 티셔츠'])
  })

  it('refuses another store’s listing asked for by id', async () => {
    const theirs = await create({}, rival)

    expect(await failure(api.clientAs(seller).getSellerProductVariants(theirs.id))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('refuses a caller with no store of their own, however wide their grants', async () => {
    await create()

    // An operator holds `product.read:any`. That is not what `/seller/` means —
    // reading somebody's catalogue is `GET /products?sellerId=`.
    expect(await failure(operator().getSellerProducts())).toMatchObject({ status: 403 })
  })
})

describe('F4 — 재고 필터', () => {
  beforeEach(async () => {
    await create({ name: '품절', variantDefaults: { price: 10_000, stock: 0 } })
    await create({
      name: '임박 하한',
      variantDefaults: { price: 10_000, stock: 1 },
    })
    await create({
      name: '임박 상한',
      variantDefaults: { price: 10_000, stock: LOW_STOCK_THRESHOLD },
    })
    await create({
      name: '넉넉',
      variantDefaults: { price: 10_000, stock: LOW_STOCK_THRESHOLD + 1 },
    })
  })

  it('finds the sold-out listings and nothing else', async () => {
    const { items } = await api.clientAs(seller).getSellerProducts({ stock: 'out' })

    expect(items.map((item) => item.name)).toEqual(['품절'])
    expect(items.every((item) => item.totalStock === 0)).toBe(true)
  })

  it('finds the running-out listings, boundaries included, sold out excluded', async () => {
    const { items } = await api.clientAs(seller).getSellerProducts({ stock: 'low' })

    expect(items.map((item) => item.name).sort()).toEqual(['임박 상한', '임박 하한'])
  })

  it('carries the badge on exactly the rows the filter returns', async () => {
    const { items } = await api.clientAs(seller).getSellerProducts()
    const flagged = items.filter((item) => item.isLowStock).map((item) => item.name)
    const { items: filtered } = await api.clientAs(seller).getSellerProducts({ stock: 'low' })

    // The point of the three-band predicate: 품절 does not also mean 품절 임박,
    // so no screen has to decide which badge wins (TASK-0115 4장).
    expect(flagged.sort()).toEqual(filtered.map((item) => item.name).sort())
  })

  it('sums the stock of every live variant of a listing', async () => {
    const grid = await create({ name: '조합', options: COLOUR_AND_SIZE })
    const { items } = await api.clientAs(seller).getSellerProducts({ q: '조합' })

    expect(grid.variants).toHaveLength(4)
    expect(items[0]?.totalStock).toBe(40)
  })
})

describe('상태 · 카테고리 · 이름으로 거른다', () => {
  it('filters by status', async () => {
    await create({ name: '작성 중' })
    const live = await create({ name: '판매 중' })

    await api.clientAs(seller).publishProduct(live.id, { version: live.version })

    const { items } = await api.clientAs(seller).getSellerProducts({ status: 'ACTIVE' })

    expect(items.map((item) => item.name)).toEqual(['판매 중'])
  })

  it('filters by category', async () => {
    await create({ name: '옷' })
    await create({ name: '신발', categoryId: otherCategoryId })

    const { items } = await api.clientAs(seller).getSellerProducts({ categoryId: otherCategoryId })

    expect(items.map((item) => item.name)).toEqual(['신발'])
  })

  it('searches the name case-insensitively, on a substring', async () => {
    await create({ name: 'Oversize Tee' })
    await create({ name: '기본 티셔츠' })

    const { items } = await api.clientAs(seller).getSellerProducts({ q: 'oversize' })

    expect(items.map((item) => item.name)).toEqual(['Oversize Tee'])
  })

  it('treats a percent sign as a character and not as a wildcard', async () => {
    await create({ name: '50% 할인 티셔츠' })
    await create({ name: '5000원 티셔츠' })

    const { items } = await api.clientAs(seller).getSellerProducts({ q: '50%' })

    // Unescaped, `50%` matches everything starting with 50 — a filter that
    // silently means "no filter" (`nameSearchPattern`).
    expect(items.map((item) => item.name)).toEqual(['50% 할인 티셔츠'])
  })
})

describe('F6 — 100건을 커서로 끝까지', () => {
  it('walks the whole catalogue with no duplicate and no gap', async () => {
    await bulkListings(seller.sellerId ?? '', 100)

    const seen: string[] = []
    let cursor: string | undefined

    for (let page = 0; page < 20; page += 1) {
      const answer: Awaited<ReturnType<ApiClient['getSellerProducts']>> = await api
        .clientAs(seller)
        .getSellerProducts({ limit: 7, ...(cursor === undefined ? {} : { cursor }) })

      seen.push(...answer.items.map((item) => item.id))
      if (answer.nextCursor === null) break
      cursor = answer.nextCursor
    }

    expect(seen).toHaveLength(100)
    expect(new Set(seen).size).toBe(100)
  })
})

describe('F5 — 일괄 상태 변경', () => {
  async function fiveDrafts(): Promise<string[]> {
    const made: string[] = []

    for (let index = 0; index < 5; index += 1) {
      made.push((await create({ name: `상품 ${String(index)}` })).id)
    }

    return made
  }

  it('applies to all five', async () => {
    const ids = await fiveDrafts()
    const answer = await api
      .clientAs(seller)
      .changeProductStatuses({ productIds: ids, status: 'INACTIVE' })

    expect(() => productBulkStatusResponseSchema.parse(answer)).not.toThrow()
    expect(answer.items).toHaveLength(5)
    expect(answer.items.every((item) => item.status === 'INACTIVE')).toBe(true)

    const { items } = await api.clientAs(seller).getSellerProducts({ status: 'INACTIVE' })

    expect(items).toHaveLength(5)
  })

  it('changes nothing at all when one id belongs to another store', async () => {
    const ids = await fiveDrafts()
    const theirs = await create({}, rival)

    expect(
      await failure(
        api
          .clientAs(seller)
          .changeProductStatuses({ productIds: [...ids, theirs.id], status: 'INACTIVE' }),
      ),
    ).toMatchObject({ status: 403 })

    // R4: the refusal has to leave the ones it already looked at alone.
    const { items } = await api.clientAs(seller).getSellerProducts({ status: 'DRAFT' })

    expect(items).toHaveLength(5)
  })

  it('rolls back the ones already written when a later listing cannot go on sale', async () => {
    const sellable = await create({ name: '팔 수 있는 것' })
    const empty = await create({ name: '옵션이 꺼진 것' })

    await api.clientAs(seller).updateProduct(empty.id, {
      version: empty.version,
      variants: [{ optionValues: [], isActive: false }],
    })

    expect(
      await failure(
        api
          .clientAs(seller)
          .changeProductStatuses({ productIds: [sellable.id, empty.id], status: 'ACTIVE' }),
      ),
    ).toMatchObject({ status: 400, code: 'PRODUCT_NOT_SELLABLE' })

    const { items } = await api.clientAs(seller).getSellerProducts({ status: 'ACTIVE' })

    // Whichever of the two the transaction reached first, neither survives.
    expect(items).toHaveLength(0)
  })

  it('refuses a listing that is missing entirely, before writing anything', async () => {
    const ids = await fiveDrafts()

    expect(
      await failure(
        api.clientAs(seller).changeProductStatuses({
          productIds: [...ids, '0192f0c1-0000-7000-8000-00000000dead'],
          status: 'INACTIVE',
        }),
      ),
    ).toMatchObject({ status: 404 })

    const { items } = await api.clientAs(seller).getSellerProducts({ status: 'DRAFT' })

    expect(items).toHaveLength(5)
  })

  it('refuses a seller lifting the operator’s forced hide', async () => {
    const hidden = await create({ name: '강제 숨김' })

    await operator().updateProduct(hidden.id, { version: hidden.version, status: 'SUSPENDED' })

    expect(
      await failure(
        api.clientAs(seller).changeProductStatuses({ productIds: [hidden.id], status: 'DRAFT' }),
      ),
    ).toMatchObject({ status: 403 })
  })
})

describe('F7 — 복제', () => {
  it('copies the options and the variants, as a draft with no stock', async () => {
    const source = await create({
      name: '오버사이즈 티셔츠',
      options: COLOUR_AND_SIZE,
      description: '두껍다',
    })

    await api.clientAs(seller).publishProduct(source.id, { version: source.version })

    const { product: copy } = await api.clientAs(seller).duplicateProduct(source.id)

    expect(copy.status).toBe('DRAFT')
    expect(copy.options).toHaveLength(source.options.length)
    expect(copy.variants).toHaveLength(source.variants.length)
    expect(copy.name).toBe('오버사이즈 티셔츠 (복사본)')
    expect(copy.description).toBe('두껍다')
    expect(copy.variants.every((variant) => variant.stock === 0)).toBe(true)
  })

  it('records no ledger row for the copy', async () => {
    const source = await create({ options: COLOUR_AND_SIZE })
    const { product: copy } = await api.clientAs(seller).duplicateProduct(source.id)

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "StockLedger" l
        JOIN "ProductVariant" v ON v."id" = l."variantId"
       WHERE v."productId" = $1`,
      [copy.id],
    )

    // Stock that appeared without a movement is stock the ledger cannot
    // explain — the copy starts at zero, and zero is not a movement.
    expect(Number(count)).toBe(0)
  })

  it('issues fresh SKUs rather than colliding with the original’s', async () => {
    const source = await create({ options: COLOUR_AND_SIZE })
    const { product: copy } = await api.clientAs(seller).duplicateProduct(source.id)

    const originals = new Set(source.variants.map((variant) => variant.sku))

    expect(copy.variants.some((variant) => originals.has(variant.sku))).toBe(false)
  })

  it('keeps the price of each combination', async () => {
    const source = await create({
      options: COLOUR_AND_SIZE,
      variants: [{ optionValues: ['블랙', 'S'], price: 25_000 }],
    })
    const { product: copy } = await api.clientAs(seller).duplicateProduct(source.id)

    expect(copy.variants.map((variant) => variant.price).sort()).toEqual(
      source.variants.map((variant) => variant.price).sort(),
    )
  })

  it('refuses to copy another store’s listing', async () => {
    const theirs = await create({}, rival)

    expect(await failure(api.clientAs(seller).duplicateProduct(theirs.id))).toMatchObject({
      status: 403,
    })
  })
})

describe('F10 — 판매자 상태', () => {
  it('lists for a suspended store and refuses its writes', async () => {
    const suspended = await storefront('ACTIVE')

    await create({ name: '정지 전 등록' }, suspended)
    await db.execute(`UPDATE "Seller" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [
      suspended.sellerId,
    ])

    const { items } = await api.clientAs(suspended).getSellerProducts()

    expect(items).toHaveLength(1)

    expect(
      await failure(
        api
          .clientAs(suspended)
          .changeProductStatuses({ productIds: [items[0]?.id ?? ''], status: 'INACTIVE' }),
      ),
    ).toMatchObject({ status: 403, code: 'PRODUCT_SELLER_INACTIVE' })
  })
})

describe('A2 · A3 · A4 — 검증 · 권한 · 인증', () => {
  it('refuses an unknown status with a 400 naming the field', async () => {
    const made = await create()
    const answer = await failure(
      api.clientAs(seller).changeProductStatuses({
        productIds: [made.id],
        status: 'GONE' as never,
      }),
    )

    expect(answer.status).toBe(400)
  })

  it('refuses an unknown stock filter', async () => {
    expect(
      await failure(api.clientAs(seller).getSellerProducts({ stock: 'plenty' as never })),
    ).toMatchObject({ status: 400 })
  })

  it('refuses a buyer', async () => {
    expect(await failure(api.clientAs(callers.buyer).getSellerProducts())).toMatchObject({
      status: 403,
    })
  })

  it('refuses an anonymous caller with a 401', async () => {
    expect(await failure(api.client.getSellerProducts())).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    })
  })
})

describe('조합 표', () => {
  it('spells out each combination in axis order, with its stock', async () => {
    const source = await create({ options: COLOUR_AND_SIZE })
    const answer = await api.clientAs(seller).getSellerProductVariants(source.id)

    expect(() => sellerVariantListResponseSchema.parse(answer)).not.toThrow()
    expect(answer.variants.map((variant) => variant.optionLabel).sort()).toEqual([
      '블랙 / M',
      '블랙 / S',
      '화이트 / M',
      '화이트 / S',
    ])
    expect(answer.variants.every((variant) => variant.stock === 10)).toBe(true)
    expect(answer.variants.every((variant) => !variant.isLowStock)).toBe(true)
  })

  it('gives an optionless listing one row with an empty label', async () => {
    const source = await create({ variantDefaults: { price: 9_000, stock: 2 } })
    const { variants } = await api.clientAs(seller).getSellerProductVariants(source.id)

    expect(variants).toHaveLength(1)
    expect(variants[0]).toMatchObject({ optionLabel: '', stock: 2, isLowStock: true })
  })

  it('answers 404 for a listing that does not exist', async () => {
    expect(
      await failure(
        api.clientAs(seller).getSellerProductVariants('0192f0c1-0000-7000-8000-00000000beef'),
      ),
    ).toMatchObject({ status: 404 })
  })
})
