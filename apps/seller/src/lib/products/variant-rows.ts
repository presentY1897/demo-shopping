import type { Product, ProductVariantInput, VariantDefaults } from '@shopping/shared'

import type { OptionAxis, StoredCombination } from './combinations'
import { combinationKeyOf, expandCombinations } from './combinations'

/**
 * The Variant table's rows, as values (TASK-0114 4장).
 *
 * **Every number is held as a string.** A price box that reads `0` before
 * anybody touches it is indistinguishable from one somebody set to zero, and a
 * partially typed `1` in a numeric field is not a number yet — the same reason
 * `field-def.ts` starts a `number` field at `''`. Parsing happens once, on the
 * way into the request.
 *
 * **A row is addressed by its combination, not by its position.** Adding a
 * choice to the *first* axis renumbers every row after it, so an index would
 * carry the price the seller typed for 블랙/M over to 아이보리/M. The key is the
 * choices themselves.
 */

/** One row of the table, exactly as the inputs hold it. */
export interface VariantRow {
  /** `combinationKeyOf(values)`. Stable across an axis gaining a choice. */
  readonly key: string
  /** The choices, in axis order. Empty for a product with no options. */
  readonly values: readonly string[]
  readonly sku: string
  readonly price: string
  readonly listPrice: string
  readonly stock: string
  readonly maxPurchaseQuantity: string
  readonly isActive: boolean
  /** The stored variant this row edits, or `null` for one that does not exist yet. */
  readonly variantId: string | null
}

/** What the bulk row applies to every combination that has no answer of its own. */
export interface VariantBulk {
  readonly price: string
  readonly listPrice: string
  readonly stock: string
  readonly maxPurchaseQuantity: string
}

export const EMPTY_BULK: VariantBulk = {
  price: '',
  listPrice: '',
  stock: '',
  maxPurchaseQuantity: '',
}

function blankRow(values: readonly string[]): VariantRow {
  return {
    key: combinationKeyOf(values),
    values,
    sku: '',
    price: '',
    listPrice: '',
    stock: '',
    maxPurchaseQuantity: '',
    isActive: true,
    variantId: null,
  }
}

/**
 * The rows these axes call for, carrying over what the seller has already typed.
 *
 * The same rule as the attribute form's, for the same reason: a table that
 * blanked itself whenever a choice was added would punish the seller for the
 * order they filled the form in. A combination that survives keeps its row; one
 * that has gone takes its typing with it.
 */
export function rowsFor(
  axes: readonly OptionAxis[],
  previous: readonly VariantRow[],
): readonly VariantRow[] {
  const held = new Map(previous.map((row) => [row.key, row] as const))

  return expandCombinations(axes).map((values) => {
    const key = combinationKeyOf(values)

    return held.get(key) ?? blankRow(values)
  })
}

/** The combinations of a stored listing, read back through its option values. */
export function storedCombinationsOf(product: Product): readonly StoredCombination[] {
  const valueOf = new Map(
    product.options.flatMap((option) => option.values.map((value) => [value.id, value.value])),
  )

  return product.variants.map((variant) => ({
    variantId: variant.id,
    // In axis order: `optionValueIds` is stored that way, and a combination
    // matched as an unordered set would pair the wrong two on a product whose
    // 색상 and 사이즈 both offer `F`.
    values: variant.optionValueIds.map((id) => valueOf.get(id) ?? ''),
    isActive: variant.isActive,
  }))
}

/** The axes of a stored listing, as the option editor holds them. */
export function axesOf(product: Product): readonly OptionAxis[] {
  return product.options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => value.value),
  }))
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * The table as a stored listing fills it in.
 *
 * Every cell carries what the server holds, including the SKU: an edit that
 * left it blank would be asking for one to be generated, and the seller would
 * find their labelled stock renamed by a save they thought changed a price.
 */
