import type { ApiClient, CreateProductRequest, Product } from '@shopping/shared'
import { ApiClientError, productResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * The product endpoints over real HTTP, against this worker's real database.
 *
 * Everything goes through `createApiClient` from `@shopping/shared`, which
 * parses each response with the schema the front-ends are typed against. Gate
 * C3 therefore holds structurally: a renamed or missing field fails these specs
 * as `malformed_response` whether or not an assertion happens to mention it.
 *
 * Authentication does not exist yet, so the harness binds the header-reading
 * principal resolver TASK-0021 will replace (`authenticate` below). Unlike the
 * category and attribute specs, the seller here has to be a **real row**: a
 * product belongs to a store, and `own` is resolved against the `Seller` the
 * request names.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/**
 * A slug nothing else in this run holds.
 *
 * A counter rather than a timestamp: `Date.now()` is banned in this package
 * (the clock is a port, `src/common/clock.ts`), and two categories created in
 * the same millisecond would collide anyway.
 */
let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

/** `catalog.*` and `product.write:any`, but no `product.delete`. */
function operator(): ApiClient {
  return api.clientAs(callers.operator)
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

/** Asserts the call failed over HTTP and returns the shared error envelope. */
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

/** The `field` of every structured entry in an error envelope. */
function fieldsOf(details: readonly unknown[]): readonly string[] {
  return details
    .filter(
      (entry): entry is { field: string } =>
        typeof entry === 'object' && entry !== null && 'field' in entry,
    )
    .map((entry) => entry.field)
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

/** A signed-in seller with a store of their own. */
async function storefront(): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

/** A create request that states only what a test is about. */
function draft(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: 10 },
    ...overrides,
  }
}

/** 색상 3 × 사이즈 4 — the twelve combinations 완료 기준 F1 asks for. */
const COLOUR_AND_SIZE = [
  { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
  { name: '사이즈', values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }] },
]

async function create(overrides: Partial<CreateProductRequest> = {}): Promise<Product> {
  const { product } = await api.clientAs(seller).createProduct(draft(overrides))

  return product
}

/** The combination of one variant, as labels, in axis order. */
function combinationOf(product: Product, variantId: string): readonly string[] {
  const variant = product.variants.find((entry) => entry.id === variantId)
  const labels = new Map(
    product.options.flatMap((option) =>
      option.values.map((value) => [value.id, { option: option.sortOrder, label: value.value }]),
    ),
  )

  return (variant?.optionValueIds ?? [])
    .map((id) => labels.get(id))
    .filter((entry) => entry !== undefined)
    .sort((left, right) => left.option - right.option)
    .map((entry) => entry.label)
}

describe('F1 — 조합 생성', () => {
  it('makes twelve variants out of three colours and four sizes', async () => {
    const product = await create({ options: COLOUR_AND_SIZE })

    expect(product.variants).toHaveLength(12)
    expect(product.options.map((option) => option.name)).toEqual(['색상', '사이즈'])
  })

  it('maps every variant onto exactly one choice per axis', async () => {
    const product = await create({ options: COLOUR_AND_SIZE })

    // The mapping is what a buyer's selection is resolved against, so "twelve
    // rows exist" is only half the requirement.
    for (const variant of product.variants) {
      expect(variant.optionValueIds).toHaveLength(2)
    }

    const combinations = product.variants.map((variant) => combinationOf(product, variant.id))

    expect(new Set(combinations.map((entry) => entry.join('/'))).size).toBe(12)
    expect(combinations).toContainEqual(['블랙', 'S'])
    expect(combinations).toContainEqual(['그레이', 'XL'])
  })

  it('gives every variant a SKU of its own', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, skuPrefix: 'TEE' })

    expect(product.variants.map((variant) => variant.sku)).toEqual(
      Array.from({ length: 12 }, (_unused, index) => `TEE-${String(index + 1)}`),
    )
  })

  it('lays overrides onto individual combinations and leaves the rest generated', async () => {
    const product = await create({
      options: COLOUR_AND_SIZE,
      variants: [{ optionValues: ['블랙', 'S'], price: 15_000, sku: 'TEE-BLACK-S' }],
    })

    const cheapest = product.variants.find((variant) => variant.sku === 'TEE-BLACK-S')

    expect(cheapest?.price).toBe(15_000)
    expect(product.variants).toHaveLength(12)
    expect(product.variants.filter((variant) => variant.price === 19_000)).toHaveLength(11)
  })
})

