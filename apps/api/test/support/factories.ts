import { randomUUID } from 'node:crypto'

import type { Database } from './database.js'

/**
 * Row factories (writing convention T2).
 *
 * A spec states only the fields it is about and the factory fills the rest, so
 * a migration that adds a `NOT NULL` column is one edit here instead of one per
 * spec — and reading a test tells you immediately which values the assertion
 * actually depends on.
 *
 * They write with raw SQL rather than Prisma so that a constraint spec sees the
 * database's own answer; nothing here is allowed to reject a row on its own.
 *
 * Ids are generated per call and never hard-coded (T4): `RESTART IDENTITY`
 * hands every test the same sequence numbers, and a spec pinned to id `1` would
 * pass by coincidence.
 */

let sequence = 0

/** Unique within a run without depending on a database sequence. */
function unique(prefix: string): string {
  sequence += 1
  return `${prefix}-${String(sequence)}-${randomUUID().slice(0, 8)}`
}

export interface UserRow {
  readonly id: string
  readonly googleSub: string | null
  readonly email: string
  readonly isDemo: boolean
  readonly demoExpiresAt: Date | null
  readonly deletedAt: Date | null
}

export interface UserOptions {
  readonly id?: string
  readonly googleSub?: string | null
  readonly email?: string
  readonly name?: string
  readonly isDemo?: boolean
  readonly demoExpiresAt?: Date | null
  readonly deletedAt?: Date | null
}

/**
 * A live real account by default.
 *
 * `isDemo: true` flips the two columns together because
 * `User_demo_expiry_check` requires it — a factory that let them disagree would
 * make every caller responsible for a rule the database already states.
 */
export async function createUser(db: Database, options: UserOptions = {}): Promise<UserRow> {
  const isDemo = options.isDemo ?? false
  // `!== undefined` and not `??`: a spec that passes `demoExpiresAt: null` for a
  // demo account is asking the database to refuse it, and a default filled in
  // here would quietly turn that test into a passing no-op.
  const demoExpiresAt =
    options.demoExpiresAt !== undefined
      ? options.demoExpiresAt
      : isDemo
        ? new Date('2026-09-04T00:00:00.000Z')
        : null
  // A live real account must carry an identity (`User_google_identity_check`);
  // a demo one must not have signed in with Google at all.
  const googleSub =
    options.googleSub !== undefined ? options.googleSub : isDemo ? null : unique('sub')

  return db.one<UserRow>(
    `INSERT INTO "User" ("id", "googleSub", "email", "name", "isDemo", "demoExpiresAt", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING "id", "googleSub", "email", "isDemo", "demoExpiresAt", "deletedAt"`,
    [
      options.id ?? randomUUID(),
      googleSub,
      options.email ?? `${unique('user')}@example.com`,
      options.name ?? '테스트 사용자',
      isDemo,
      demoExpiresAt,
      options.deletedAt ?? null,
    ],
  )
}

export interface AddressRow {
  readonly id: string
  readonly userId: string
  readonly isDefault: boolean
}

export interface AddressOptions {
  readonly userId: string
  readonly isDefault?: boolean
  readonly label?: string
}

export async function createAddress(db: Database, options: AddressOptions): Promise<AddressRow> {
  return db.one<AddressRow>(
    `INSERT INTO "Address"
       ("id", "userId", "label", "recipientName", "phone", "postalCode", "addressLine1", "isDefault", "updatedAt")
     VALUES ($1, $2, $3, '수령인', '010-0000-0000', '06234', '서울시 강남구', $4, now())
     RETURNING "id", "userId", "isDefault"`,
    [randomUUID(), options.userId, options.label ?? unique('label'), options.isDefault ?? false],
  )
}

export interface SellerRow {
  readonly id: string
  readonly userId: string
  readonly commissionRateBp: number | null
}

export interface SellerOptions {
  readonly userId: string
  readonly commissionRateBp?: number | null
  readonly status?: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED'
}

