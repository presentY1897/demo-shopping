import type { ApiClient, CreateProductRequest, Product, SellerStatus } from '@shopping/shared'
import {
  ApiClientError,
  PRODUCT_MAX_VARIANTS,
  productResponseSchema,
  sellerStatuses,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { sellerStatusAllows } from '../../src/sellers/seller-status.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * The editor's contract: one save, one transaction, and the refusals a screen
 * has to tell apart (TASK-0113).
 *
 * `products.integration.spec.ts` covers what TASK-0032 built — the tables, the
 * combination expansion, the caches. This file covers what was missing on top
 * of it: a draft that may be incomplete, a publish step that may not, a store
 * whose state can refuse the write, a SKU rule that used to collide with
 * itself, and six failures that used to be four HTTP statuses.
 *
 * Everything goes through `createApiClient`, so a response that does not match
 * the shared schema fails as `malformed_response` whether or not an assertion
 * mentions it (gate C3).
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
  readonly details: readonly unknown[]
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

interface StructuredDetail {
  readonly field: string
  readonly params?: Readonly<Record<string, unknown>>
}

/** The structured entries of an envelope's `details`. */
function structured(details: readonly unknown[]): readonly StructuredDetail[] {
  return details.filter(
    (entry): entry is StructuredDetail =>
      typeof entry === 'object' && entry !== null && 'field' in entry,
  )
}

function fieldsOf(details: readonly unknown[]): readonly string[] {
  return structured(details).map((entry) => entry.field)
}

let categoryId: number
let seller: TestCaller
let rival: TestCaller

beforeEach(async () => {
  const { category } = await operator().createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSlug('clothing'),
  })

  categoryId = category.id
  seller = await storefront()
  rival = await storefront()
})

async function storefront(status: SellerStatus = 'ACTIVE'): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id, status })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

function draft(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: 10 },
    ...overrides,
  }
}

/** 색상 3 × 사이즈 4 — the twelve combinations F1 asks for. */
const COLOUR_AND_SIZE = [
  { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
  { name: '사이즈', values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }] },
]

async function create(overrides: Partial<CreateProductRequest> = {}): Promise<Product> {
  const { product } = await api.clientAs(seller).createProduct(draft(overrides))

  return product
}

/** A storage key of `store`, in the shape presign hands back. */
function imageUrl(store: string, object = '11111111-2222-4333-8444-555555555555'): string {
  return `https://cdn.test.invalid/products/${store}/${object}.jpg`
}

async function requiredAttribute(): Promise<void> {
  await operator().createAttribute({
    categoryId,
    key: 'material',
    label: '소재',
    type: 'SELECT',
    options: ['면', '울'],
    isRequired: true,
  })
}

async function countOf(table: string, column: string, value: string): Promise<number> {
  const [row] = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM "${table}" WHERE "${column}" = $1`,
    [value],
  )

  return row?.total ?? 0
}

describe('F1 — 한 번에 저장', () => {
  it('writes the product, its gallery, both axes and all twelve variants', async () => {
    const product = await create({
      options: COLOUR_AND_SIZE,
      images: [{ url: imageUrl(seller.sellerId ?? ''), alt: '정면' }],
      skuPrefix: 'ONE',
    })

    expect(await countOf('ProductImage', 'productId', product.id)).toBe(1)
    expect(await countOf('ProductOption', 'productId', product.id)).toBe(2)
    expect(await countOf('ProductVariant', 'productId', product.id)).toBe(12)
    // Two mappings per variant — one choice on each axis. This is the row that
    // makes a buyer's selection resolvable, and it is the one a partial write
    // would leave behind.
    expect(await countOf('VariantOptionValue', 'productId', product.id)).toBe(24)
  })
})

describe('F2 — 트랜잭션', () => {
  it('leaves nothing behind when the write fails after the product row exists', async () => {
    await create({ skuPrefix: 'TAKEN' })

    const before = await countOf('Product', 'sellerId', seller.sellerId ?? '')

    // The variant insert is what fails, and it runs after the product row and
    // its images are already written. So a missing rollback is visible as an
    // orphan product with a gallery and no SKU — which is exactly the state
    // TASK-0113 exists to make unrepresentable.
    const refused = await failure(
      create({ skuPrefix: 'TAKEN', images: [{ url: imageUrl(seller.sellerId ?? '') }] }),
    )

    expect(refused.status).toBe(409)
    expect(await countOf('Product', 'sellerId', seller.sellerId ?? '')).toBe(before)

    const [orphans] = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM "ProductImage" i
         LEFT JOIN "Product" p ON p."id" = i."productId"
        WHERE p."id" IS NULL`,
    )

    expect(orphans?.total).toBe(0)
  })
})

