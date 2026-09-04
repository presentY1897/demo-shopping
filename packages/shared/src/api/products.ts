import { z } from 'zod'

import { attributeValuesSchema } from './attributes.js'
import { categoryIdSchema } from './categories.js'

/**
 * Products, options and variants, as the API states them (TASK-0032).
 *
 * The model is three deep — a listing, the axes a buyer chooses along, and the
 * SKU that carries a price and a stock level — and the unit of both price and
 * stock is the **variant** (D-024). A product with no options still has one, so
 * that nothing downstream needs a branch for "you order this one directly".
 *
 * Contract gate C1: these schemas are the only definition of a product request
 * or response in the repository. `apps/api` validates its input with them and
 * the front-ends parse their answers with them, so a renamed field cannot be
 * green on one side and broken on the other. C3 then holds structurally,
 * because `createApiClient` parses every response with the very schema declared
 * here.
 */

/**
 * Product and variant ids are UUIDs, unlike a category's short integer.
 *
 * A product id travels in a public URL (`/products/[id]`) and a variant id is
 * what an order item, a stock ledger row and a reservation will point at
 * forever. A sequential number would publish how many products exist and invite
 * enumeration; see `docs/design/erd.md` 2 for the same argument made the other
 * way round for `Category`.
 */
export const productIdSchema = z.uuid()

export const variantIdSchema = z.uuid()

export const optionIdSchema = z.uuid()

export const optionValueIdSchema = z.uuid()

