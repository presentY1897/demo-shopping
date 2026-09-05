import type { Product, ProductVariant } from '@shopping/shared'

/**
 * 옵션 선택 → Variant 확정 (TASK-0043 F1 · F2 · F3).
 *
 * **품절과 없는 조합은 다른 상태다.** 품절은 SKU 가 있고 지금 살 수 없는 것이고,
 * 없는 조합은 판매자가 만들지 않은 것이다. 화면도 다르게 말해야 하므로 이 모듈은
 * 둘을 합치지 않는다 — `'sold_out'` 과 `'missing'` 이 끝까지 따로 간다.
 *
 * Pure input to output. The combination map is not built here and is not built
 * anywhere: `ProductVariant.optionValueIds` already carries it, in the product's
 * own axis order (TASK-0032). What this does is read it from the other
 * direction — 「이 값을 고르면 남는 조합이 있는가」.
 *
 * Availability for one axis is computed from the selections on the **other**
 * axes only. Otherwise choosing 블랙 would make every size but the chosen one
 * unavailable, which is the selection eating itself.
 */

/** What a screen draws for one choice on one axis. */
export type ValueAvailability = 'available' | 'sold_out' | 'missing'

/** `optionId → optionValueId`. Partial while a shopper is still choosing. */
export type Selection = Readonly<Record<string, string>>

function isOrderable(variant: ProductVariant): boolean {
  // 실물 재고가 아니라 **가용재고**다 (TASK-0048 F6). 남이 주문서에 들고 있는 몫은
  // 살 수 없고, 「구매 가능」으로 보여 준 뒤 주문에서 거절하는 것이 가장 나쁘다.
  return variant.isActive && variant.availableStock > 0
}

/** Variants whose combination contains every value in `wanted`. */
function matching(
  variants: readonly ProductVariant[],
  wanted: readonly string[],
): readonly ProductVariant[] {
  return variants.filter((variant) => wanted.every((id) => variant.optionValueIds.includes(id)))
}

/** The values a selection pins, excluding one axis. */
function otherValues(product: Product, selection: Selection, exceptOptionId: string): string[] {
  return product.options
    .filter((option) => option.id !== exceptOptionId)
    .map((option) => selection[option.id])
    .filter((value): value is string => value !== undefined)
}

/**
 * Every choice on every axis, with the state a screen draws it in.
 *
 * `optionId → valueId → state`.
 */
export function availability(
  product: Product,
  selection: Selection,
): Readonly<Record<string, Readonly<Record<string, ValueAvailability>>>> {
  const byOption: Record<string, Record<string, ValueAvailability>> = {}

  for (const option of product.options) {
    const fixed = otherValues(product, selection, option.id)
    const perValue: Record<string, ValueAvailability> = {}

    for (const value of option.values) {
      const candidates = matching(product.variants, [...fixed, value.id])

      perValue[value.id] =
        candidates.length === 0
          ? 'missing'
          : candidates.some(isOrderable)
            ? 'available'
            : 'sold_out'
    }

    byOption[option.id] = perValue
  }

  return byOption
}

/**
 * The variant a selection names, or `null` while it is still incomplete.
 *
 * A product with no axes has exactly one variant and it is always the answer —
 * that variant is the thing carrying the price and the SKU (DECISIONS 3), and a
 * screen that waited for a selection there would never show a price.
 */
export function selectedVariant(product: Product, selection: Selection): ProductVariant | null {
  if (product.options.length === 0) return product.variants[0] ?? null

  const chosen = product.options.map((option) => selection[option.id])

  if (chosen.some((value) => value === undefined)) return null

  const wanted = chosen.filter((value): value is string => value !== undefined)

  return (
    product.variants.find(
      (variant) =>
        variant.optionValueIds.length === wanted.length &&
        wanted.every((id) => variant.optionValueIds.includes(id)),
    ) ?? null
  )
}

/**
 * Choosing a value — or clearing it, when it was already chosen.
 *
 * **Nothing else has to be cleared.** A value is only offered when a variant
 * exists for it *together with* everything else already selected
 * ({@link availability}), so a choice the screen allows can never invalidate one
 * already made. An earlier draft cleared conflicting axes here; it was
 * unreachable, because the button that would have caused the conflict is the one
 * the picker refuses.
 *
 * Clicking the selected value clears it, and that is the way out of a dead end:
 * a shopper who picked XL and now wants 카멜 — a pair nobody made — clicks XL
 * again. `aria-pressed` is what says the control does that.
 *
 * It takes no `Product` for the same reason: with nothing to reconcile there is
 * nothing to look up.
 */
export function choose(selection: Selection, optionId: string, valueId: string): Selection {
  const next: Record<string, string> = { ...selection }

  if (next[optionId] === valueId) delete next[optionId]
  else next[optionId] = valueId

  return next
}

/** How much of one variant a shopper may buy at once. `null` is no cap. */
export function purchaseLimit(product: Product, variant: ProductVariant | null): number | null {
  if (variant === null) return product.maxPurchaseQuantity

  const cap = variant.effectiveMaxPurchaseQuantity

  return cap === null ? variant.availableStock : Math.min(cap, variant.availableStock)
}

/** The price to show before anything is chosen: the cheapest orderable one. */
export function displayPrice(
  product: Product,
  variant: ProductVariant | null,
): { readonly price: number; readonly listPrice: number | null } | null {
  if (variant !== null) return { price: variant.price, listPrice: variant.listPrice }

  const orderable = product.variants.filter(isOrderable)
  const cheapest = [...(orderable.length > 0 ? orderable : product.variants)].sort(
    (left, right) => left.price - right.price,
  )[0]

  return cheapest === undefined ? null : { price: cheapest.price, listPrice: cheapest.listPrice }
}