describe('F3 · F4 — 판매 시작은 요구하고, 임시저장은 봐 준다', () => {
  beforeEach(requiredAttribute)

  it('refuses to put a listing on sale with a required attribute empty', async () => {
    const refused = await failure(create({ status: 'ACTIVE', attributes: {} }))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('PRODUCT_ATTRIBUTES_REQUIRED')
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })

  it('saves the draft and gives back everything that was typed', async () => {
    const product = await create({
      name: '작성 중인 셔츠',
      attributes: {},
      maxPurchaseQuantity: 3,
    })
    const { product: reloaded } = await api.clientAs(seller).getProduct(product.id)

    expect(reloaded.status).toBe('DRAFT')
    expect(reloaded.name).toBe('작성 중인 셔츠')
    expect(reloaded.attributes).toEqual({})
    expect(reloaded.maxPurchaseQuantity).toBe(3)
  })

  it('still refuses a wrong value in a draft', async () => {
    // The relaxation is about *absence*. A draft holding a colour no definition
    // explains is not an unfinished listing, it is a broken one.
    const refused = await failure(create({ attributes: { material: '가죽' } }))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('BAD_REQUEST')
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })
})

describe('F5 · F5b — 옵션 차분', () => {
  it('adds only the new combinations and leaves the existing stock alone', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, skuPrefix: 'DIFF' })
    const before = new Map(product.variants.map((variant) => [variant.id, variant.stock]))

    const { product: widened } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      options: [
        COLOUR_AND_SIZE[0] ?? { name: '색상', values: [] },
        {
          name: '사이즈',
          values: [
            { value: 'S' },
            { value: 'M' },
            { value: 'L' },
            { value: 'XL' },
            { value: 'XXL' },
          ],
        },
      ],
      variantDefaults: { price: 21_000, stock: 4 },
    })

    expect(widened.variants).toHaveLength(15)

    // The point of the diff: three rows appear and twelve are untouched. A
    // rebuild-and-replace would look identical in the count and would have
    // reset every stock level to the request's default.
    for (const variant of widened.variants) {
      const stock = before.get(variant.id)

      if (stock !== undefined) expect(variant.stock).toBe(stock)
    }
    expect(widened.variants.filter((variant) => variant.stock === 4)).toHaveLength(3)
  })

  it('deactivates the variants a removed choice took with it, and deletes no row', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, skuPrefix: 'KEEP' })
    const anchor = product.variants[0]?.id ?? ''

    const { product: narrowed } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      options: [
        { name: '색상', values: [{ value: '블랙' }] },
        COLOUR_AND_SIZE[1] ?? { name: '사이즈', values: [] },
      ],
    })

    expect(await countOf('ProductVariant', 'productId', product.id)).toBe(12)
    expect(narrowed.variants.filter((variant) => variant.isActive)).toHaveLength(4)
    // The row an order would point at is still resolvable by the id it
    // recorded, which is the whole reason removal is a deactivation.
    expect(narrowed.variants.some((variant) => variant.id === anchor)).toBe(true)
  })
})