/** Where a listing is in its life (TASK-0032 4.9). */
export const productStatuses = ['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const

export type ProductStatus = (typeof productStatuses)[number]

export const productStatusSchema = z.enum(productStatuses)

/**
 * The status a seller may set.
 *
 * `SUSPENDED` is the site operator's forced hide, and a seller who could clear
 * it would make it not a forced hide. The rule is enforced by the API against
 * the caller's grants rather than by this schema — a request to suspend is well
 * formed, it is just not one every caller may make — so this list exists for a
 * console building a dropdown, not as the validation.
 */
export const sellerSettableStatuses: readonly ProductStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE']

export const PRODUCT_NAME_MAX_LENGTH = 120

export const productNameSchema = z.string().trim().min(1).max(PRODUCT_NAME_MAX_LENGTH)

export const PRODUCT_DESCRIPTION_MAX_LENGTH = 5_000

export const productDescriptionSchema = z.string().trim().max(PRODUCT_DESCRIPTION_MAX_LENGTH)

/**
 * A stock keeping unit: the seller's own identifier for one variant.
 *
 * The same expression the database holds as
 * `ProductVariant_sku_format_check`. Strict because the string is typed into a
 * spreadsheet, printed on a label and pasted into a URL — a SKU carrying a
 * slash or a newline turns a stock export into something no importer reads back.
 *
 * Unique per **seller** among live variants, not globally: two stores each
 * naming a variant `TSHIRT-BLACK-M` is a coincidence, not a conflict.
 */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const skuSchema = z.string().regex(SKU_PATTERN)

/**
 * The prefix generated SKUs are built from, when the caller does not name each
 * one — `TSHIRT` becomes `TSHIRT-1` … `TSHIRT-12`.
 *
 * Shorter than a SKU so that the suffix always fits inside the SKU's own limit.
 */
export const SKU_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

export const skuPrefixSchema = z.string().regex(SKU_PREFIX_PATTERN)

/**
 * An amount in whole KRW.
 *
 * Integer because money is integer here (CLAUDE.md 6장) and a float would
 * reintroduce rounding drift into every discount and every settlement. Capped
 * so that an accidental extra zero is refused where a person can still see it —
 * a hundred million won is far above anything this catalogue sells and far
 * below the point where an integer stops being exact.
 */
export const PRODUCT_MAX_PRICE = 100_000_000

export const priceSchema = z.int().min(0).max(PRODUCT_MAX_PRICE)

/** On-hand quantity of one variant. The ledger that explains it is TASK-0036. */
export const PRODUCT_MAX_STOCK = 1_000_000

export const stockSchema = z.int().min(0).max(PRODUCT_MAX_STOCK)

/**
 * A cap on how many of one variant a single order may contain
 * (TASK-0032 4.1).
 *
 * At least 1: a cap of zero is not a cap, it is a product nobody may buy, and
 * `null` is how "no cap" is said.
 */
export const PRODUCT_MAX_PURCHASE_QUANTITY = 999

export const purchaseLimitSchema = z.int().min(1).max(PRODUCT_MAX_PURCHASE_QUANTITY)

/**
 * How many axes a product may have, and how many choices each may offer.
 *
 * The cap exists because the combination count is their **product**: three axes
 * of thirty values is twenty-seven thousand variants, which is not a listing
 * anybody meant to create — it is a mistake that would take a minute to write
 * and an afternoon to undo. {@link PRODUCT_MAX_VARIANTS} is the real limit and
 * these two only keep a request from being obviously absurd before it is
 * expanded.
 */
export const PRODUCT_MAX_OPTIONS = 3

export const PRODUCT_MAX_OPTION_VALUES = 40

export const PRODUCT_MAX_VARIANTS = 200

export const optionNameSchema = z.string().trim().min(1).max(40)

export const optionValueSchema = z.string().trim().min(1).max(40)

/**
 * Presentation extras attached to one choice — a colour chip's hex, a size
 * chart's measurements.
 *
 * Deliberately an open record rather than a modelled object: it differs per
 * axis and giving each kind a field would make adding one a migration. An
 * object, though, and not `unknown`: `meta` is rendered, and an array or a bare
 * string there is a value no screen knows what to do with.
 */
export const optionValueMetaSchema = z.record(z.string(), z.union([z.string(), z.number()]))

export type OptionValueMeta = z.infer<typeof optionValueMetaSchema>

export const PRODUCT_MAX_IMAGES = 10

export const productImageSchema = z.object({
  id: z.uuid(),
  url: z.string().min(1),
  alt: z.string().nullable(),
  sortOrder: z.int().min(0),
})

export type ProductImage = z.infer<typeof productImageSchema>

/** One choice on one axis, as it is stored. */
export const productOptionValueSchema = z.object({
  id: optionValueIdSchema,
  value: z.string(),
  meta: optionValueMetaSchema.nullable(),
  sortOrder: z.int().min(0),
})

export type ProductOptionValue = z.infer<typeof productOptionValueSchema>

/** One axis, with its live choices in display order. */
export const productOptionSchema = z.object({
  id: optionIdSchema,
  name: z.string(),
  sortOrder: z.int().min(0),
  values: z.array(productOptionValueSchema),
})

export type ProductOption = z.infer<typeof productOptionSchema>

/**
 * One SKU: the thing that has a price and a stock level.
 *
 * `optionValueIds` is the combination, in the product's own axis order, so a
 * caller can match a buyer's selection against it without another request. It
 * is empty for a product with no options — the one variant such a product has.
 */
export const productVariantSchema = z.object({
  id: variantIdSchema,
  sku: z.string(),
  price: priceSchema,
  /** The struck-through price. `null` means there is no discount to show. */
  listPrice: priceSchema.nullable(),
  stock: stockSchema,
  /** This variant's own cap; `null` inherits the product's. */
  maxPurchaseQuantity: purchaseLimitSchema.nullable(),
  /**
   * The cap that actually applies, product default already resolved
   * (TASK-0032 4.1).
   *
   * Sent even though a caller could compute it, because four different places
   * have to enforce this limit (basket, checkout, reservation, order creation)
   * and four independent `variant.max ?? product.max` expressions is how the
   * fourth one ends up with the precedence backwards.
   */
  effectiveMaxPurchaseQuantity: purchaseLimitSchema.nullable(),
  isActive: z.boolean(),
  optionValueIds: z.array(optionValueIdSchema),
})

export type ProductVariant = z.infer<typeof productVariantSchema>

/** One listing, with everything a detail page or an editor needs. */
export const productSchema = z.object({
  id: productIdSchema,
  sellerId: z.uuid(),
  categoryId: categoryIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: productStatusSchema,
  /** Values keyed by `AttributeDefinition.key`; validated on every save. */
  attributes: attributeValuesSchema,
  maxPurchaseQuantity: purchaseLimitSchema.nullable(),
  /** Lowest price among orderable variants; `null` when nothing is sellable. */
  minPrice: priceSchema.nullable(),
  /** Average review score **times 100**, so 4.35 stars is `435` (M13 fills it). */
  ratingAvg: z.int().min(0).max(500),
  ratingCount: z.int().min(0),
  salesCount: z.int().min(0),
  /** Optimistic lock; send it back in an update (DECISIONS 4). */
  version: z.int().min(0),
  images: z.array(productImageSchema),
  options: z.array(productOptionSchema),
  variants: z.array(productVariantSchema),
})

export type Product = z.infer<typeof productSchema>

/**
 * One row of a list.
 *
 * Not the whole product: a seller's catalogue page shows twenty of these and
 * the variants of twenty products are a payload nobody renders. `variantCount`
 * and `thumbnailUrl` are what the row actually draws.
 */
export const productSummarySchema = z.object({
  id: productIdSchema,
  sellerId: z.uuid(),
  categoryId: categoryIdSchema,
  name: z.string(),
  status: productStatusSchema,
  minPrice: priceSchema.nullable(),
  ratingAvg: z.int().min(0).max(500),
  ratingCount: z.int().min(0),
  salesCount: z.int().min(0),
  /** Live variants, whether or not they are currently orderable. */
  variantCount: z.int().min(0),
  /** Total stock across live variants — the console's "재고" column. */
  stock: z.int().min(0),
  thumbnailUrl: z.string().nullable(),
  version: z.int().min(0),
})

export type ProductSummary = z.infer<typeof productSummarySchema>

export const productResponseSchema = z.object({ product: productSchema })

export type ProductResponse = z.infer<typeof productResponseSchema>

/**
 * A page of listings.
 *
 * `nextCursor` is the id to pass back, or `null` at the end. Ids are UUIDv7 and
 * therefore already in creation order, so "newest first" is `ORDER BY id DESC`
 * and the cursor needs nothing but the last id — no `(createdAt, id)` pair to
 * keep consistent, and no offset that shifts under an insert.
 */
export const productListResponseSchema = z.object({
  products: z.array(productSummarySchema),
  nextCursor: productIdSchema.nullable(),
})

export type ProductListResponse = z.infer<typeof productListResponseSchema>

export const PRODUCT_LIST_MAX_LIMIT = 100

export const PRODUCT_LIST_DEFAULT_LIMIT = 20

/** Query of `GET /api/v1/products`, as a caller writes it. */
export const productListQuerySchema = z.object({
  /** Omitted means "every seller", which only an operator's grants allow. */
  sellerId: z.uuid().optional(),
  categoryId: categoryIdSchema.optional(),
  status: productStatusSchema.optional(),
  limit: z.int().min(1).max(PRODUCT_LIST_MAX_LIMIT).optional(),
  cursor: productIdSchema.optional(),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>

/**
 * The same query as it arrives on the wire, where every value is a string.
 *
 * Kept beside the typed form instead of in the controller so that the two
 * cannot drift: adding a parameter to one without the other stops compiling.
 */
export const productListQueryParamsSchema = z.object({
  sellerId: z.uuid().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  status: productStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PRODUCT_LIST_MAX_LIMIT).optional(),
  cursor: productIdSchema.optional(),
})

const imageInputSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
  alt: z.string().trim().max(200).optional(),
})