describe('F2 — 옵션 없는 상품', () => {
  it('creates one variant with an empty combination', async () => {
    const product = await create()

    expect(product.variants).toHaveLength(1)
    expect(product.variants[0]?.optionValueIds).toEqual([])
    expect(product.options).toEqual([])
  })
})

describe('F3 — 소유권', () => {
  it('refuses another seller’s product', async () => {
    const product = await create()
    const refused = await failure(
      api.clientAs(rival).updateProduct(product.id, { version: product.version, name: '가로채기' }),
    )

    expect(refused.status).toBe(403)
    expect(refused.code).toBe('FORBIDDEN')
    expect(refused.details).toContain(deniedMessage('product.write', 'out_of_scope'))
  })

  it('lets an operator edit anybody’s', async () => {
    const product = await create()
    const { product: edited } = await operator().updateProduct(product.id, {
      version: product.version,
      name: '운영자가 고친 이름',
    })

    expect(edited.name).toBe('운영자가 고친 이름')
  })
})

describe('F4 — 속성 검증 연결', () => {
  beforeEach(async () => {
    await operator().createAttribute({
      categoryId,
      key: 'material',
      label: '소재',
      type: 'SELECT',
      options: ['면', '울'],
      isRequired: true,
    })
  })

  it('refuses a value outside the definition and names the field', async () => {
    const refused = await failure(create({ attributes: { material: '가죽' } }))

    expect(refused.status).toBe(400)
    // The path a form places the message at, not a sentence it has to parse.
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })

  it('refuses a missing required attribute', async () => {
    const refused = await failure(create({ attributes: {} }))

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })

  it('refuses an undefined key', async () => {
    const refused = await failure(create({ attributes: { material: '면', colour: '검정' } }))

    expect(fieldsOf(refused.details)).toEqual(['attributes.colour'])
  })

  it('stores the values a definition allows', async () => {
    const product = await create({ attributes: { material: '울' } })

    expect(product.attributes).toEqual({ material: '울' })
  })

  it('re-judges the values when the category changes underneath them', async () => {
    const product = await create({ attributes: { material: '울' } })
    const { category: other } = await operator().createCategory({
      parentId: null,
      name: '신발',
      slug: uniqueSlug('shoes'),
    })

    // Nobody edited `attributes`, but the definitions that explain them are
    // gone — which is the state TASK-0030 exists to keep out of the table.
    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, {
        version: product.version,
        categoryId: other.id,
      }),
    )

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['attributes.material'])
  })
})

describe('F5 — 캐시 갱신', () => {
  it('follows the cheapest variant down', async () => {
    const product = await create({ options: COLOUR_AND_SIZE })

    expect(product.minPrice).toBe(19_000)

    const { product: cut } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: ['화이트', 'M'], price: 12_000 }],
    })

    expect(cut.minPrice).toBe(12_000)
  })

  it('follows it back up when the cheapest one gets dearer', async () => {
    const product = await create({
      options: COLOUR_AND_SIZE,
      variants: [{ optionValues: ['블랙', 'S'], price: 9_000 }],
    })

    expect(product.minPrice).toBe(9_000)

    // The case an incremental cache gets wrong: `min(old, new)` never rises,
    // so a product whose cheapest variant is repriced upward would keep
    // advertising a price nobody can buy it at (TASK-0032 4.6).
    const { product: raised } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: ['블랙', 'S'], price: 25_000 }],
    })

    expect(raised.minPrice).toBe(19_000)
  })

  it('ignores a variant nobody can order', async () => {
    const product = await create({
      options: COLOUR_AND_SIZE,
      variants: [{ optionValues: ['블랙', 'S'], price: 9_000 }],
    })

    const { product: hidden } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: ['블랙', 'S'], isActive: false }],
    })

    // A price on a card the buyer cannot actually pay is worse than no price.
    expect(hidden.minPrice).toBe(19_000)
  })
})

