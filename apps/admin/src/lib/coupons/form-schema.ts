import type { CreateCouponRequest } from '@shopping/shared'
import {
  COUPON_MAX_DISCOUNT_VALUE,
  COUPON_MAX_ISSUE_LIMIT,
  COUPON_NAME_MAX_LENGTH,
  couponDiscountTypes,
} from '@shopping/shared'
import { z } from 'zod'

import { dayEnd, dayStart } from '@/lib/claims/claim-console'
import type { CouponFormMessages } from '@/messages'

import { integerFrom } from './platform-coupons'

/**
 * 발행 폼의 스키마 — **계약의 규칙에 이 콘솔의 말을 입힌 것.**
 *
 * `useForm` 은 zod 하나로 검사하는데, `apps/api` 가 요청을 파싱하는 스키마를 그대로
 * 쓸 수는 없다. 그쪽의 문장은 서버의 것이고 서버의 어휘는 구현의 어휘이기 때문이다.
 * 그래서 **판정은 `packages/shared` 에서 가져오고 문장만 이 앱의 것**이다
 * (`lib/attributes/form-schema.ts` 와 같은 규약). 규칙이 저쪽에서 바뀌면 여기가 함께
 * 바뀌는 것이 게이트 C1 이 요구하는 것이고, 두 번 적힌 규칙은 그렇지 않다.
 *
 * **필드 이름이 계약의 이름이다.** 서버가 거절할 때 실어 보내는 `details[].field` 가
 * `discountValue` · `maxDiscountAmount` · `scopeIds` · `validUntil` 이라
 * (`couponPolicyFaultFields`), 이름이 어긋나면 `serverFieldErrors` 가 그 문장을 어느
 * 칸에도 붙이지 못하고 폼 위의 한 줄로 밀어낸다 — 그러면 어느 칸을 고쳐야 하는지
 * 화면이 말하지 못한다. 카테고리 셀렉트 하나가 `scopeIds` 라는 이름을 쓰는 것도 그
 * 이유다.
 *
 * **날짜는 날짜로 받고 순간으로 보낸다.** 계약이 받는 것은 `z.iso.datetime()` 이고
 * 사람이 고르는 것은 하루다. 그 사이를 화면이 한국 시간의 하루로 메우며, 그 규칙은
 * 클레임 콘솔이 이미 갖고 있어 다시 만들지 않았다 (`lib/claims/claim-console.ts`).
 */

/** 폼이 채워 넣는 초기값. 전부 문자열인 것은 입력 컨트롤이 그것만 다루기 때문이다. */
export const EMPTY_COUPON_FORM: Readonly<Record<string, unknown>> = {
  name: '',
  discountType: '',
  discountValue: '',
  maxDiscountAmount: '',
  minOrderAmount: '0',
  scopeType: 'ALL',
  scopeIds: '',
  validFrom: '',
  validUntil: '',
  issueLimit: '',
  withCode: false,
}

/**
 * 이 화면이 고를 수 있는 범위 둘.
 *
 * 계약에는 넷이 있다(`couponScopeTypes`). 나머지 둘이 없는 이유는 문구가 말한다 —
 * 관리자 콘솔에 상품과 스토어를 빠짐없이 답하는 목록이 없어서이고, 그것은 이 TASK 가
 * 지어낼 것이 아니라 **없다고 보고할 것**이다.
 */
export const OFFERED_SCOPE_TYPES = ['ALL', 'CATEGORY'] as const

export type OfferedScopeType = (typeof OFFERED_SCOPE_TYPES)[number]

/** 서버가 거절을 붙일 수 있는 칸들. `serverFieldErrors` 가 이 목록 밖은 배치하지 않는다. */
export const COUPON_FORM_FIELDS = [
  'name',
  'discountType',
  'discountValue',
  'maxDiscountAmount',
  'minOrderAmount',
  'scopeType',
  'scopeIds',
  'validFrom',
  'validUntil',
  'issueLimit',
] as const

