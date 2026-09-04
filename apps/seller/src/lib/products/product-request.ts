import type {
  CreateProductRequest,
  ProductImageInput,
  ProductOptionInput,
  ProductStatus,
  UpdateProductRequest,
} from '@shopping/shared'
import type { FieldDef } from '@shopping/ui/form'

import { attributeValuesFrom } from './attribute-values'
import type { OptionAxis } from './combinations'
import type { VariantBulk, VariantRow } from './variant-rows'
import { variantDefaultsFrom, variantInputsFrom } from './variant-rows'

/**
 * The save request, built from what the editor holds (TASK-0114 4장).
 *
 * Pure, and deliberately so: 「저장을 누르면 무엇이 나가는가」 is the question
 * every completion criterion about this screen is really asking (F4b wants
 * `maxPurchaseQuantity: 2` in the body, F7 wants the existing stock untouched),
 * and a function is a thing a test can ask that of directly.
 *
 * The request types come from `@shopping/shared` — the same ones `apps/api`
 * validates with — so a field this screen invents does not compile (C1).
 */

/** Everything the editor holds when the seller presses 저장. */
export interface EditorSubmission {
  /** What the generated form validated: base fields plus `attributes.<key>`. */
  readonly values: Readonly<Record<string, unknown>>
  /** The definitions the form was generated from, which say which keys to read. */
  readonly fields: readonly FieldDef[]
  readonly categoryId: number
  readonly axes: readonly OptionAxis[]
  readonly rows: readonly VariantRow[]
  readonly bulk: VariantBulk
  readonly images: readonly ProductImageInput[]
}

function text(values: Readonly<Record<string, unknown>>, key: string): string {
  const value = values[key]

  return typeof value === 'string' ? value.trim() : ''
}

/** `''` is "no cap"; the contract spells that `null`. */
function purchaseCap(values: Readonly<Record<string, unknown>>): number | null {
  const raw = text(values, 'maxPurchaseQuantity')

  if (raw === '') return null

  const parsed = Number(raw)

  return Number.isInteger(parsed) ? parsed : null
}

/**
 * The axes, as the contract states them.
 *
 * Trimmed here rather than in the editor's state: a seller who typed a trailing
 * space should see what they typed while they are typing, and should not have
 * their listing refused for it.
 */
function optionsOf(axes: readonly OptionAxis[]): ProductOptionInput[] {
  return axes.map((axis) => ({
    name: axis.name.trim(),
    values: axis.values.map((value) => ({ value: value.trim() })),
  }))
}

/**
 * Creating a listing.
 *
 * `options` is omitted when there are none, rather than sent as `[]`. Both are
 * accepted, but the absent form is what "이 상품은 옵션이 없다" means in the
 * contract, and a listing created with an empty array reads in a log as one
 * whose axes were lost.
 */
export function createRequestFrom(
  submission: EditorSubmission,
  status: ProductStatus,
): CreateProductRequest {
  const description = text(submission.values, 'description')

  return {
    categoryId: submission.categoryId,
    name: text(submission.values, 'name'),
    ...(description === '' ? {} : { description }),
    status,
    attributes: attributeValuesFrom(submission.values, submission.fields),
    ...(purchaseCap(submission.values) === null
      ? {}
      : { maxPurchaseQuantity: purchaseCap(submission.values) ?? undefined }),
    ...(submission.images.length === 0 ? {} : { images: [...submission.images] }),
    ...(submission.axes.length === 0 ? {} : { options: optionsOf(submission.axes) }),
    variantDefaults: variantDefaultsFrom(submission.bulk),
    variants: [...variantInputsFrom(submission.rows)],
  }
}

/**
 * Editing a listing.
 *
 * **Everything the editor holds is sent, every time.** A partial request would
 * mean a field the seller cleared kept its old value, which looks exactly like
 * a save that did not happen. `description` and `maxPurchaseQuantity` are
 * therefore sent as `null` when they are empty — the contract's own way of
 * saying "clear it" — rather than omitted.
 *
 * `version` is required and not optional: an update that may omit its lock is
 * an update that will omit it, and the conflict it was there to catch becomes a
 * silently discarded edit (DECISIONS 4).
 */
export function updateRequestFrom(
  submission: EditorSubmission,
  version: number,
  status: ProductStatus,
): UpdateProductRequest {
  const description = text(submission.values, 'description')

  return {
    version,
    categoryId: submission.categoryId,
    name: text(submission.values, 'name'),
    description: description === '' ? null : description,
    status,
    attributes: attributeValuesFrom(submission.values, submission.fields),
    maxPurchaseQuantity: purchaseCap(submission.values),
    images: [...submission.images],
    // The axes themselves cannot change (TASK-0113 4장), so this only ever
    // carries added or removed **choices** — which is exactly what the diff
    // above the table has been showing the seller (F7).
    ...(submission.axes.length === 0 ? {} : { options: optionsOf(submission.axes) }),
    variantDefaults: variantDefaultsFrom(submission.bulk),
    variants: [...variantInputsFrom(submission.rows)],
  }
}
