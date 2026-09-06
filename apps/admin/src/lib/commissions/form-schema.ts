import type { SetCommissionRateRequest } from '@shopping/shared'
import { z } from 'zod'

import type { RatePercentRefusal } from './rate-bp'
import { rateBpFromPercent } from './rate-bp'
import { scopeIds, selectedScope } from './scopes'

/**
 * 요율을 바꾸는 폼의 스키마 — **네 칸을 계약의 세 칸으로.**
 *
 * `apps/seller` 의 `coupon-form.ts` 와 같은 모양이다: `z.unknown().transform` 으로
 * 감싸고, 판정은 이미 있는 것에서 가져오고, 문장만 이 앱의 것으로 갈아 끼운다. 규칙을
 * 다시 쓰지 않는 것이 요점이다 — 상한(100%)은 `rateBpFromPercent` 를 지나
 * `COMMISSION_RATE_MAX_BP` 에서 오고, 「스토어와 카테고리를 동시에 지정할 수 없다」는
 * {@link scopeIds} 가 애초에 그런 값을 만들 수 없게 해서 지켜진다.
 *
 * **퍼센트는 여기서 정수가 된다.** 폼이 들고 있는 것은 사람이 친 `3.5` 이고 계약이
 * 받는 것은 `350` 이며, 그 사이를 건너는 곳은 `rate-bp.ts` 하나뿐이다. 이 스키마를
 * 지나지 않고 서버로 갈 수 있는 요율은 없다.
 *
 * **거절은 칸 위에 선다.** `path` 가 폼의 이름과 같으므로(`FormField` 의 `name`),
 * 「카테고리를 고르세요」는 셀렉트 아래에, 「0에서 100 사이」는 입력 아래에 붙는다.
 */

/** 서버가 거절을 붙일 수 있는 칸들, 그리고 폼이 스스로 붙이는 칸들. */
export const COMMISSION_FORM_FIELDS = ['scope', 'categoryId', 'sellerId', 'ratePercent'] as const

/**
 * 폼이 채워 넣는 초기값.
 *
 * 전부 문자열인 것은 입력 컨트롤이 그것만 다루기 때문이고, 범위가 `global` 로
 * 시작하는 것은 **아무것도 더 고르지 않고도 완결된 범위**가 그것뿐이기 때문이다.
 */
export const EMPTY_COMMISSION_FORM: Readonly<Record<string, unknown>> = {
  scope: 'global',
  categoryId: '',
  sellerId: '',
  ratePercent: '',
}

export interface CommissionFieldErrorMessages {
  /** 「카테고리별」인데 카테고리를 고르지 않았다. */
  readonly categoryRequired: string
  readonly sellerRequired: string
  /** 요율 칸이 거절되는 네 가지 이유. `Record` 라 이유가 늘면 카탈로그가 걸린다. */
  readonly rate: Readonly<Record<RatePercentRefusal, string>>
}

function recordOf(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

function text(values: Record<string, unknown>, key: string): string {
  const value = values[key]

  return typeof value === 'string' ? value : ''
}

export function commissionFormSchema(
  messages: CommissionFieldErrorMessages,
): z.ZodType<SetCommissionRateRequest> {
  return z.unknown().transform((input, ctx) => {
    const values = recordOf(input)
    const kind = text(values, 'scope')
    const scope = selectedScope(kind, text(values, 'categoryId'), text(values, 'sellerId'))
    const rate = rateBpFromPercent(text(values, 'ratePercent'))

    if (scope === null) {
      // 범위가 완결되지 않는 경우는 둘뿐이고, 고쳐야 할 칸이 서로 다르다.
      const seller = kind === 'seller'

      ctx.addIssue({
        code: 'custom',
        input,
        message: seller ? messages.sellerRequired : messages.categoryRequired,
        path: [seller ? 'sellerId' : 'categoryId'],
      })
    }

    if (!rate.ok) {
      ctx.addIssue({
        code: 'custom',
        input,
        message: messages.rate[rate.reason],
        path: ['ratePercent'],
      })
    }

    // 두 거절이 함께 나올 수 있고, 그때 두 칸 모두에 문장이 선다. 먼저 걸린 것 하나만
    // 말하면 고친 뒤에 다음 거절이 나타나는 폼이 된다.
    if (scope === null || !rate.ok) return z.NEVER

    return { ...scopeIds(scope), rateBp: rate.rateBp }
  })
}
