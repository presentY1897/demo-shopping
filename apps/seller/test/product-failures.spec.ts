/**
 * Where a refused save is drawn (TASK-0114 4장 · F11).
 *
 * **The distinction the codes buy is only real if the screen spends it.**
 * TASK-0113 defined six `PRODUCT_*` codes so that six different repairs could
 * be offered; a screen that drew them all the same way would have made that
 * work invisible. These are the assertions that keep the placement honest, and
 * they are cheap because the decision is a pure function.
 */

import { describe, expect, it } from 'vitest'

import type { ApiFailure } from '@/lib/api-failure'
import {
  isSellerInactive,
  isVersionConflict,
  placementOf,
  refusedFields,
} from '@/lib/products/product-failures'

/** The fields the editor's own form renders. */
const FORM_FIELDS = ['name', 'description', 'maxPurchaseQuantity', 'attributes.brand']

function refusal(
  code: string,
  entries: readonly { field: string; message: string }[] = [],
  status = 400,
): ApiFailure {
  return {
    kind: 'http',
    status,
    code,
    message: '서버 문장',
    details: entries.map((entry) => ({ ...entry, code })),
    requestId: null,
  }
}

describe('a failure that never reached the API', () => {
  it('is a toast, because there is nothing to point at', () => {
    const failure: ApiFailure = { kind: 'transport', reason: 'network' }

    expect(placementOf(failure, FORM_FIELDS)).toBe('toast')
    expect(refusedFields(failure)).toEqual([])
  })
})

describe('a refusal that blocks the whole screen', () => {
  it('puts the store"s own state in a banner', () => {
    // 403 with no field. The opposite advice from an ownership 403: this store
    // *is* theirs and is not approved yet (TASK-0113 4장).
    const failure = refusal('PRODUCT_SELLER_INACTIVE', [], 403)

    expect(placementOf(failure, FORM_FIELDS)).toBe('banner')
    expect(isSellerInactive(failure)).toBe(true)
  })

  it('puts a lost optimistic lock in a banner even though it names a field', () => {
    // It names `version`, and `version` is not an input. Placing it by field
    // would put a message under a control that does not exist.
    const failure = refusal(
      'PRODUCT_VERSION_CONFLICT',
      [{ field: 'version', message: '다른 사람이 먼저 저장했어요.' }],
      409,
    )

    expect(placementOf(failure, FORM_FIELDS)).toBe('banner')
    expect(isVersionConflict(failure)).toBe(true)
  })
})

describe('a refusal whose repair is in the table', () => {
  it('puts the combination cap above the table', () => {
    expect(
      placementOf(
        refusal('PRODUCT_TOO_MANY_VARIANTS', [{ field: 'options', message: '너무 많아요' }]),
        FORM_FIELDS,
      ),
    ).toBe('table')
  })

  it('puts "nothing is orderable" above the table, not under a status control', () => {
    // `status` is the field the server names, but the switch to flip is in the
    // table's 판매 column.
    expect(
      placementOf(
        refusal('PRODUCT_NOT_SELLABLE', [
          { field: 'status', message: '주문할 수 있는 옵션이 없어요' },
        ]),
        FORM_FIELDS,
      ),
    ).toBe('table')
  })

  it('puts a taken SKU above the table, though the server names no row', () => {
    // The answer came from a unique index over every live variant of the store,
    // so the server cannot say which row. The column to change is in the table.
    expect(placementOf(refusal('PRODUCT_SKU_TAKEN', [], 409), FORM_FIELDS)).toBe('table')
  })

  it('puts a duplicated option value above the table', () => {
    expect(
      placementOf(
        refusal('INVALID', [{ field: 'options.0.values.1.value', message: '같은 값이 두 번' }]),
        FORM_FIELDS,
      ),
    ).toBe('table')
  })

  it('puts a missing bulk price above the table', () => {
    expect(
      placementOf(
        refusal('INVALID', [{ field: 'variantDefaults', message: '기본 가격이 필요해요' }]),
        FORM_FIELDS,
      ),
    ).toBe('table')
  })
})

describe('a refusal about one input', () => {
  it('puts every empty required attribute on its own field', () => {
    // Both at once (TASK-0113 F3): one at a time would make the seller press
    // 판매 시작 twice.
    const failure = refusal('PRODUCT_ATTRIBUTES_REQUIRED', [
      { field: 'attributes.brand', message: '채워 주세요' },
    ])

    expect(placementOf(failure, FORM_FIELDS)).toBe('fields')
    expect(refusedFields(failure)).toEqual(['attributes.brand'])
  })

  it('puts a rejected image URL on the field that carries it', () => {
    expect(
      placementOf(
        refusal('INVALID', [{ field: 'images.1.url', message: '다른 스토어의 이미지예요' }]),
        [...FORM_FIELDS, 'images.1.url'],
      ),
    ).toBe('fields')
  })
})

describe('a refusal this screen has no place for', () => {
  it('is shown as a toast rather than swallowed', () => {
    // A save that appears to do nothing is the worst outcome.
    expect(placementOf(refusal('INTERNAL_ERROR', [], 500), FORM_FIELDS)).toBe('toast')
  })

  it('is a toast when the field it names is not one this form renders', () => {
    expect(
      placementOf(refusal('INVALID', [{ field: 'categoryId', message: '없는 분류' }]), FORM_FIELDS),
    ).toBe('toast')
  })

  it('is not mistaken for a conflict or a store-state refusal', () => {
    const failure = refusal('INTERNAL_ERROR', [], 500)

    expect(isVersionConflict(failure)).toBe(false)
    expect(isSellerInactive(failure)).toBe(false)
    expect(isVersionConflict({ kind: 'transport', reason: 'timeout' })).toBe(false)
    expect(isSellerInactive({ kind: 'transport', reason: 'timeout' })).toBe(false)
  })
})