describe('F6 — 조합 상한', () => {
  it('refuses 210 combinations and says what the limit is', async () => {
    const refused = await failure(
      create({
        options: [
          {
            name: '색상',
            values: Array.from({ length: 21 }, (_x, i) => ({ value: `C${String(i)}` })),
          },
          {
            name: '사이즈',
            values: Array.from({ length: 10 }, (_x, i) => ({ value: `S${String(i)}` })),
          },
        ],
      }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('PRODUCT_TOO_MANY_VARIANTS')
    // The number lives in `@shopping/shared` and travels on the envelope, so
    // the console's sentence and the server's refusal cannot disagree.
    expect(structured(refused.details)[0]?.params).toEqual({ max: PRODUCT_MAX_VARIANTS })
  })

  it('accepts the largest grid that is still inside the limit', async () => {
    const product = await create({
      skuPrefix: 'MAXED',
      options: [
        {
          name: '색상',
          values: Array.from({ length: 20 }, (_x, i) => ({ value: `C${String(i)}` })),
        },
        {
          name: '사이즈',
          values: Array.from({ length: 10 }, (_x, i) => ({ value: `S${String(i)}` })),
        },
      ],
    })

    expect(product.variants).toHaveLength(PRODUCT_MAX_VARIANTS)
  })
})

describe('F7 · F8 — 누구의 상품인가, 어떤 스토어인가', () => {
  it('refuses another seller’s product with the platform’s own 403', async () => {
    const product = await create()
    const refused = await failure(
      api.clientAs(rival).updateProduct(product.id, { version: product.version, name: '가로채기' }),
    )

    // Deliberately *not* a product-specific code: this is the refusal
    // `assertResourceAccess` makes for every domain, and both consoles already
    // answer `FORBIDDEN` with "내 스토어가 맞는지 확인해 주세요" (TASK-0113 4장).
    expect(refused.status).toBe(403)
    expect(refused.code).toBe('FORBIDDEN')
  })

  it('refuses a store whose state does not admit product writes', async () => {
    const pending = await storefront('PENDING')
    const refused = await failure(api.clientAs(pending).createProduct(draft()))

    expect(refused.status).toBe(403)
    expect(refused.code).toBe('PRODUCT_SELLER_INACTIVE')
  })

  it.each(sellerStatuses)('refuses %s exactly when the capability table does', async (status) => {
    // The gate is TASK-0108's table with a code bolted on, and this is what
    // keeps that claim true: a cell edited there and not here — or a condition
    // written the wrong way round — makes one of these four cases red.
    const store = await storefront(status)
    const allowed = sellerStatusAllows(status, 'product.write')
    const result = await api
      .clientAs(store)
      .createProduct(draft())
      .then(
        () => 'created' as const,
        (reason: unknown) => reason,
      )

    if (allowed) {
      expect(result).toBe('created')
      return
    }

    expect(result).toBeInstanceOf(ApiClientError)
    expect((result as ApiClientError).status).toBe(403)
    expect((result as ApiClientError).body?.error.code).toBe('PRODUCT_SELLER_INACTIVE')
  })

  it('lets an operator edit a suspended store’s listing', async () => {
    const product = await create()

    await db.execute(`UPDATE "Seller" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [
      seller.sellerId,
    ])

    // The state gate asks "may this store trade", and an operator acting on
    // somebody else's catalogue is not that store trading. Refusing here would
    // make a suspended store unmanageable by the people who suspended it.
    const { product: edited } = await operator().updateProduct(product.id, {
      version: product.version,
      name: '운영자가 고친 이름',
    })

    expect(edited.name).toBe('운영자가 고친 이름')
  })

  it('refuses the owner of that same suspended store', async () => {
    const product = await create()

    await db.execute(`UPDATE "Seller" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [
      seller.sellerId,
    ])

    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, { version: product.version, name: '내가' }),
    )

    expect(refused.status).toBe(403)
    expect(refused.code).toBe('PRODUCT_SELLER_INACTIVE')
  })
})

describe('F9 — 1회 구매 수량 제한', () => {
  it('stores the cap and hands it straight back', async () => {
    const product = await create({
      variants: [{ optionValues: [], maxPurchaseQuantity: 2 }],
    })
    const { product: reloaded } = await api.clientAs(seller).getProduct(product.id)

    expect(reloaded.variants[0]?.maxPurchaseQuantity).toBe(2)
    // The resolved value too: four call sites in M07 enforce this cap and none
    // of them should be resolving `variant.max ?? product.max` themselves.
    expect(reloaded.variants[0]?.effectiveMaxPurchaseQuantity).toBe(2)
  })
})