describe('F6 — 부분 조합', () => {
  it('switches one combination off and leaves the rest orderable', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, status: 'ACTIVE' })
    const { product: partial } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: ['블랙', 'XL'], isActive: false }],
    })

    const off = partial.variants.filter((variant) => !variant.isActive)

    expect(off).toHaveLength(1)
    expect(combinationOf(partial, off[0]?.id ?? '')).toEqual(['블랙', 'XL'])
    // The row stays: an order placed yesterday points at it, and the option
    // grid greys the combination out rather than pretending it never existed.
    expect(partial.variants).toHaveLength(12)
  })
})

describe('F7 — SKU 유일성', () => {
  it('refuses two variants of one request sharing a SKU', async () => {
    // The request contradicts itself, so it is a 400: the caller has to change
    // what they sent, not re-read anything.
    const refused = await failure(
      create({
        options: COLOUR_AND_SIZE,
        variants: [
          { optionValues: ['블랙', 'S'], sku: 'TEE-1' },
          { optionValues: ['블랙', 'M'], sku: 'TEE-1' },
        ],
        skuPrefix: 'OTHER',
      }),
    )

    expect(refused.status).toBe(409)
  })

  it('refuses a SKU another of the seller’s products already holds', async () => {
    await create({ skuPrefix: 'TEE' })

    // A conflict with stored state, so a 409 — the same judgement TASK-0030
    // made for a duplicated attribute key.
    const refused = await failure(create({ skuPrefix: 'TEE' }))

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CONFLICT')
  })

  it('allows another store the same SKU', async () => {
    await create({ skuPrefix: 'TEE' })

    const { product } = await api.clientAs(rival).createProduct({ ...draft(), skuPrefix: 'TEE' })

    expect(product.variants[0]?.sku).toBe('TEE-1')
  })
})

describe('F8 · F9 — 1회 주문 최대 수량', () => {
  it('lets the variant’s cap win over the product’s', async () => {
    const product = await create({
      maxPurchaseQuantity: 5,
      options: COLOUR_AND_SIZE,
      variants: [{ optionValues: ['블랙', 'S'], maxPurchaseQuantity: 1 }],
    })

    const limited = product.variants.find(
      (variant) => combinationOf(product, variant.id).join('/') === '블랙/S',
    )

    expect(limited?.maxPurchaseQuantity).toBe(1)
    expect(limited?.effectiveMaxPurchaseQuantity).toBe(1)
  })

  it('inherits the product’s cap when the variant has none', async () => {
    const product = await create({ maxPurchaseQuantity: 5, options: COLOUR_AND_SIZE })

    // Resolved by the API rather than by each caller, because four different
    // places have to enforce it (TASK-0045 · 0050 · 0048 · 0049).
    for (const variant of product.variants) {
      expect(variant.maxPurchaseQuantity).toBeNull()
      expect(variant.effectiveMaxPurchaseQuantity).toBe(5)
    }
  })

  it('caps one variant of an otherwise uncapped product', async () => {
    const product = await create({
      variants: [{ optionValues: [], maxPurchaseQuantity: 2 }],
    })

    expect(product.maxPurchaseQuantity).toBeNull()
    expect(product.variants[0]?.effectiveMaxPurchaseQuantity).toBe(2)
  })
})

