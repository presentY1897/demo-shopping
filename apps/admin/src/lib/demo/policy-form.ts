import type { DemoPolicy } from '@shopping/shared'
import { demoPolicySchema } from '@shopping/shared'
import { z } from 'zod'

import type { PolicyField, PolicyProblem, PolicyValues } from './demo-console'
import { POLICY_FIELDS, parseInteger, policyProblems } from './demo-console'

/**
 * 정책 폼의 스키마 — 세 칸 전부가 필수이고, 범위는 **계약이 정한다** (F6).
 *
 * `lib/reports/handle-form.ts` 와 같은 모양이다: `z.unknown().transform` 으로 감싸고,
 * **판정은 `demo-console.ts` 의 순수 함수에서 가져오고**, 문장만 이 앱의 것으로 갈아
 * 끼운다. 범위를 여기 다시 적지 않는 것이 요점이다 — `policyProblems` 가
 * {@link demoPolicySchema} 의 칸별 스키마에 직접 물어본다.
 *
 * **화면이 먼저 막는 것은 친절이지 규칙이 아니다.** 규칙은 서버에 있고
 * (`PUT /admin/demo/policy` 가 같은 스키마로 읽는다), 화면만 막으면 API 를 직접
 * 부르는 길이 남는다. 화면이 여기서 하는 일은 **어느 칸이 왜 틀렸는지** 그 칸 밑에
 * 적는 것뿐이다.
 */

export const EMPTY_POLICY_FORM: Readonly<Record<string, unknown>> = {
  ttlHours: '',
  seedOrders: '',
  virtualCardLimit: '',
}

/** 한 칸이 받을 수 있는 두 문장. `{min}` · `{max}` 는 계약의 값으로 채워진다. */
export interface PolicyFieldMessages {
  readonly required: string
  readonly range: string
}

export type PolicyFieldErrorMessages = Readonly<Record<PolicyField, PolicyFieldMessages>>

/**
 * 계약이 이 칸에 허용하는 범위. 문장의 `{min}` · `{max}` 가 여기서 채워진다.
 *
 * **계약에 물어본다.** `demoPolicySchema` 의 상한·하한은 `@shopping/shared` 가
 * 상수로 내보내지 않으므로, 손으로 옮겨 적으면 그날부터 화면의 문장만 옛 범위를
 * 말한다 — 「1~720 사이로 적어 주세요」라고 안내한 뒤 서버가 거절하는 화면이 된다.
 * `z.toJSONSchema` 가 그 두 수를 스키마에서 그대로 읽어 준다.
 */
function boundsOf(field: PolicyField): { readonly min: string; readonly max: string } {
  const schema = z.toJSONSchema(demoPolicySchema.shape[field])

  return { max: String(schema.maximum), min: String(schema.minimum) }
}

function sentence(
  field: PolicyField,
  problem: PolicyProblem,
  messages: PolicyFieldErrorMessages,
): string {
  const copy = messages[field]

  if (problem === 'required') return copy.required

  const bounds = boundsOf(field)

  return copy.range.replace('{min}', bounds.min).replace('{max}', bounds.max)
}

function valuesOf(input: unknown): PolicyValues {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

  return Object.fromEntries(
    POLICY_FIELDS.map((field) => {
      const value = record[field]

      return [field, typeof value === 'string' ? value : '']
    }),
  ) as PolicyValues
}

export function policyFormSchema(messages: PolicyFieldErrorMessages): z.ZodType<DemoPolicy> {
  return z.unknown().transform((input, ctx) => {
    const values = valuesOf(input)
    const problems = policyProblems(values)

    for (const field of POLICY_FIELDS) {
      const problem = problems[field]

      if (problem === undefined) continue

      ctx.addIssue({
        code: 'custom',
        input,
        message: sentence(field, problem, messages),
        path: [field],
      })
    }

    const parsed = demoPolicySchema.safeParse({
      ttlHours: parseInteger(values.ttlHours),
      seedOrders: parseInteger(values.seedOrders),
      virtualCardLimit: parseInteger(values.virtualCardLimit),
    })

    // 계약이 마지막으로 한 번 더 본다. 위에서 이미 칸마다 이유를 붙였으므로 여기서
    // 할 일은 **내보내지 않는 것**뿐이다.
    return parsed.success ? parsed.data : z.NEVER
  })
}