export function couponFormSchema(copy: CouponFormMessages['errors']) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, copy.nameRequired)
        .max(
          COUPON_NAME_MAX_LENGTH,
          copy.nameTooLong.replace('{max}', String(COUPON_NAME_MAX_LENGTH)),
        ),
      // 두 값은 계약의 것이고 문장만 이 앱의 것이다. 고르지 않은 유형은 `''` 로 오는데,
      // 그것은 둘 중 어느 것도 아니다.
      discountType: z.enum(couponDiscountTypes, { error: () => copy.discountTypeRequired }),
      discountValue: z.string(),
      maxDiscountAmount: z.string(),
      minOrderAmount: z.string(),
      scopeType: z.enum(OFFERED_SCOPE_TYPES),
      scopeIds: z.string(),
      validFrom: z.string().min(1, copy.periodRequired),
      validUntil: z.string().min(1, copy.periodRequired),
      issueLimit: z.string(),
      withCode: z.boolean(),
    })
    .check((ctx) => {
      const values = ctx.value
      const push = (message: string, path: string): void => {
        ctx.issues.push({ code: 'custom', input: values, message, path: [path] })
      }

      const discountValue = integerFrom(values.discountValue)

      if (discountValue === null || discountValue < 1)
        push(copy.discountValueRequired, 'discountValue')
      else if (values.discountType === 'PERCENT') {
        // 서버의 `policyFault` 가 같은 구간을 본다. 화면이 먼저 막는 것은 친절이고,
        // 규칙은 여전히 서버에 있다.
        if (discountValue > 100) push(copy.percentOutOfRange, 'discountValue')
      } else if (discountValue > COUPON_MAX_DISCOUNT_VALUE) {
        push(
          copy.amountOutOfRange.replace('{max}', String(COUPON_MAX_DISCOUNT_VALUE)),
          'discountValue',
        )
      }

      const ceiling = integerFrom(values.maxDiscountAmount)

      // 정액 할인의 상한이 **뜻이 없는 값**이라는 규칙(`max_discount_meaningless`)은
      // 여기 없다. 폼이 그 칸을 정률일 때만 내고 유형이 바뀔 때 값을 버리므로, 그
      // 거절은 화면에서 만들어질 수 없다 — 서버는 여전히 막는다.
      if (ceiling !== null && (ceiling < 1 || ceiling > COUPON_MAX_DISCOUNT_VALUE)) {
        push(
          copy.amountOutOfRange.replace('{max}', String(COUPON_MAX_DISCOUNT_VALUE)),
          'maxDiscountAmount',
        )
      }
      if (values.maxDiscountAmount.trim() !== '' && ceiling === null) {
        push(
          copy.amountOutOfRange.replace('{max}', String(COUPON_MAX_DISCOUNT_VALUE)),
          'maxDiscountAmount',
        )
      }

      const minimum = integerFrom(values.minOrderAmount)

      if (minimum === null) push(copy.minOrderInvalid, 'minOrderAmount')

      const limit = integerFrom(values.issueLimit)

      // 비어 있으면 무제한이다 — 「값이 없다」와 「0장」은 다른 뜻이고, 계약도 그것을
      // `null` 과 `0` 으로 나눠 말한다.
      if (values.issueLimit.trim() !== '' && (limit === null || limit < 1)) {
        push(copy.issueLimitInvalid.replace('{max}', String(COUPON_MAX_ISSUE_LIMIT)), 'issueLimit')
      }
      if (limit !== null && limit > COUPON_MAX_ISSUE_LIMIT) {
        push(copy.issueLimitInvalid.replace('{max}', String(COUPON_MAX_ISSUE_LIMIT)), 'issueLimit')
      }

      if (
        values.validFrom !== '' &&
        values.validUntil !== '' &&
        values.validUntil < values.validFrom
      ) {
        push(copy.periodInverted, 'validUntil')
      }

      // 대상이 필요한 범위에 대상이 없으면 서버가 `scope_targets_required` 로 거절한다.
      if (values.scopeType === 'CATEGORY' && values.scopeIds.trim() === '') {
        push(copy.categoryRequired, 'scopeIds')
      }
    })
    .transform((values): CreateCouponRequest => ({
      // 이것 하나가 「플랫폼 부담」이다. 부담 주체를 고르는 칸이 폼에 없는 이유다.
      sellerId: null,
      name: values.name.trim(),
      discountType: values.discountType,
      discountValue: integerFrom(values.discountValue) ?? 0,
      maxDiscountAmount: integerFrom(values.maxDiscountAmount),
      minOrderAmount: integerFrom(values.minOrderAmount) ?? 0,
      scopeType: values.scopeType,
      scopeIds: values.scopeType === 'CATEGORY' ? [values.scopeIds.trim()] : [],
      validFrom: dayStart(values.validFrom),
      validUntil: dayEnd(values.validUntil),
      issueLimit: integerFrom(values.issueLimit),
      withCode: values.withCode,
    }))
}