describe('F10 — 발행과 발행 취소', () => {
  it('puts a complete draft on sale and takes it back off', async () => {
    await requiredAttribute()

    const product = await create({ attributes: { material: '울' } })

    expect(product.status).toBe('DRAFT')

    const { product: live } = await api
      .clientAs(seller)
      .publishProduct(product.id, { version: product.version })

    expect(live.status).toBe('ACTIVE')

    const { product: back } = await api
      .clientAs(seller)
      .unpublishProduct(live.id, { version: live.version })

    expect(back.status).toBe('DRAFT')
  })

  it('refuses to publish a draft whose required attributes are still empty', async () => {
    await requiredAttribute()

    const product = await create({ attributes: {} })
    const refused = await failure(
      api.clientAs(seller).publishProduct(product.id, { version: product.version }),
    )

    // The draft saved happily a moment ago. Publishing is where the category's
    // definitions stop being optional, and it is the only place a person is
    // told about them.
    expect(refused.status).toBe(400)
    expect(refused.code).toBe('PRODUCT_ATTRIBUTES_REQUIRED')
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })

  it('refuses to publish a listing with nothing orderable behind it', async () => {
    const product = await create({ variants: [{ optionValues: [], isActive: false }] })
    const refused = await failure(
      api.clientAs(seller).publishProduct(product.id, { version: product.version }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('PRODUCT_NOT_SELLABLE')
    expect(fieldsOf(refused.details)).toEqual(['status'])
  })

  it('takes the product row lock and the version with it', async () => {
    const product = await create()

    await api.clientAs(seller).updateProduct(product.id, { version: product.version, name: '먼저' })

    const refused = await failure(
      api.clientAs(seller).publishProduct(product.id, { version: product.version }),
    )

    // Routed through `update`, so publishing is not a back door around the
    // optimistic lock.
    expect(refused.status).toBe(409)
    expect(refused.code).toBe('PRODUCT_VERSION_CONFLICT')
    expect(fieldsOf(refused.details)).toEqual(['version'])
  })

  it('does not let a seller lift a forced hide with it', async () => {
    const product = await create({ status: 'ACTIVE' })
    const { product: hidden } = await operator().updateProduct(product.id, {
      version: product.version,
      status: 'SUSPENDED',
    })

    const refused = await failure(
      api.clientAs(seller).publishProduct(hidden.id, { version: hidden.version }),
    )

    expect(refused.status).toBe(403)
  })

  it('refuses an anonymous caller and a buyer', async () => {
    const product = await create()

    expect((await failure(api.client.publishProduct(product.id, { version: 0 }))).status).toBe(401)
    expect(
      (await failure(api.clientAs(callers.buyer).publishProduct(product.id, { version: 0 })))
        .status,
    ).toBe(403)
  })
})

describe('F11 — 캐시 갱신', () => {
  it('follows the cheapest variant down on save', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, skuPrefix: 'CACHE' })

    expect(product.minPrice).toBe(19_000)

    const { product: cut } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: ['화이트', 'M'], price: 12_000 }],
    })

    expect(cut.minPrice).toBe(12_000)
  })
})

describe('F12 — 65초 창 안의 두 상품 (TASK-0036 7.5)', () => {
  it('gives two back-to-back listings SKUs that do not collide', async () => {
    // No `skuPrefix` on either, which is the whole point: the old rule derived
    // it from the top 32 bits of a UUIDv7 timestamp and only changed every 65
    // seconds, so the second of these was refused with "이미 쓰고 있는 SKU".
    const first = await create({ name: '첫 번째' })
    const second = await create({ name: '두 번째' })

    expect(first.variants[0]?.sku).not.toBe(second.variants[0]?.sku)
  })

  it('keeps one product’s generated SKUs on a single prefix across an edit', async () => {
    const product = await create({
      options: [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }],
    })
    const prefix = (product.variants[0]?.sku ?? '').split('-')[0]

    const { product: widened } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      options: [
        { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
      ],
      variantDefaults: { price: 19_000, stock: 1 },
    })

    // Derived from the row rather than drawn fresh, so the combinations added
    // later are numbered on from the same family. A random prefix would split
    // one product's SKUs into two.
    for (const variant of widened.variants)
      expect(variant.sku.startsWith(`${prefix ?? ''}-`)).toBe(true)
  })
})

