import { isApiFieldError } from '@shopping/shared'

import type { ApiFailure } from '@/lib/api-failure'

/**
 * Where a refused save is drawn (TASK-0114 4장 「도메인 오류 코드를 어디에
 * 그리는가」).
 *
 * **The codes and the sentences are TASK-0113's. This is the placement.** Six
 * `PRODUCT_*` codes exist so that a screen can do six different things, and a
 * screen that showed all of them the same way would have thrown that away — the
 * codes would be a distinction the API pays for and nobody spends.
 *
 * A pure function rather than a chain of `if (code === …)` in the component,
 * for the reason `variant-rules.ts` gives about its own rules: this is a
 * decision with branches, so it belongs somewhere every branch can be reached
 * from a test.
 */

/**
 * The four places a failure can land.
 *
 * | | 언제 | 무엇이 붙나 |
 * | --- | --- | --- |
 * | `fields` | 고칠 것이 하나의 입력 안에 있다 | 컨트롤 아래 오류 문장 |
 * | `table` | 고칠 것이 옵션 · Variant 표 안에 흩어져 있다 | 표 바로 위 안내 |
 * | `banner` | 화면 전체가 막혔다 | 폼 위에 남는 배너 |
 * | `toast` | 알릴 뿐 고칠 것이 없다 | 사라지는 알림 |
 */
export type FailurePlacement = 'fields' | 'table' | 'banner' | 'toast'

/**
 * Refusals that block the whole screen rather than one input.
 *
 * Neither is about a value the seller typed, and neither may disappear on a
 * timer — one is waiting for a decision somebody else makes, the other is a
 * choice the seller still has to take.
 */
const BANNER_CODES: readonly string[] = [
  /** 내 스토어가 맞고, 심사가 끝나지 않았다. 소유권 403 과 정반대의 다음 수다. */
  'PRODUCT_SELLER_INACTIVE',
  /** 다시 불러오면 풀린다. 「최신 내용 불러오기」와 「그대로 저장」을 함께 준다. */
  'PRODUCT_VERSION_CONFLICT',
]

/**
 * Refusals whose repair is somewhere in the option or variant table.
 *
 * `PRODUCT_SKU_TAKEN` is here and not on a field on purpose: the server cannot
 * say which row, because the answer came from a unique index over every live
 * variant of the store. What it can say is 「SKU 를 바꿔 주세요」, and the
 * column to change is in the table.
 */
const TABLE_CODES: readonly string[] = [
  'PRODUCT_TOO_MANY_VARIANTS',
  'PRODUCT_NOT_SELLABLE',
  'PRODUCT_SKU_TAKEN',
]

/**
 * Field paths that belong to the table rather than to a labelled control.
 *
 * `options.1.values.2.value` names an input the option editor renders, but that
 * input is one of dozens inside the same panel and it has no `FormField` of its
 * own — the set is a `fieldset`. So the message goes above the panel, where it
 * can be read before scrolling into it.
 */
const TABLE_FIELD_PREFIXES: readonly string[] = ['options', 'variants', 'variantDefaults', 'status']

/** Every field a refusal names, in the order the server listed them. */
export function refusedFields(failure: ApiFailure): readonly string[] {
  if (failure.kind !== 'http') return []

  return failure.details.filter(isApiFieldError).map((entry) => entry.field)
}

function namesTable(field: string): boolean {
  return TABLE_FIELD_PREFIXES.some((prefix) => field === prefix || field.startsWith(`${prefix}.`))
}

/**
 * Where this failure is drawn.
 *
 * The order is the design.
 *
 * 1. **Nothing arrived** — there is no code and no field, so there is nothing
 *    to point at. A toast, and the request can be tried again.
 * 2. **A code that blocks the screen** — before anything about fields, because
 *    `PRODUCT_VERSION_CONFLICT` *does* name `version` and `version` is not an
 *    input. Placing it by field would put a message under a control that does
 *    not exist.
 * 3. **A code whose repair is in the table.**
 * 4. **A field the table owns**, which covers `INVALID` on an option value or a
 *    combination — the same repair, arrived at without a domain code.
 * 5. **A field this form renders**, which is the ordinary case:
 *    `attributes.<key>`, `name`, `images.<n>.url`.
 * 6. **Anything else** — a code this screen has no place for. Shown rather than
 *    swallowed; a save that appears to do nothing is the worst outcome.
 */
export function placementOf(failure: ApiFailure, formFields: readonly string[]): FailurePlacement {
  if (failure.kind !== 'http') return 'toast'
  if (BANNER_CODES.includes(failure.code)) return 'banner'
  if (TABLE_CODES.includes(failure.code)) return 'table'

  const fields = refusedFields(failure)

  if (fields.some(namesTable)) return 'table'
  if (fields.some((field) => formFields.includes(field))) return 'fields'

  return 'toast'
}

/** A 409 the seller resolves by reloading rather than by retyping. */
export function isVersionConflict(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.code === 'PRODUCT_VERSION_CONFLICT'
}

/** A 403 about the store's own state, not about whose product this is. */
export function isSellerInactive(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.code === 'PRODUCT_SELLER_INACTIVE'
}

/**
 * No `codeFields` map, and that is a decision rather than an omission.
 *
 * `serverFieldErrors` takes one for failures the server can detect but cannot
 * attach to an input. Every refusal this screen places on a field already
 * names it — `PRODUCT_ATTRIBUTES_REQUIRED` carries one entry per empty key
 * (TASK-0113 F3) — and the two that name none go to the banner or above the
 * table, which is what {@link placementOf} decides before any of this runs.
 * A map here would be a second, weaker answer to a question already answered.
 */