const optionInputSchema = z.object({
  name: optionNameSchema,
  values: z
    .array(z.object({ value: optionValueSchema, meta: optionValueMetaSchema.optional() }))
    .min(1)
    .max(PRODUCT_MAX_OPTION_VALUES),
})

/**
 * What a caller may say about one combination.
 *
 * `optionValues` names the combination by **value**, in the same order as
 * `options` — `['블랙', 'M']`. Naming it by id would be impossible in a create
 * request, where the ids do not exist yet, and naming it by index would make a
 * request unreadable in a log.
 *
 * Every field but the combination is optional: an entry is an **override** on
 * top of {@link variantDefaultsSchema}, not a full definition. Combinations
 * nobody mentions are still created — a product sells the whole grid unless a
 * variant is switched off, which is how "일부 조합만 판매" is expressed
 * (TASK-0032 4장).
 */
const variantInputSchema = z.object({
  optionValues: z.array(optionValueSchema).max(PRODUCT_MAX_OPTIONS),
  sku: skuSchema.optional(),
  price: priceSchema.optional(),
  listPrice: priceSchema.nullable().optional(),
  stock: stockSchema.optional(),
  maxPurchaseQuantity: purchaseLimitSchema.nullable().optional(),
  isActive: z.boolean().optional(),
})