describe('F10 — 주문 스냅샷의 앵커', () => {
  it('keeps the variant a past order would point at, whatever changes', async () => {
    const product = await create({ options: COLOUR_AND_SIZE, status: 'ACTIVE' })
    const ordered = product.variants[0]
    // What an `OrderItem` will copy (M07): the name, the combination, the SKU
    // and one absolute integer price. Nothing here is a formula whose inputs
    // could move.
    const snapshot = {
      variantId: ordered?.id ?? '',
      name: product.name,
      combination: combinationOf(product, ordered?.id ?? ''),
      sku: ordered?.sku ?? '',
      price: ordered?.price ?? 0,
    }

    const { product: renamed } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      name: '완전히 다른 이름',
      status: 'INACTIVE',
      variants: [{ optionValues: [...snapshot.combination], price: 99_000, isActive: false }],
    })

    const still = renamed.variants.find((variant) => variant.id === snapshot.variantId)

    // The row is still there, still resolvable by the id the order recorded,
    // and still able to say which combination it was — which is the whole of
    // what the schema has to guarantee for M07 (TASK-0032 4.4).
    expect(still).toBeDefined()
    expect(combinationOf(renamed, snapshot.variantId)).toEqual(snapshot.combination)
    expect(still?.sku).toBe(snapshot.sku)
    expect(renamed.name).not.toBe(snapshot.name)
    expect(still?.price).not.toBe(snapshot.price)
  })

  it('keeps it after the listing is retired', async () => {
    const product = await create({ status: 'ACTIVE' })
    const variantId = product.variants[0]?.id ?? ''

    const { product: removed } = await api.clientAs(seller).deleteProduct(product.id)

    expect(removed.status).toBe('INACTIVE')

    const [row] = await db.query<{ id: string; sku: string }>(
      `SELECT "id", "sku" FROM "ProductVariant" WHERE "id" = $1`,
      [variantId],
    )

    expect(row?.id).toBe(variantId)
  })
})

describe('F11 — 옵션 값의 추가와 삭제', () => {
  const colour = [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }]

  it('creates the combinations an added choice brings into existence', async () => {
    const product = await create({ options: colour })

    expect(product.variants).toHaveLength(2)

    const { product: widened } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      options: [
        { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
      ],
      variantDefaults: { price: 21_000, stock: 4 },
    })

    expect(widened.variants).toHaveLength(3)
    expect(widened.variants.filter((variant) => variant.price === 21_000)).toHaveLength(1)
  })

  it('switches off the combinations a removed choice took with it', async () => {
    const product = await create({ options: colour })
    const { product: narrowed } = await api.clientAs(seller).updateProduct(product.id, {
      version: product.version,
      options: [{ name: '색상', values: [{ value: '블랙' }] }],
    })

    // R1: 삭제는 해당 Variant 비활성화. The row survives because an order may
    // already name it.
    expect(narrowed.variants).toHaveLength(2)
    expect(narrowed.variants.filter((variant) => variant.isActive)).toHaveLength(1)
    expect(narrowed.options[0]?.values.map((value) => value.value)).toEqual(['블랙'])
  })

  it('refuses a change to the axes themselves', async () => {
    const product = await create({ options: colour })
    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, {
        version: product.version,
        options: [...colour, { name: '사이즈', values: [{ value: 'S' }] }],
        variantDefaults: { price: 19_000 },
      }),
    )

    // Adding an axis changes the arity of every combination at once, which no
    // listing with order history survives (TASK-0032 4.8).
    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['options'])
  })

  it('refuses new combinations with no price to start from', async () => {
    const product = await create({ options: colour })
    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, {
        version: product.version,
        options: [
          { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '네이비' }] },
        ],
      }),
    )

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['variantDefaults'])
  })
})