describe('F13 — 여섯 실패가 서로 다른 코드를 갖는다', () => {
  it('answers each refusal with a code of its own', async () => {
    await requiredAttribute()

    const codes = new Set<string>()

    codes.add((await failure(create({ status: 'ACTIVE', attributes: {} }))).code)
    codes.add(
      (
        await failure(
          create({
            options: [
              {
                name: '색상',
                values: Array.from({ length: 21 }, (_x, i) => ({ value: `C${String(i)}` })),
              },
              {
                name: '사이즈',
                values: Array.from({ length: 10 }, (_x, i) => ({ value: `S${String(i)}` })),
              },
            ],
          }),
        )
      ).code,
    )
    codes.add(
      (
        await failure(
          create({
            attributes: { material: '울' },
            variants: [{ optionValues: [], isActive: false }],
            status: 'ACTIVE',
          }),
        )
      ).code,
    )

    const pending = await storefront('PENDING')

    codes.add((await failure(api.clientAs(pending).createProduct(draft()))).code)

    await create({ attributes: { material: '울' }, skuPrefix: 'DUP' })
    codes.add((await failure(create({ attributes: { material: '울' }, skuPrefix: 'DUP' }))).code)

    const product = await create({ attributes: { material: '울' } })

    await api.clientAs(seller).updateProduct(product.id, { version: product.version, name: '먼저' })
    codes.add(
      (
        await failure(
          api
            .clientAs(seller)
            .updateProduct(product.id, { version: product.version, name: '나중' }),
        )
      ).code,
    )

    expect([...codes].sort()).toEqual([
      'PRODUCT_ATTRIBUTES_REQUIRED',
      'PRODUCT_NOT_SELLABLE',
      'PRODUCT_SELLER_INACTIVE',
      'PRODUCT_SKU_TAKEN',
      'PRODUCT_TOO_MANY_VARIANTS',
      'PRODUCT_VERSION_CONFLICT',
    ])
  })
})

describe('F14 — 이미지 키의 스토어', () => {
  it('refuses a gallery pointing into another store’s prefix', async () => {
    const refused = await failure(
      create({
        images: [{ url: imageUrl(seller.sellerId ?? '') }, { url: imageUrl(rival.sellerId ?? '') }],
      }),
    )

    expect(refused.status).toBe(400)
    // The position, so a form marks the row the person can see.
    expect(fieldsOf(refused.details)).toEqual(['images.1.url'])
  })

  it('accepts an image that is not one of our keys at all', async () => {
    // Stock photography, which is 780 of the 800 seeded listings
    // (DECISIONS 13). No sweep will ever consider those URLs.
    const product = await create({
      images: [{ url: 'https://images.unsplash.com/photo-1520.jpg' }],
    })

    expect(product.images).toHaveLength(1)
  })

  it('refuses on edit too, not only on create', async () => {
    const product = await create()
    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, {
        version: product.version,
        images: [{ url: imageUrl(rival.sellerId ?? '') }],
      }),
    )

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['images.0.url'])
  })
})

describe('F15 — 속성 삭제 시 사용 상품 수 (TASK-0031 F5)', () => {
  it('refuses with the number of products standing on the definition', async () => {
    const { attribute } = await operator().createAttribute({
      categoryId,
      key: 'material',
      label: '소재',
      type: 'TEXT',
    })

    await create({ attributes: { material: '울' }, skuPrefix: 'A' })
    await create({ attributes: { material: '면' }, skuPrefix: 'B' })

    const refused = await failure(api.clientAs(callers.superAdmin).deleteAttribute(attribute.id))

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('ATTRIBUTE_IN_USE')
    // The count is what TASK-0031 F5 could not have: the screen's own sentence
    // interpolates it, and no console can invent a figure it was never sent.
    expect(structured(refused.details)[0]?.params).toEqual({ count: 2 })
  })
})

describe('게이트 C3 — 발행 응답도 같은 스키마를 통과한다', () => {
  it('parses a raw publish response with the shared schema', async () => {
    const product = await create()
    const response = await fetch(`${api.baseUrl}/api/v1/products/${product.id}/publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-id': 'seller',
        'x-test-user': seller.userId,
        'x-test-roles': seller.roles.join(','),
        'x-test-seller': seller.sellerId ?? '',
      },
      body: JSON.stringify({ version: product.version }),
    })

    expect(response.status).toBe(200)
    expect(productResponseSchema.safeParse(await response.json()).success).toBe(true)
  })
})
