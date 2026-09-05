import { randomUUID } from 'node:crypto'

import { DatabaseError } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import type { CategoryRow, ProductRow, SellerRow } from '../support/factories.js'
import {
  createCategory,
  createProduct,
  createProductOption,
  createProductOptionValue,
  createProductVariant,
  createSeller,
  createStorefront,
  createUser,
  mapVariantOptionValue,
} from '../support/factories.js'

/**
 * Gate S5 for products, options and variants: the rules are tried against the
 * real database.
 *
 * TASK-0032 4.12 draws a line — what the database can hold and what only the
 * service can — and this file is where "stated in the migration" is proven to
 * mean "enforced". Each rule is tried **twice**, as TASK-0106 4.8 established:
 * a violation has to be refused with the right SQLSTATE and constraint name,
 * and the neighbouring case that must be permitted has to succeed. The second
 * half is what a check of the migration text can never do — a predicate written
 * backwards still refuses violations, it just also refuses everything else.
 *
 * The last describe block is the other half of the boundary: the two rules the
 * database **accepts** violations of, pinned down so that "the database will
 * catch it" never becomes the reason somebody deletes the service check.
 *
 * Every attempt is raw SQL. Going through Prisma or through `ProductService`
 * would let application validation answer first, and the question here is
 * precisely whether the database would have refused on its own.
 */

const db = useDatabase()

let seller: SellerRow
let category: CategoryRow

beforeEach(async () => {
  const storefront = await createStorefront(db)

  seller = storefront.seller
  category = storefront.category
})

/** Runs `work`, asserting that it was the database that refused, and how. */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `DB 가 거부할 것으로 기대했지만 성공했거나 다른 오류가 났습니다: ${String(error)}`,
    )
  }
  return error
}

function product(
  overrides: Partial<Parameters<typeof createProduct>[1]> = {},
): Promise<ProductRow> {
  return createProduct(db, { sellerId: seller.id, categoryId: category.id, ...overrides })
}

/** A product with one axis, one choice, and a variant carrying that choice. */
async function combination(): Promise<{
  productId: string
  optionId: string
  optionValueId: string
  variantId: string
}> {
  const row = await product()
  const option = await createProductOption(db, { productId: row.id })
  const value = await createProductOptionValue(db, { optionId: option.id })
  const variant = await createProductVariant(db, {
    productId: row.id,
    sellerId: seller.id,
    optionSignature: value.id,
  })

  await mapVariantOptionValue(db, {
    variantId: variant.id,
    optionValueId: value.id,
    optionId: option.id,
    productId: row.id,
  })

  return {
    productId: row.id,
    optionId: option.id,
    optionValueId: value.id,
    variantId: variant.id,
  }
}

describe('ProductVariant_seller_sku_key — one live SKU per seller', () => {
  it('refuses a second live variant with the same SKU', async () => {
    const first = await product()
    const second = await product()

    await createProductVariant(db, { productId: first.id, sellerId: seller.id, sku: 'TSHIRT-1' })

    // Per seller and not per product: a SKU repeated across a store's own
    // catalogue is exactly the mix-up a stock keeping unit exists to prevent.
    const error = await refusal(
      createProductVariant(db, { productId: second.id, sellerId: seller.id, sku: 'TSHIRT-1' }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('ProductVariant_seller_sku_key')
  })

  it('allows the same SKU in another store', async () => {
    const other = await createSeller(db, { userId: (await createUser(db)).id })
    const mine = await product()
    const theirs = await createProduct(db, { sellerId: other.id, categoryId: category.id })

    await createProductVariant(db, { productId: mine.id, sellerId: seller.id, sku: 'TSHIRT-1' })

    // Two stores naming a variant `TSHIRT-1` is a coincidence, not a conflict.
    await expect(
      createProductVariant(db, { productId: theirs.id, sellerId: other.id, sku: 'TSHIRT-1' }),
    ).resolves.toMatchObject({ sku: 'TSHIRT-1' })
  })

  it('lets a retired variant free its SKU', async () => {
    const row = await product()

    await createProductVariant(db, {
      productId: row.id,
      sellerId: seller.id,
      sku: 'TSHIRT-1',
      deletedAt: new Date('2026-09-04T00:00:00.000Z'),
    })

    // Partial, for the same reason `User_googleSub_active_key` is: a plain
    // unique index would let a retired row hold its identifier forever.
    await expect(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, sku: 'TSHIRT-1' }),
    ).resolves.toMatchObject({ sku: 'TSHIRT-1' })
  })
})

