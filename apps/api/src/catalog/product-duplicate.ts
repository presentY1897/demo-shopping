import type { CreateProductRequest, Product } from '@shopping/shared'
import { PRODUCT_NAME_MAX_LENGTH } from '@shopping/shared'

/**
 * Turning a stored listing back into a create request (TASK-0115 4장).
 *
 * **Why a request and not an INSERT.** Duplication has to do six things that
 * creation already does — validate the category's attributes, refuse another
 * store's images, expand the axes into combinations, issue SKUs, derive
 * `minPrice`, record an opening balance — and a copy path with its own
 * statements is a second writer that will be missing one of them. Which one is
 * something the repository finds out later, in production, on the copies. So
 * this file produces the *input* to `ProductService.create` and the copy takes
 * the same road every other listing takes.
 *
 * That also makes the interesting part pure: no clock, no database, no
 * request. What a copy is — which fields carry over, which are deliberately
 * dropped, how a combination is named when its ids are about to change — is
 * decided by a function whose branches a unit test can reach, and the gate on
 * this file is branch coverage 100% (QUALITY-GATES Q5 — 순수 로직).
 *
 * **Three things do not carry over.**
 *
 * - **Stock.** A level that appeared without a movement is a level the ledger
 *   cannot explain (`docs/design/erd.md` 3 L1), false from the copy's first
 *   row. Every combination starts at zero, which records nothing.
 * - **SKUs.** `ProductVariant_seller_sku_key` refuses a live duplicate within a
 *   store, so copying them would make duplication always answer 409. Leaving
 *   them out hands the job to TASK-0113's generator, which already produces a
 *   name that cannot collide.
 * - **Status, version, ratings, sales.** The copy is a new listing; `create`
 *   starts all of them where a new listing starts them, and the result is a
 *   `DRAFT` nobody can order.
 */

/** What the copy's name ends with. */
export const DUPLICATE_NAME_SUFFIX = ' (복사본)'

/**
 * `<원본 이름> (복사본)`, trimmed to fit.
 *
 * The cap is not decoration: `productNameSchema` refuses anything longer than
 * {@link PRODUCT_NAME_MAX_LENGTH}, so a copy of a maximum-length name would be
 * refused by its own request — a 400 the caller can do nothing about, from a
 * button that only ever means "copy this". The head is what gets cut, because
 * the suffix is the part that says which of the two rows this is.
 */
export function duplicateName(name: string): string {
  const room = PRODUCT_NAME_MAX_LENGTH - DUPLICATE_NAME_SUFFIX.length
  const base = name.length > room ? name.slice(0, room).trimEnd() : name

  return `${base}${DUPLICATE_NAME_SUFFIX}`
}

/** Where one option value sits: which axis, and what it reads. */
interface Choice {
  readonly axis: number
  readonly value: string
}

/**
 * The create request that reproduces `product`.
 *
 * Combinations are named **by value**, in axis order, because that is the only
 * way a create request can name them: the option value ids of the copy do not
 * exist yet. `optionValueIds` on a stored variant has no guaranteed order
 * either — it is read from a join — so each id is resolved to its axis rather
 * than trusted to be in position.
 *
 * A variant whose combination uses a **retired** choice is left out. Such a
 * variant is still live but its choice no longer appears on any axis, so the
 * combination is not one the copy's grid produces, and naming it would be
 * refused as `unknown_combination`. It is also not something the seller can
 * still sell as it stands — the editor switched it off when the choice went.
 */
export function duplicateRequest(product: Product): CreateProductRequest {
  const choices = new Map<string, Choice>(
    product.options.flatMap((option, axis) =>
      option.values.map((value): [string, Choice] => [value.id, { axis, value: value.value }]),
    ),
  )
  const live = product.variants.filter((variant) =>
    variant.optionValueIds.every((id) => choices.has(id)),
  )
  const variants = live.map((variant) => ({
    optionValues: variant.optionValueIds
      .map((id) => choices.get(id))
      .filter((choice): choice is Choice => choice !== undefined)
      .sort((left, right) => left.axis - right.axis)
      .map((choice) => choice.value),
    price: variant.price,
    listPrice: variant.listPrice,
    maxPurchaseQuantity: variant.maxPurchaseQuantity,
    isActive: variant.isActive,
  }))

  return {
    categoryId: product.categoryId,
    name: duplicateName(product.name),
    ...(product.description === null ? {} : { description: product.description }),
    attributes: product.attributes,
    ...(product.maxPurchaseQuantity === null
      ? {}
      : { maxPurchaseQuantity: product.maxPurchaseQuantity }),
    images: product.images.map((image) => ({
      url: image.url,
      ...(image.alt === null ? {} : { alt: image.alt }),
    })),
    ...(product.options.length === 0
      ? {}
      : {
          options: product.options.map((option) => ({
            name: option.name,
            values: option.values.map((value) => ({
              value: value.value,
              ...(value.meta === null ? {} : { meta: value.meta }),
            })),
          })),
        }),
    // Every combination starts here, and every one of them is then overridden
    // with the price it had. The default only has to exist and be legal — it is
    // what a combination the source did not have would cost, and there is no
    // such combination.
    variantDefaults: { price: cheapestOf(live), stock: 0 },
    variants,
  }
}

/**
 * The lowest price among the variants being copied, or zero when there are
 * none.
 *
 * Not `product.minPrice`: that cache covers **orderable** variants only, so a
 * listing whose variants are all switched off carries `null` there while still
 * having prices — and `variantDefaults.price` may not be null.
 */
function cheapestOf(variants: readonly { readonly price: number }[]): number {
  return variants.reduce(
    (lowest, variant) => (variant.price < lowest ? variant.price : lowest),
    variants[0]?.price ?? 0,
  )
}
