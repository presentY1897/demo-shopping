import type { HandleReportRequest } from '@shopping/shared'
import { handleReportRequestSchema, REPORT_DETAIL_MAX } from '@shopping/shared'
import { z } from 'zod'

import type { ReportOutcome } from './outcomes'
import { reportOutcomes } from './outcomes'

/**
 * 처리 폼의 스키마 — **무엇으로 처리하는가**와 **왜**, 둘 다 필수다 (F4 · F6).
 *
 * `lib/settlements/hold-form.ts` 와 같은 모양이다: `z.unknown().transform` 으로
 * 감싸고, **판정은 계약에서 그대로 가져오고**, 문장만 이 앱의 것으로 갈아 끼운다.
 * 규칙을 다시 쓰지 않는 것이 요점이다 — 「앞뒤 공백을 떼고 최소 한 글자」도
 * 「{@link REPORT_DETAIL_MAX} 자까지」도 {@link handleReportRequestSchema} 가 정한다.
 *
 * **「상품은 지울 수 없다」는 여기 없다.** 그 규칙은 `outcomes.ts` 의
 * `outcomesFor` 가 정하고, 화면에서는 **상품 신고에는 삭제 선택지가 없다**는 사실로
 * 나타난다. 세 번째 자리에 다시 적으면 대상이 하나 더 늘어나는 날 한 곳만 고쳐진다
 * — 그리고 서버가 `REPORT_NOT_REMOVABLE` 로 다시 받친다.
 *
 * **사유는 신고자에게 그대로 간다.** 처리 알림(`REPORT_HANDLED`)의 본문이 이 문장
 * 하나이므로, 공백만 적고 넘어갈 수 있으면 신고자는 「처리됐다」는 말만 받는다.
 */

/** 서버가 거절을 붙일 수 있는 칸. 둘뿐이다. */
export const HANDLE_FORM_FIELDS = ['outcome', 'note'] as const

export const EMPTY_HANDLE_FORM: Readonly<Record<string, unknown>> = { outcome: '', note: '' }

export interface HandleFieldErrorMessages {
  /** 셋 중 아무것도 고르지 않았다. */
  readonly outcomeRequired: string
  /** 비었거나 공백만 적었다. 둘은 사람에게 같은 실수다. */
  readonly noteRequired: string
  /** `{max}` 자를 넘었다. */
  readonly noteTooLong: string
}

interface RawValues {
  readonly outcome: unknown
  readonly note: string
}

function valuesOf(input: unknown): RawValues {
  if (typeof input !== 'object' || input === null) return { outcome: undefined, note: '' }

  const record = input as Record<string, unknown>
  const note = record.note

  return { outcome: record.outcome, note: typeof note === 'string' ? note : '' }
}

function isOutcome(value: unknown): value is ReportOutcome {
  return (reportOutcomes as readonly unknown[]).includes(value)
}

export function handleFormSchema(
  messages: HandleFieldErrorMessages,
): z.ZodType<HandleReportRequest> {
  return z.unknown().transform((input, ctx) => {
    const values = valuesOf(input)
    const parsed = handleReportRequestSchema.safeParse(values)

    if (parsed.success) return parsed.data

    // 계약이 거절하는 이유는 셋뿐이다 — 처리를 고르지 않았거나, 사유가 비었거나
    // (공백만 적은 것이 여기 들어온다), 너무 길거나.
    if (!isOutcome(values.outcome)) {
      ctx.addIssue({ code: 'custom', input, message: messages.outcomeRequired, path: ['outcome'] })
    } else {
      ctx.addIssue({
        code: 'custom',
        input,
        message:
          values.note.trim() === ''
            ? messages.noteRequired
            : messages.noteTooLong.replace('{max}', String(REPORT_DETAIL_MAX)),
        path: ['note'],
      })
    }

    return z.NEVER
  })
}
