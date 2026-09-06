'use client'

import type { Settlement } from '@shopping/shared'

import { settlementMoney } from '@/lib/settlements/format'
import { calculationLines } from '@/lib/settlements/settlement-console'
import type { SettlementDetailMessages } from '@/messages'

/**
 * 지급액이 왜 그 금액인가 — TASK-0081 4장이 그린 다섯 줄 그대로 (F1).
 *
 * ```
 * 판매액          1,890,000
 * − 수수료         -189,000
 * − 판매자 쿠폰     -30,000
 * − 반품 차감      -120,000
 * ────────────────────────
 * 지급액          1,551,000
 * ```
 *
 * ## 표가 아니라 정의 목록이다
 *
 * 다섯 줄에는 머리글이 필요 없다 — 왼쪽은 이름이고 오른쪽은 금액이며, 그 관계를
 * `<dl>` 이 이미 말한다. 표로 그리면 「항목 / 금액」이라는 머리글 두 개가 생기고,
 * 그것은 읽는 데 시간이 더 걸리는 같은 정보다.
 *
 * ## 마지막 줄은 계산 결과가 아니라 **저장된 값**이다
 *
 * 네 줄을 더해 그리면 화면이 서버와 다른 답을 낼 수 있게 되고, 그때 옳은 것은
 * 언제나 서버 쪽이다 (DB 의 검사 제약이 그 식을 강제한다). 화면이 하는 일은 「왜 이
 * 금액인가」를 보여 주는 것이지 그 금액을 정하는 것이 아니고, 그 사실을 표 밑의 한
 * 줄이 말한다.
 *
 * **부호를 여기서 만들지 않는다.** `calculationLines` 가 음수를 붙여 주고, 기호와
 * 그 자리는 `Intl` 이 정한다.
 */

export interface SettlementCalculationProps {
  readonly settlement: Settlement
  readonly messages: SettlementDetailMessages
}

export function SettlementCalculation({ settlement, messages }: SettlementCalculationProps) {
  const copy = messages.calculation
  const lines = calculationLines(settlement)

  return (
    <section aria-label={messages.sections.calculation} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-medium">{messages.sections.calculation}</h2>

      <dl aria-label={copy.caption} className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <div
            className={
              line.total
                ? 'border-border flex items-baseline justify-between gap-4 border-t pt-2'
                : 'flex items-baseline justify-between gap-4'
            }
            key={line.key}
          >
            <dt className={line.total ? 'text-fg font-medium' : 'text-fg-muted'}>
              {copy.lines[line.key]}
            </dt>
            <dd
              className={
                line.total ? 'text-fg text-base font-medium tabular-nums' : 'text-fg tabular-nums'
              }
            >
              {settlementMoney(line.amount)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-fg-subtle text-xs">{copy.note}</p>
    </section>
  )
}