describe('ProductVariant_product_signature_key — one live variant per combination', () => {
  it('refuses a second variant of the same combination', async () => {
    const row = await product()
    const signature = randomUUID()

    await createProductVariant(db, {
      productId: row.id,
      sellerId: seller.id,
      optionSignature: signature,
    })

    // Two rows answering one buyer selection means the price shown depends on
    // which the planner returned first — a price that changes on refresh.
    const error = await refusal(
      createProductVariant(db, {
        productId: row.id,
        sellerId: seller.id,
        optionSignature: signature,
      }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('ProductVariant_product_signature_key')
  })

  it('refuses a second variant on a product with no options', async () => {
    const row = await product()

    await createProductVariant(db, { productId: row.id, sellerId: seller.id })

    // "옵션 없는 상품도 Variant 1개" (DECISIONS 3) is not a rule the service has
    // to remember: an optionless combination signs as the empty string, which
    // the partial unique index treats as a value like any other.
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('ProductVariant_product_signature_key')
  })

  it('allows the same combination on a different product', async () => {
    const first = await product()
    const second = await product()
    const signature = randomUUID()

    await createProductVariant(db, {
      productId: first.id,
      sellerId: seller.id,
      optionSignature: signature,
    })

    await expect(
      createProductVariant(db, {
        productId: second.id,
        sellerId: seller.id,
        optionSignature: signature,
      }),
    ).resolves.toMatchObject({ optionSignature: signature })
  })

  it('lets a retired variant free its combination', async () => {
    const row = await product()

    await createProductVariant(db, {
      productId: row.id,
      sellerId: seller.id,
      deletedAt: new Date('2026-09-04T00:00:00.000Z'),
    })

    // Which is what makes replacing a listing's variants possible at all.
    await expect(
      createProductVariant(db, { productId: row.id, sellerId: seller.id }),
    ).resolves.toMatchObject({ optionSignature: '' })
  })
})

describe('the composite edges — a mapping cannot leave its product', () => {
  it('refuses a variant whose seller is not the product’s', async () => {
    const other = await createSeller(db, { userId: (await createUser(db)).id })
    const row = await product()

    // `ProductVariant.sellerId` is a copy, and this is what stops the copy from
    // lying — without it "one live SKU per seller" would be an index over a
    // column nothing keeps true.
    const error = await refusal(createProductVariant(db, { productId: row.id, sellerId: other.id }))

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('ProductVariant_productId_sellerId_fkey')
  })

  it('refuses a mapping that names another product', async () => {
    const mine = await combination()
    const theirs = await combination()

    // Everything here belongs to `theirs` except the variant, so the only edge
    // that can refuse is the one tying the variant to the product — which is
    // exactly the claim: a variant of one listing cannot carry the options of
    // another.
    const error = await refusal(
      mapVariantOptionValue(db, {
        variantId: mine.variantId,
        optionValueId: theirs.optionValueId,
        optionId: theirs.optionId,
        productId: theirs.productId,
      }),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('VariantOptionValue_variantId_productId_fkey')
  })

  it('refuses a mapping onto another product’s option value', async () => {
    const mine = await combination()
    const theirs = await combination()
    // A second variant of the same product, so that the mapping is new to both
    // the primary key and the one-value-per-axis index and the only rule left
    // to break is the one under test.
    const spare = await createProductVariant(db, {
      productId: mine.productId,
      sellerId: seller.id,
      optionSignature: randomUUID(),
    })

    // The mapping claims `theirs.optionValueId` belongs to `mine.optionId`.
    const error = await refusal(
      mapVariantOptionValue(db, {
        variantId: spare.id,
        optionValueId: theirs.optionValueId,
        optionId: mine.optionId,
        productId: mine.productId,
      }),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('VariantOptionValue_optionValueId_optionId_fkey')
  })

  it('refuses a mapping whose option belongs to another product', async () => {
    const mine = await combination()
    const theirs = await combination()

    const error = await refusal(
      mapVariantOptionValue(db, {
        variantId: mine.variantId,
        optionValueId: theirs.optionValueId,
        optionId: theirs.optionId,
        productId: mine.productId,
      }),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('VariantOptionValue_optionId_productId_fkey')
  })

  it('refuses two values of one axis on one variant', async () => {
    const mapped = await combination()
    const second = await createProductOptionValue(db, { optionId: mapped.optionId })

    // A variant that was 블랙 *and* 화이트 makes "which colour did I order"
    // unanswerable — including for the order that already shipped.
    const error = await refusal(
      mapVariantOptionValue(db, {
        variantId: mapped.variantId,
        optionValueId: second.id,
        optionId: mapped.optionId,
        productId: mapped.productId,
      }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('VariantOptionValue_variantId_optionId_key')
  })

  it('allows a second axis on the same variant', async () => {
    const mapped = await combination()
    const size = await createProductOption(db, { productId: mapped.productId, name: '사이즈' })
    const medium = await createProductOptionValue(db, { optionId: size.id, value: 'M' })

    await expect(
      mapVariantOptionValue(db, {
        variantId: mapped.variantId,
        optionValueId: medium.id,
        optionId: size.id,
        productId: mapped.productId,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('Product_active_price_check — a listing on sale has a price', () => {
  it('refuses ACTIVE with no minimum price', async () => {
    // `minPrice` is NULL exactly when nothing is orderable, so this is the
    // constraint that keeps a card out of the storefront grid with an empty
    // price and a detail page nothing can be added to a basket from.
    const error = await refusal(product({ status: 'ACTIVE', minPrice: null }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_active_price_check')
  })

  it('allows ACTIVE once there is one', async () => {
    await expect(product({ status: 'ACTIVE', minPrice: 12_000 })).resolves.toMatchObject({
      status: 'ACTIVE',
    })
  })

  it('allows a draft with no price', async () => {
    // Which is why `ProductService` inserts as `DRAFT` and moves to the
    // requested status in the same statement that derives `minPrice`.
    await expect(product({ status: 'DRAFT', minPrice: null })).resolves.toMatchObject({
      minPrice: null,
    })
  })
})

describe('Product — the value checks', () => {
  it('refuses attributes that are not an object', async () => {
    // A `jsonb` column accepts `[]` and `"소재"` as readily as `{}`, and every
    // reader would otherwise have to guard against a shape no writer meant.
    const error = await refusal(
      db.execute(
        `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "attributes", "updatedAt")
         VALUES ($1, $2, $3, '상품', '[]'::jsonb, now())`,
        [randomUUID(), seller.id, category.id],
      ),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_attributes_object_check')
  })

  it('allows an attribute bag', async () => {
    await expect(product({ attributes: { material: '울' } })).resolves.toMatchObject({
      status: 'DRAFT',
    })
  })

  it('refuses a rating above five stars', async () => {
    const error = await refusal(product({ ratingAvg: 501, ratingCount: 1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_rating_check')
  })

  it('refuses an average with no reviews behind it', async () => {
    // With no reviews the average is not "0 stars", it is absent — and letting
    // the columns disagree makes "이 상품에 리뷰가 있나" answerable two ways.
    const error = await refusal(product({ ratingAvg: 450, ratingCount: 0 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_rating_check')
  })

  it('allows an average with reviews behind it', async () => {
    await expect(product({ ratingAvg: 435, ratingCount: 12 })).resolves.toMatchObject({
      status: 'DRAFT',
    })
  })

  it('refuses a purchase cap of zero', async () => {
    // A cap of zero is not a cap, it is a product nobody may order. `NULL` is
    // how "no cap" is said.
    const error = await refusal(product({ maxPurchaseQuantity: 0 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_maxPurchaseQuantity_check')
  })

  it('allows a cap of one and no cap at all', async () => {
    await expect(product({ maxPurchaseQuantity: 1 })).resolves.toBeDefined()
    await expect(product({ maxPurchaseQuantity: null })).resolves.toBeDefined()
  })

  it('refuses a negative minimum price', async () => {
    const error = await refusal(product({ minPrice: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Product_minPrice_check')
  })

  it('refuses a product in a category that does not exist', async () => {
    const error = await refusal(createProduct(db, { sellerId: seller.id, categoryId: 999_999 }))

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('Product_categoryId_fkey')
  })

  it('refuses a product in a store that does not exist', async () => {
    const error = await refusal(
      createProduct(db, { sellerId: randomUUID(), categoryId: category.id }),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('Product_sellerId_fkey')
  })
})

describe('ProductVariant — the money and quantity checks', () => {
  it('refuses a negative price', async () => {
    const row = await product()
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, price: -1 }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_price_check')
  })

  it('refuses a struck-through price below the selling price', async () => {
    const row = await product()

    // A negative discount renders as a positive one with the sign quietly
    // dropped, which is a "-30%" badge on a price that went up.
    const error = await refusal(
      createProductVariant(db, {
        productId: row.id,
        sellerId: seller.id,
        price: 20_000,
        listPrice: 19_000,
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_list_price_check')
  })

  it('allows a struck-through price equal to the selling price', async () => {
    const row = await product()

    await expect(
      createProductVariant(db, {
        productId: row.id,
        sellerId: seller.id,
        price: 20_000,
        listPrice: 20_000,
      }),
    ).resolves.toMatchObject({ price: 20_000 })
  })

  it('refuses negative stock', async () => {
    const row = await product()

    // The backstop under the reservation path's conditional update: an admin
    // adjustment, a restock or an import with the sign wrong all reach this
    // column without going through that statement (TASK-0048).
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, stock: -1 }),
    )

    expect(error.code).toBe('23514')
    // 이름은 `ProductVariant_reserved_check` 다. TASK-0048 이 더한
    // `0 <= reserved <= stock` 이 **음수 재고를 함의하기 때문**이다 — 예약이 0이어도
    // `0 <= -1` 이 거짓이라 그쪽이 먼저 걸린다. 둘 다 위반이고 어느 이름이 나오는지는
    // Postgres 의 검사 순서이므로, 여기서 재는 것은 「DB 가 거절한다」와 「거절한 규칙이
    // 재고에 관한 것이다」까지다. `ProductVariant_stock_check` 를 지우지 않는 이유는
    // 예약 제약이 언젠가 바뀌어도 이 규칙이 남아야 하기 때문이다.
    expect(['ProductVariant_stock_check', 'ProductVariant_reserved_check']).toContain(
      error.constraint,
    )
  })

  it('refuses a SKU with a space in it', async () => {
    const row = await product()
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, sku: 'TSHIRT 1' }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_sku_format_check')
  })

  it('refuses a SKU with a slash in it', async () => {
    const row = await product()
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, sku: 'TSHIRT/1' }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_sku_format_check')
  })

  it('allows the shapes an export and an importer both survive', async () => {
    const row = await product()

    await expect(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, sku: 'TSHIRT-BLACK_M.2' }),
    ).resolves.toMatchObject({ sku: 'TSHIRT-BLACK_M.2' })
  })

  it('refuses a variant purchase cap of zero', async () => {
    const row = await product()
    const error = await refusal(
      createProductVariant(db, { productId: row.id, sellerId: seller.id, maxPurchaseQuantity: 0 }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_maxPurchaseQuantity_check')
  })
})

describe('options, choices and images — the text checks', () => {
  it('refuses two live axes of the same name', async () => {
    const row = await product()

    await createProductOption(db, { productId: row.id, name: '색상' })

    const error = await refusal(createProductOption(db, { productId: row.id, name: '색상' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('ProductOption_product_name_key')
  })

  it('lets a retired axis free its name', async () => {
    const row = await product()
    const option = await createProductOption(db, { productId: row.id, name: '색상' })

    await db.execute(`UPDATE "ProductOption" SET "deletedAt" = now() WHERE "id" = $1`, [option.id])

    await expect(
      createProductOption(db, { productId: row.id, name: '색상' }),
    ).resolves.toMatchObject({ name: '색상' })
  })

  it('refuses two live choices of the same value', async () => {
    const row = await product()
    const option = await createProductOption(db, { productId: row.id })

    await createProductOptionValue(db, { optionId: option.id, value: '블랙' })

    const error = await refusal(
      createProductOptionValue(db, { optionId: option.id, value: '블랙' }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('ProductOptionValue_option_value_key')
  })

  it('allows the same label on another axis', async () => {
    const row = await product()
    const colour = await createProductOption(db, { productId: row.id, name: '색상' })
    const size = await createProductOption(db, { productId: row.id, name: '사이즈' })

    await createProductOptionValue(db, { optionId: colour.id, value: 'F' })

    // 색상 `F` and 사이즈 `F` are different choices, which is also why the
    // service retires choices per axis rather than against a union.
    await expect(
      createProductOptionValue(db, { optionId: size.id, value: 'F' }),
    ).resolves.toMatchObject({ value: 'F' })
  })

  it('refuses a blank axis name', async () => {
    const row = await product()
    const error = await refusal(createProductOption(db, { productId: row.id, name: '  ' }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductOption_name_check')
  })

  it('refuses a blank choice', async () => {
    const row = await product()
    const option = await createProductOption(db, { productId: row.id })
    const error = await refusal(createProductOptionValue(db, { optionId: option.id, value: ' ' }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductOptionValue_value_check')
  })

  it('refuses choice metadata that is not an object', async () => {
    const row = await product()
    const option = await createProductOption(db, { productId: row.id })
    const error = await refusal(
      db.execute(
        `INSERT INTO "ProductOptionValue" ("id", "optionId", "value", "meta", "updatedAt")
         VALUES ($1, $2, '블랙', '"#000000"'::jsonb, now())`,
        [randomUUID(), option.id],
      ),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductOptionValue_meta_object_check')
  })

  it('allows a colour chip', async () => {
    const row = await product()
    const option = await createProductOption(db, { productId: row.id })

    await expect(
      createProductOptionValue(db, { optionId: option.id, meta: { hex: '#000000' } }),
    ).resolves.toBeDefined()
  })

  it('refuses a blank image URL', async () => {
    const row = await product()
    const error = await refusal(
      db.execute(`INSERT INTO "ProductImage" ("id", "productId", "url") VALUES ($1, $2, '')`, [
        randomUUID(),
        row.id,
      ]),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductImage_url_check')
  })

  it('refuses a negative display order', async () => {
    const row = await product()
    const error = await refusal(
      db.execute(
        `INSERT INTO "ProductImage" ("id", "productId", "url", "sortOrder") VALUES ($1, $2, 'https://cdn/x.jpg', -1)`,
        [randomUUID(), row.id],
      ),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductImage_sortOrder_check')
  })
})

describe('what the database accepts — the other half of the boundary', () => {
  it('accepts a signature that disagrees with the mapping rows', async () => {
    const mapped = await combination()

    // Telling a signature from its mappings needs an aggregate and a CHECK may
    // not contain one, so `ProductService` writes both in one transaction and
    // that is the whole of the guarantee (TASK-0032 4.3, R3). Pinned here so
    // that "the database will catch it" never becomes the reason the service
    // stops doing it.
    await expect(
      db.execute(`UPDATE "ProductVariant" SET "optionSignature" = $1 WHERE "id" = $2`, [
        randomUUID(),
        mapped.variantId,
      ]),
    ).resolves.toBe(1)
  })

  it('accepts a minimum price that is not the minimum', async () => {
    const row = await product()

    await createProductVariant(db, { productId: row.id, sellerId: seller.id, price: 9_000 })

    // Same reason: an aggregate over other rows. `minPrice` is held by the
    // service recomputing it under the product's row lock (TASK-0032 4.6, 4.7),
    // which is why that rule has a concurrency spec and the ones above do not.
    await expect(
      db.execute(`UPDATE "Product" SET "minPrice" = 1 WHERE "id" = $1`, [row.id]),
    ).resolves.toBe(1)
  })

  it('accepts a product whose seller belongs to another category tree', async () => {
    // There is nothing to enforce here and that is the point of listing it: a
    // product may sit in any category, so a wrong category is a mistake only a
    // person can see. The service does not pretend otherwise.
    const elsewhere = await createCategory(db)

    await expect(
      createProduct(db, { sellerId: seller.id, categoryId: elsewhere.id }),
    ).resolves.toBeDefined()
  })
})