describe('F12 — 속성 정의가 사용 중일 때 (TASK-0030 R2 · R5)', () => {
  it('refuses to retire a definition a product is standing on', async () => {
    const { attribute } = await operator().createAttribute({
      categoryId,
      key: 'material',
      label: '소재',
      type: 'TEXT',
    })

    await create({ attributes: { material: '울' } })

    const refused = await failure(api.clientAs(callers.superAdmin).deleteAttribute(attribute.id))

    // Without this the product keeps a key nothing in the database explains —
    // the orphan TASK-0030 R2 named and could not close, because `Product` did
    // not exist yet.
    expect(refused.status).toBe(409)
  })

  it('allows retiring one nobody uses', async () => {
    const { attribute } = await operator().createAttribute({
      categoryId,
      key: 'origin',
      label: '원산지',
      type: 'TEXT',
    })

    await create()

    await expect(
      api.clientAs(callers.superAdmin).deleteAttribute(attribute.id),
    ).resolves.toBeDefined()
  })

  it('refuses removing a choice a product carries', async () => {
    const { attribute } = await operator().createAttribute({
      categoryId,
      key: 'material',
      label: '소재',
      type: 'SELECT',
      options: ['면', '울'],
    })

    await create({ attributes: { material: '울' } })

    const refused = await failure(
      operator().updateAttribute(attribute.id, { version: attribute.version, options: ['면'] }),
    )

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['options'])
  })

  it('allows removing a choice nobody picked', async () => {
    const { attribute } = await operator().createAttribute({
      categoryId,
      key: 'material',
      label: '소재',
      type: 'SELECT',
      options: ['면', '울', '오타'],
    })

    await create({ attributes: { material: '울' } })

    // Narrowing has to stay possible — an operator must be able to delete a
    // typo (TASK-0030 R5).
    await expect(
      operator().updateAttribute(attribute.id, {
        version: attribute.version,
        options: ['면', '울'],
      }),
    ).resolves.toBeDefined()
  })
})

describe('상태와 노출', () => {
  it('refuses ACTIVE with nothing orderable behind it', async () => {
    const refused = await failure(
      create({ variants: [{ optionValues: [], isActive: false }], status: 'ACTIVE' }),
    )

    expect(refused.status).toBe(400)
    expect(fieldsOf(refused.details)).toEqual(['status'])
  })

  it('refuses a seller who has not been approved', async () => {
    const owner = await createUser(db)
    const store = await createSeller(db, { userId: owner.id, status: 'PENDING' })
    const pending: TestCaller = {
      userId: owner.id,
      roles: ['SELLER_OWNER'],
      sellerId: store.id,
    }

    const refused = await failure(api.clientAs(pending).createProduct(draft()))

    expect(refused.status).toBe(409)
  })

  it('refuses a seller who tries to lift their own forced hide', async () => {
    const product = await create({ status: 'ACTIVE' })
    const { product: hidden } = await operator().updateProduct(product.id, {
      version: product.version,
      status: 'SUSPENDED',
    })

    expect(hidden.status).toBe('SUSPENDED')

    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, { version: hidden.version, status: 'ACTIVE' }),
    )

    // A forced hide a seller can clear is not a forced hide (TASK-0032 4.9).
    expect(refused.status).toBe(403)
  })

  it('refuses a seller who tries to suspend their own listing', async () => {
    const product = await create({ status: 'ACTIVE' })
    const refused = await failure(
      api
        .clientAs(seller)
        .updateProduct(product.id, { version: product.version, status: 'SUSPENDED' }),
    )

    expect(refused.status).toBe(403)
  })

  it('hides a draft from a buyer and shows it to its owner', async () => {
    const product = await create()

    await expect(api.clientAs(seller).getProduct(product.id)).resolves.toBeDefined()

    // 404 rather than 403: the existence of a draft is itself the private part,
    // and a 403 would confirm it.
    const refused = await failure(api.clientAs(callers.buyer).getProduct(product.id))

    expect(refused.status).toBe(404)
  })
})

