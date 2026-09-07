import type { AdjustPointsRequest } from '@shopping/shared'
import { ADMIN_REASON_MAX, adjustPointsRequestSchema, adminReasonSchema } from '@shopping/shared'
import { z } from 'zod'

import { parseAmount } from './user-console'

/**
 * 이 화면이 사람에게 받는 두 가지 — **왜**, 그리고 **얼마** (F5 · F7).
 *
 * `lib/reports/handle-form.ts` 와 같은 모양이다: `z.unknown().transform` 으로 감싸고,
 * **판정은 계약에서 그대로 가져오고**, 문장만 이 앱의 것으로 갈아 끼운다. 규칙을 다시
 * 쓰지 않는 것이 요점이다 — 「앞뒤 공백을 떼고 최소 한 글자」도
 * 「{@link ADMIN_REASON_MAX} 자까지」도 {@link adminReasonSchema} 가 정한다.
 *
 * **사유가 필수인 이유가 두 문에서 서로 다르다.** 열람의 사유는 「왜 이 사람의
 * 가려지지 않은 값을 봐야 했는가」에 대한 답이고 기록으로 남는다(4.3). 적립금의
 * 사유는 그보다 무겁다 — 주문도 클레임도 가리키지 않는 원장 줄이라 **그 움직임의
 * 유일한 근거**다(4.5). 그래서 자리 표시자 문구도 두 곳이 다르다.
 */

/** 서버가 거절을 붙일 수 있는 칸. 사유 하나짜리 폼에는 하나뿐이다. */
export const REASON_FORM_FIELDS = ['reason'] as const

export const EMPTY_REASON_FORM: Readonly<Record<string, unknown>> = { reason: '' }

export interface ReasonFieldErrorMessages {
  /** 비었거나 공백만 적었다. 둘은 사람에게 같은 실수다. */
  readonly reasonRequired: string
  /** `{max}` 자를 넘었다. */
  readonly reasonTooLong: string
}

export interface ReasonValues {
  readonly reason: string
}

/** `useForm` 이 들고 있는 값에서 한 칸을 문자열로. 없거나 문자열이 아니면 빈 문자열이다. */
function textOf(input: unknown, key: string): string {
  if (typeof input !== 'object' || input === null) return ''

  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : ''
}

/**
 * 사유 한 칸 (F7 · F4).
 *
 * 열람과 정지가 **같은 스키마를 쓴다.** 계약에서도 두 몸통은 같은 모양이고
 * (`viewUserRequestSchema` · `suspendUserRequestSchema`), 사람이 하는 일도 같다 —
 * 왜 그랬는지 적는 것. 두 벌로 나누면 한쪽만 상한이 바뀌는 날이 온다.
 */
export function reasonFormSchema(messages: ReasonFieldErrorMessages): z.ZodType<ReasonValues> {
  return z.unknown().transform((input, ctx) => {
    const reason = textOf(input, 'reason')
    const parsed = adminReasonSchema.safeParse(reason)

    if (parsed.success) return { reason: parsed.data }

    ctx.addIssue({
      code: 'custom',
      input,
      message:
        reason.trim() === ''
          ? messages.reasonRequired
          : messages.reasonTooLong.replace('{max}', String(ADMIN_REASON_MAX)),
      path: ['reason'],
    })

    return z.NEVER
  })
}

export const POINTS_FORM_FIELDS = ['amount', 'reason'] as const

export const EMPTY_POINTS_FORM: Readonly<Record<string, unknown>> = { amount: '', reason: '' }

export interface PointsFieldErrorMessages extends ReasonFieldErrorMessages {
  /** 비었거나 수로 읽을 수 없다 — 소수점이 섞인 값이 여기 들어온다. */
  readonly amountRequired: string
  /** 0을 적었다. 계약이 거절하는 값이고, 거절하는 이유가 따로 있다. */
  readonly amountZero: string
}

/**
 * 조정 금액과 사유 (F5).
 *
 * **부호가 있는 정수 한 칸이다.** 지급과 차감을 두 칸이나 두 버튼으로 나누지 않는
 * 이유는 계약이 문을 하나로 둔 것과 같다 — 나누면 화면이 부호를 보고 어느 쪽을
 * 부를지 정하게 되고, 그 분기가 틀리면 더하려던 것이 빠진다 (4.5).
 *
 * 0을 「비었다」와 다르게 말한다. 계약이 0을 거절하는 이유는 「아무것도 안 하는
 * 조정이 원장에 왜 적혔는지 모르는 0원을 남긴다」이고, 그것은 다시 치라는 말과
 * 다른 말이다 (`adjustPointsRequestSchema`).
 */
export function pointsFormSchema(
  messages: PointsFieldErrorMessages,
): z.ZodType<AdjustPointsRequest> {
  return z.unknown().transform((input, ctx) => {
    const amount = parseAmount(textOf(input, 'amount'))
    const reason = textOf(input, 'reason')

    if (amount === null) {
      ctx.addIssue({ code: 'custom', input, message: messages.amountRequired, path: ['amount'] })
    } else if (amount === 0) {
      ctx.addIssue({ code: 'custom', input, message: messages.amountZero, path: ['amount'] })
    }

    if (!adminReasonSchema.safeParse(reason).success) {
      ctx.addIssue({
        code: 'custom',
        input,
        message:
          reason.trim() === ''
            ? messages.reasonRequired
            : messages.reasonTooLong.replace('{max}', String(ADMIN_REASON_MAX)),
        path: ['reason'],
      })
    }

    const parsed = adjustPointsRequestSchema.safeParse({ amount, reason })

    // 계약이 마지막으로 한 번 더 본다. 위에서 이미 이유를 붙였으므로 여기서 할 일은
    // **내보내지 않는 것**뿐이다 — 문장을 하나 더 얹으면 같은 칸에 두 줄이 선다.
    return parsed.success ? parsed.data : z.NEVER
  })
}