/**
 * An approved store by default.
 *
 * `ACTIVE`, unlike the column's own `PENDING`: "ACTIVE 가 아니면 상품 등록과
 * 판매가 불가능하다" (`docs/design/state-machines.md`), so a specification
 * about products would otherwise have to say so every time it wanted a store
 * that can sell — and the one line it forgot would fail for a reason that has
 * nothing to do with what it was testing.
 */
export async function createSeller(db: Database, options: SellerOptions): Promise<SellerRow> {
  return db.one<SellerRow>(
    `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "commissionRateBp", "status", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::"SellerStatus", now())
     RETURNING "id", "userId", "commissionRateBp"`,
    [
      randomUUID(),
      options.userId,
      unique('brand'),
      unique('slug'),
      options.commissionRateBp ?? null,
      options.status ?? 'ACTIVE',
    ],
  )
}

export interface StockRow {
  readonly id: number
  readonly variant: string
  readonly stock: number
}

/** Fixture table, not part of the shipped schema — see `test/setup/test-schema.sql`. */
export async function createStock(
  db: Database,
  options: { readonly variant?: string; readonly stock: number },
): Promise<StockRow> {
  return db.one<StockRow>(
    `INSERT INTO "TestStock" ("variant", "stock") VALUES ($1, $2)
     RETURNING "id", "variant", "stock"`,
    [options.variant ?? unique('variant'), options.stock],
  )
}

export interface CategoryRow {
  readonly id: number
  readonly parentId: number | null
  readonly path: string
  readonly depth: number
  readonly slug: string
  readonly sortOrder: number
}

export interface CategoryOptions {
  readonly parent?: CategoryRow | null
  readonly name?: string
  readonly slug?: string
  readonly sortOrder?: number
  readonly isActive?: boolean
  readonly deletedAt?: Date | null
}

/**
 * A category, inserted the way the service inserts one.
 *
 * The id comes from the sequence and the path is built from it in the same
 * statement, because `Category_path_shape_check` refuses any row whose path
 * does not end in its own id — there is no moment at which a placeholder path
 * would be accepted.
 *
 * Raw SQL, like every factory here: a constraint spec has to see the database's
 * own answer, and Prisma's validation would answer first.
 */
export async function createCategory(
  db: Database,
  options: CategoryOptions = {},
): Promise<CategoryRow> {
  const parent = options.parent ?? null

  return db.one<CategoryRow>(
    `WITH allocated AS (
       SELECT nextval(pg_get_serial_sequence('"Category"', 'id'))::int AS id
     )
     INSERT INTO "Category"
       ("id", "parentId", "parentPath", "path", "depth",
        "name", "slug", "sortOrder", "isActive", "deletedAt", "updatedAt")
     SELECT a.id, $1::int, $2::text, COALESCE($2::text, '/') || a.id || '/', $3::int,
            $4, $5, $6, $7, $8, now()
       FROM allocated a
     RETURNING "id", "parentId", "path", "depth", "slug", "sortOrder"`,
    [
      parent?.id ?? null,
      parent?.path ?? null,
      (parent?.depth ?? 0) + 1,
      options.name ?? unique('카테고리'),
      options.slug ?? unique('cat'),
      options.sortOrder ?? 0,
      options.isActive ?? true,
      options.deletedAt ?? null,
    ],
  )
}

/**
 * A three-level branch: root > child > leaf.
 *
 * The shape every tree spec needs first, and the deepest one the schema allows.
 */
export async function createCategoryBranch(
  db: Database,
  prefix = 'branch',
): Promise<{ root: CategoryRow; child: CategoryRow; leaf: CategoryRow }> {
  const root = await createCategory(db, { slug: unique(`${prefix}-root`), name: '루트' })
  const child = await createCategory(db, {
    parent: root,
    slug: unique(`${prefix}-child`),
    name: '중간',
  })
  const leaf = await createCategory(db, {
    parent: child,
    slug: unique(`${prefix}-leaf`),
    name: '잎',
  })

  return { root, child, leaf }
}