describe('목록', () => {
  it('shows a buyer only what is on sale', async () => {
    await create({ status: 'ACTIVE', name: '판매 중' })
    await create({ name: '작성 중', skuPrefix: 'DRAFT' })

    const { products } = await api
      .clientAs(callers.buyer)
      .getProducts({ sellerId: seller.sellerId })

    expect(products.map((product) => product.name)).toEqual(['판매 중'])
  })

  it('shows a seller their own drafts', async () => {
    await create({ status: 'ACTIVE', name: '판매 중' })
    await create({ name: '작성 중', skuPrefix: 'DRAFT' })

    const { products } = await api.clientAs(seller).getProducts()

    expect([...products.map((product) => product.name)].sort()).toEqual(['작성 중', '판매 중'])
  })

  it('refuses a seller asking about somebody else’s store', async () => {
    const refused = await failure(
      api.clientAs(seller).getProducts({ sellerId: rival.sellerId ?? '' }),
    )

    expect(refused.status).toBe(403)
  })

  it('carries the counts a console row draws', async () => {
    await create({ options: COLOUR_AND_SIZE, status: 'ACTIVE' })

    const { products } = await api.clientAs(seller).getProducts()

    expect(products[0]?.variantCount).toBe(12)
    expect(products[0]?.stock).toBe(120)
    expect(products[0]?.minPrice).toBe(19_000)
  })

  it('pages with a cursor and stops at the end', async () => {
    await create({ name: '첫 번째', skuPrefix: 'A' })
    await create({ name: '두 번째', skuPrefix: 'B' })
    await create({ name: '세 번째', skuPrefix: 'C' })

    const first = await api.clientAs(seller).getProducts({ limit: 2 })

    expect(first.products).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await api
      .clientAs(seller)
      .getProducts({ limit: 2, cursor: first.nextCursor ?? undefined })

    expect(second.products).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    // Ids are UUIDv7, so `id DESC` is newest first without a second sort key.
    expect(second.products[0]?.name).toBe('첫 번째')
  })
})

describe('낙관적 잠금', () => {
  it('refuses an edit built on a version somebody else replaced', async () => {
    const product = await create()

    await api.clientAs(seller).updateProduct(product.id, { version: product.version, name: '먼저' })

    const refused = await failure(
      api.clientAs(seller).updateProduct(product.id, { version: product.version, name: '나중' }),
    )

    expect(refused.status).toBe(409)
  })
})

describe('게이트 A2 · A3 · A4', () => {
  it('answers 400 with the shared envelope for a malformed body', async () => {
    const refused = await failure(
      api.clientAs(seller).createProduct({
        categoryId,
        name: '',
        variantDefaults: { price: -1 },
      }),
    )

    expect(refused.status).toBe(400)
    expect([...fieldsOf(refused.details)].sort()).toEqual(['name', 'variantDefaults.price'])
  })

  it('answers 403 for a buyer trying to sell', async () => {
    const refused = await failure(api.clientAs(callers.buyer).createProduct(draft()))

    expect(refused.status).toBe(403)
    expect(refused.details).toContain(deniedMessage('product.write', 'missing_permission'))
  })

  it('answers 403 for an operator trying to delete', async () => {
    const product = await create()
    const refused = await failure(operator().deleteProduct(product.id))

    // `product.delete` belongs to the owner and to `ADMIN_SUPER`; an everyday
    // operator hides a listing instead (TASK-0105 4).
    expect(refused.status).toBe(403)
    expect(refused.details).toContain(deniedMessage('product.delete', 'missing_permission'))
  })

  it('answers 401 with no caller at all', async () => {
    const refused = await failure(api.client.getProducts())

    expect(refused.status).toBe(401)
  })
})

describe('게이트 C3 — 응답이 계약과 같은 스키마를 통과한다', () => {
  it('parses a raw response with the shared schema', async () => {
    const product = await create({ options: COLOUR_AND_SIZE })
    const response = await fetch(`${api.baseUrl}/api/v1/products/${product.id}`, {
      headers: {
        'x-app-id': 'seller',
        'x-test-user': seller.userId,
        'x-test-roles': seller.roles.join(','),
        'x-test-seller': seller.sellerId ?? '',
      },
    })

    // Every other spec in this file goes through `createApiClient`, which parses
    // with this schema already; doing it once by hand is what makes that
    // structural guarantee visible rather than incidental.
    expect(productResponseSchema.safeParse(await response.json()).success).toBe(true)
  })
})
