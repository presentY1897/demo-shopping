import type { Prisma, PrismaClient } from '@prisma/client'

import type { SettlementItemSource } from './settlement-calc.js'

/**
 * 정산의 입력을 읽는 **한 곳** (TASK-0080 · TASK-0082).
 *
 * 배치가 정산서를 만들 때와 판매자 화면이 「정산 예정 금액」을 보여 줄 때가 같은
 * 질문을 한다 — 「이 판매자 몫을 지금 정산하면 얼마인가」. 두 곳이 각자 SQL 을 쓰면
 * 예정 금액과 실제 정산액이 **조용히 갈라지고**, 판매자는 화면에서 본 숫자와 다른
 * 돈을 받는다. 그것은 문의가 아니라 신뢰의 문제다.
 *
 * **환불까지 끝난 클레임만 센다.** 신청·승인만 된 반품은 아직 돈이 움직이지 않았고
 * 검수에서 떨어질 수도 있다 — 미리 빼면 판매자가 받을 돈이 남의 신청 하나로 줄어든다.
 *
 * 읽어 오는 값은 전부 **주문 시점에 저장된 것**이다. 지금의 상품 가격도, 지금의
 * 수수료율도, 지금의 쿠폰 정책도 보지 않는다 — 계약은 판매 시점에 성립한다.
 */
interface SourceRow extends SettlementItemSource {
  readonly sellerOrderId: string
}

type Reader = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient

export async function loadSettlementSources(
  reader: Reader,
  sellerOrderIds: readonly string[],
): Promise<ReadonlyMap<string, readonly SettlementItemSource[]>> {
  const rows = await reader.$queryRaw<SourceRow[]>`
    SELECT oi."sellerOrderId"::text        AS "sellerOrderId",
           oi."unitPrice"                  AS "unitPrice",
           oi."quantity"                   AS "quantity",
           oi."commissionRateBp"           AS "commissionRateBp",
           oi."sellerCouponDiscountAmount" AS "sellerCouponDiscountAmount",
           COALESCE(SUM(ci."quantity") FILTER (WHERE c."status" = 'REFUNDED'), 0)::int
                                           AS "returnedQuantity"
      FROM "OrderItem" oi
      LEFT JOIN "ClaimItem" ci   ON ci."orderItemId" = oi."id"
      LEFT JOIN "ClaimRequest" c ON c."id" = ci."claimId"
     WHERE oi."sellerOrderId" = ANY(${[...sellerOrderIds]}::uuid[])
     GROUP BY oi."id"`
  const sources = new Map<string, SettlementItemSource[]>()

  for (const row of rows) {
    const held = sources.get(row.sellerOrderId) ?? []

    held.push(row)
    sources.set(row.sellerOrderId, held)
  }

  return sources
}