export interface AttributeDefinitionRow {
  readonly id: number
  readonly categoryId: number
  readonly key: string
  readonly type: string
  readonly options: string[]
  readonly isRequired: boolean
  readonly sortOrder: number
}

export interface AttributeDefinitionOptions {
  readonly categoryId: number
  readonly key?: string
  readonly label?: string
  readonly type?: 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN'
  readonly options?: readonly string[]
  readonly isRequired?: boolean
  readonly isFilterable?: boolean
  readonly sortOrder?: number
  readonly deletedAt?: Date | null
}

/**
 * An attribute definition, inserted the way the service inserts one.
 *
 * A `TEXT` attribute by default, because that is the type with the fewest
 * preconditions — `AttributeDefinition_options_check` requires `SELECT` and
 * `MULTI_SELECT` to carry choices, so a spec asking for one of those has to say
 * what they are.
 *
 * Raw SQL, like every factory here: a constraint spec has to see the database's
 * own answer, and Prisma's validation would answer first.
 */
export async function createAttributeDefinition(
  db: Database,
  options: AttributeDefinitionOptions,
): Promise<AttributeDefinitionRow> {
  const type = options.type ?? 'TEXT'

  return db.one<AttributeDefinitionRow>(
    `INSERT INTO "AttributeDefinition"
       ("categoryId", "key", "label", "type", "options",
        "isRequired", "isFilterable", "sortOrder", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"AttributeType", $5::text[], $6, $7, $8, $9, now())
     RETURNING "id", "categoryId", "key", "type"::text AS "type", "options", "isRequired", "sortOrder"`,
    [
      options.categoryId,
      options.key ?? unique('attr').replaceAll('-', '_').toLowerCase(),
      options.label ?? '속성',
      type,
      options.options ?? [],
      options.isRequired ?? false,
      options.isFilterable ?? false,
      options.sortOrder ?? 0,
      options.deletedAt ?? null,
    ],
  )
}

// ---------------------------------------------------------------------------
// Products, options and variants (TASK-0032)
//
// Raw SQL like every factory above: a constraint spec has to see the database's
// own answer, and Prisma's validation — or `ProductService`'s — would answer
// first. Ids are generated per call rather than read back from a sequence,
// because these tables use UUIDs precisely so that nothing downstream depends
// on them being consecutive.
// ---------------------------------------------------------------------------

export interface ProductRow {
  readonly id: string
  readonly sellerId: string
  readonly categoryId: number
  readonly status: string
  readonly minPrice: number | null
}

export interface ProductOptions {
  readonly sellerId: string
  readonly categoryId: number
  readonly name?: string
  readonly status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  readonly attributes?: Record<string, unknown>
  readonly minPrice?: number | null
  readonly ratingAvg?: number
  readonly ratingCount?: number
  readonly salesCount?: number
  readonly maxPurchaseQuantity?: number | null
  readonly deletedAt?: Date | null
}

/**
 * A draft listing by default.
 *
 * `DRAFT` and not `ACTIVE`, because `Product_active_price_check` refuses a
 * listing on sale with no `minPrice` — and a factory that quietly filled one in
 * would be answering a question the specification wanted the database to
 * answer.
 */
export async function createProduct(db: Database, options: ProductOptions): Promise<ProductRow> {
  return db.one<ProductRow>(
    `INSERT INTO "Product"
       ("id", "sellerId", "categoryId", "name", "status", "attributes", "minPrice",
        "ratingAvg", "ratingCount", "salesCount", "maxPurchaseQuantity", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"ProductStatus", $6::jsonb, $7, $8, $9, $10, $11, $12, now())
     RETURNING "id", "sellerId", "categoryId", "status"::text AS "status", "minPrice"`,
    [
      randomUUID(),
      options.sellerId,
      options.categoryId,
      options.name ?? unique('상품'),
      options.status ?? 'DRAFT',
      JSON.stringify(options.attributes ?? {}),
      options.minPrice ?? null,
      options.ratingAvg ?? 0,
      options.ratingCount ?? 0,
      options.salesCount ?? 0,
      options.maxPurchaseQuantity ?? null,
      options.deletedAt ?? null,
    ],
  )
}