/** What every generated combination starts from. */
export const variantDefaultsSchema = z.object({
  price: priceSchema,
  listPrice: priceSchema.optional(),
  stock: stockSchema.optional(),
  maxPurchaseQuantity: purchaseLimitSchema.optional(),
})

export type VariantDefaults = z.infer<typeof variantDefaultsSchema>

/**
 * Creating a listing.
 *
 * One request builds the whole thing — product, images, axes, choices and every
 * variant — because a product without variants is not a state anything can use:
 * it has no price, so it cannot be listed, and no SKU, so it cannot be ordered.
 * Letting it exist would mean every reader downstream carrying a branch for it.
 *
 * The variants are **generated**, not listed. `options` gives the axes and
 * `variantDefaults` gives what every combination starts from, so 색상 3 ×
 * 사이즈 4 is twelve variants without the caller writing twelve objects
 * (완료 기준 F1). `variants` then overrides individual ones.
 */
export const createProductRequestSchema = z.object({
  categoryId: categoryIdSchema,
  name: productNameSchema,
  description: productDescriptionSchema.optional(),
  /** Defaults to `DRAFT`. `ACTIVE` needs at least one orderable variant. */
  status: productStatusSchema.optional(),
  attributes: attributeValuesSchema.optional(),
  maxPurchaseQuantity: purchaseLimitSchema.optional(),
  images: z.array(imageInputSchema).max(PRODUCT_MAX_IMAGES).optional(),
  /** Omitted is a product with no options — which still gets one variant. */
  options: z.array(optionInputSchema).max(PRODUCT_MAX_OPTIONS).optional(),
  variantDefaults: variantDefaultsSchema,
  variants: z.array(variantInputSchema).optional(),
  /** Generated SKUs become `<prefix>-1`, `<prefix>-2`, … */
  skuPrefix: skuPrefixSchema.optional(),
})

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>

/**
 * Editing a listing.
 *
 * `options` may change the **choices** on an axis — adding one creates the
 * variants it takes part in, removing one switches those variants off (R1) —
 * but not the axes themselves. Changing the number or the order of the axes
 * changes the arity of every existing combination, which invalidates every
 * variant at once, and a listing with order history cannot survive that. The
 * API refuses it; replacing a draft wholesale is TASK-0113's contract
 * (TASK-0032 4.8).
 *
 * `version` is required, not optional: an update that may omit its lock is an
 * update that will omit it, and the conflict it was there to catch becomes a
 * silently discarded edit (DECISIONS 4).
 */
export const updateProductRequestSchema = z.object({
  version: z.int().min(0),
  categoryId: categoryIdSchema.optional(),
  name: productNameSchema.optional(),
  /** `null` clears the description. */
  description: productDescriptionSchema.nullable().optional(),
  status: productStatusSchema.optional(),
  /** Replaces the whole bag; it is validated against the category's definitions. */
  attributes: attributeValuesSchema.optional(),
  /** `null` removes the product-wide cap. */
  maxPurchaseQuantity: purchaseLimitSchema.nullable().optional(),
  /** Replaces the whole gallery. */
  images: z.array(imageInputSchema).max(PRODUCT_MAX_IMAGES).optional(),
  options: z.array(optionInputSchema).max(PRODUCT_MAX_OPTIONS).optional(),
  /** What combinations created by a new choice start from. */
  variantDefaults: variantDefaultsSchema.optional(),
  variants: z.array(variantInputSchema).optional(),
  skuPrefix: skuPrefixSchema.optional(),
})

export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>
