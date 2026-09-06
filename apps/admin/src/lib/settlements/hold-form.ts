import type { HoldSettlementRequest } from '@shopping/shared'
import { holdSettlementRequestSchema, SETTLEMENT_HOLD_REASON_MAX } from '@shopping/shared'
import { z } from 'zod'

/**
 * 보류 사유를 받는 폼의 스키마 (F4).
 *
 * `lib/commissions/form-schema.ts` 와 같은 모양이다: `z.unknown().transform` 으로
 * 감싸고, **판정은 계약에서 그대로 가져오고**, 문장만 이 앱의 것으로 갈아 끼운다.
 * 규칙을 다시 쓰지 않는 것이 요점이다 — 「앞뒤 공백을 떼고 최소 한 글자」도
 * 「500자까지」도 {@link holdSettlementRequestSchema} 가 정하고, 그 뒤를
 * `Settlement_holdReason_check` 가 DB 에서 한 번 더 받친다.
 *
 * **공백만 적고 넘어갈 수 없다.** 그것이 F4 가 재는 것이고, 이 스키마를 지나지 않고
 * 보류 요청이 나갈 수 있는 길은 화면에 없다 — 대화상자의 확정 버튼은 `submit` 이라
 * 폼의 문 하나만 지난다(`useForm`).
 */

/** 서버가 거절을 붙일 수 있는 칸. 하나뿐이다. */
export const HOLD_FORM_FIELDS = ['reason'] as const

export const EMPTY_HOLD_FORM: Readonly<Record<string, unknown>> = { reason: '' }

export interface HoldFieldErrorMessages {
  /** 비었거나 공백만 적었다. 둘은 사람에게 같은 실수다. */
  readonly required: string
  /** `{max}` 자를 넘었다. */
  readonly tooLong: string
}

function reasonOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''

  const value = (input as Record<string, unknown>).reason

  return typeof value === 'string' ? value : ''
}

export function holdFormSchema(messages: HoldFieldErrorMessages): z.ZodType<HoldSettlementRequest> {
  return z.unknown().transform((input, ctx) => {
    const reason = reasonOf(input)
    const parsed = holdSettlementRequestSchema.safeParse({ reason })

    if (parsed.success) return parsed.data

    // 계약이 거절하는 이유는 둘뿐이다 — 비었거나(공백만 적은 것이 여기 들어온다),
    // 너무 길거나. 어느 쪽인지는 다듬은 길이 하나로 갈린다.
    ctx.addIssue({
      code: 'custom',
      input,
      message:
        reason.trim() === ''
          ? messages.required
          : messages.tooLong.replace('{max}', String(SETTLEMENT_HOLD_REASON_MAX)),
      path: ['reason'],
    })

    return z.NEVER
  })
}