export interface ProductOptionRow {
  readonly id: string
  readonly productId: string
  readonly name: string
}

export async function createProductOption(
  db: Database,
  options: { readonly productId: string; readonly name?: string; readonly sortOrder?: number },
): Promise<ProductOptionRow> {
  return db.one<ProductOptionRow>(
    `INSERT INTO "ProductOption" ("id", "productId", "name", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, now())
     RETURNING "id", "productId", "name"`,
    [randomUUID(), options.productId, options.name ?? unique('옵션'), options.sortOrder ?? 0],
  )
}

export interface ProductOptionValueRow {
  readonly id: string
  readonly optionId: string
  readonly value: string
}

export async function createProductOptionValue(
  db: Database,
  options: {
    readonly optionId: string
    readonly value?: string
    readonly meta?: Record<string, unknown> | null
    readonly sortOrder?: number
    readonly deletedAt?: Date | null
  },
): Promise<ProductOptionValueRow> {
  return db.one<ProductOptionValueRow>(
    `INSERT INTO "ProductOptionValue"
       ("id", "optionId", "value", "meta", "sortOrder", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
     RETURNING "id", "optionId", "value"`,
    [
      randomUUID(),
      options.optionId,
      options.value ?? unique('값'),
      options.meta === undefined || options.meta === null ? null : JSON.stringify(options.meta),
      options.sortOrder ?? 0,
      options.deletedAt ?? null,
    ],
  )
}

export interface ProductVariantRow {
  readonly id: string
  readonly productId: string
  readonly sellerId: string
  readonly sku: string
  readonly price: number
  readonly optionSignature: string
}

export interface ProductVariantOptions {
  readonly productId: string
  readonly sellerId: string
  readonly sku?: string
  readonly price?: number
  readonly listPrice?: number | null
  readonly stock?: number
  readonly maxPurchaseQuantity?: number | null
  readonly isActive?: boolean
  readonly optionSignature?: string
  readonly deletedAt?: Date | null
}

/** A SKU with no combination — the shape an optionless product's variant has. */
export async function createProductVariant(
  db: Database,
  options: ProductVariantOptions,
): Promise<ProductVariantRow> {
  return db.one<ProductVariantRow>(
    `INSERT INTO "ProductVariant"
       ("id", "productId", "sellerId", "sku", "price", "listPrice", "stock",
        "maxPurchaseQuantity", "isActive", "optionSignature", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     RETURNING "id", "productId", "sellerId", "sku", "price", "optionSignature"`,
    [
      randomUUID(),
      options.productId,
      options.sellerId,
      options.sku ?? unique('SKU').toUpperCase(),
      options.price ?? 10_000,
      options.listPrice ?? null,
      options.stock ?? 10,
      options.maxPurchaseQuantity ?? null,
      options.isActive ?? true,
      options.optionSignature ?? '',
      options.deletedAt ?? null,
    ],
  )
}

/** Maps one variant onto one option value. Every copied column is supplied. */
export async function mapVariantOptionValue(
  db: Database,
  options: {
    readonly variantId: string
    readonly optionValueId: string
    readonly optionId: string
    readonly productId: string
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO "VariantOptionValue" ("variantId", "optionValueId", "optionId", "productId")
     VALUES ($1, $2, $3, $4)`,
    [options.variantId, options.optionValueId, options.optionId, options.productId],
  )
}

/**
 * A seller with a store and a category to sell in — the fixture every product
 * specification starts from.
 */
export async function createStorefront(
  db: Database,
): Promise<{ seller: SellerRow; category: CategoryRow }> {
  const owner = await createUser(db)

  return {
    seller: await createSeller(db, { userId: owner.id }),
    category: await createCategory(db),
  }
}