export function rowsFromProduct(product: Product): readonly VariantRow[] {
  const values = storedCombinationsOf(product)

  return product.variants.map((variant, index) => ({
    key: combinationKeyOf(values[index]?.values ?? []),
    values: values[index]?.values ?? [],
    sku: variant.sku,
    price: String(variant.price),
    listPrice: numberText(variant.listPrice),
    stock: String(variant.stock),
    maxPurchaseQuantity: numberText(variant.maxPurchaseQuantity),
    isActive: variant.isActive,
    variantId: variant.id,
  }))
}

/** The fields the bulk row can write. `isActive` is per row and never bulk. */
export type BulkField = keyof VariantBulk

/**
 * Writes one bulk value into every row.
 *
 * **Overwrites rather than fills the blanks.** 「전체 가격 동일 적용」 is a
 * seller saying what the price is, and a version that skipped the rows already
 * holding a number would leave exactly the rows they were trying to correct.
 * A blank bulk value is a no-op, so the button cannot silently erase the table.
 */
export function applyBulk(
  rows: readonly VariantRow[],
  field: BulkField,
  value: string,
): readonly VariantRow[] {
  if (value.trim() === '') return rows

  return rows.map((row) => ({ ...row, [field]: value }))
}

/** Replaces one row, matched by combination. */
export function patchRow(
  rows: readonly VariantRow[],
  key: string,
  patch: Partial<VariantRow>,
): readonly VariantRow[] {
  return rows.map((row) => (row.key === key ? { ...row, ...patch } : row))
}

/** `''` is "not answered"; anything else is the integer the seller typed. */
function optionalInt(value: string): number | undefined {
  const trimmed = value.trim()

  if (trimmed === '') return undefined

  const parsed = Number(trimmed)

  return Number.isInteger(parsed) ? parsed : undefined
}

/**
 * What every generated combination starts from.
 *
 * `price` is not optional in the contract, so the bulk price is a required
 * input of this screen — a listing whose new combinations had no price could
 * not be created at all, and finding that out from a 400 would be worse than
 * being asked for it.
 */
export function variantDefaultsFrom(bulk: VariantBulk): VariantDefaults {
  return {
    price: optionalInt(bulk.price) ?? 0,
    ...(optionalInt(bulk.listPrice) === undefined
      ? {}
      : { listPrice: optionalInt(bulk.listPrice) }),
    ...(optionalInt(bulk.stock) === undefined ? {} : { stock: optionalInt(bulk.stock) }),
    ...(optionalInt(bulk.maxPurchaseQuantity) === undefined
      ? {}
      : { maxPurchaseQuantity: optionalInt(bulk.maxPurchaseQuantity) }),
  }
}

/**
 * Every row as an override on its combination.
 *
 * All of them, not only the ones that differ from the defaults. The table is
 * what the seller is looking at, so what it says is what should be stored —
 * sending a subset would mean a cell they cleared quietly kept its old value,
 * which is the shape of bug nobody reports because it looks like the save
 * simply did not happen.
 *
 * A blank cell is left out of its entry, which is how "inherit the default" is
 * said. `maxPurchaseQuantity` is the exception: blank means **no cap on this
 * variant**, and the contract spells that `null` — omitting it would inherit
 * the bulk value the seller just cleared.
 */
export function variantInputsFrom(rows: readonly VariantRow[]): readonly ProductVariantInput[] {
  return rows.map((row) => ({
    optionValues: [...row.values],
    ...(row.sku.trim() === '' ? {} : { sku: row.sku.trim() }),
    ...(optionalInt(row.price) === undefined ? {} : { price: optionalInt(row.price) }),
    ...(row.listPrice.trim() === ''
      ? { listPrice: null }
      : { listPrice: optionalInt(row.listPrice) }),
    ...(optionalInt(row.stock) === undefined ? {} : { stock: optionalInt(row.stock) }),
    maxPurchaseQuantity: optionalInt(row.maxPurchaseQuantity) ?? null,
    isActive: row.isActive,
  }))
}
