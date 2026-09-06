import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service.js'
import { StockService } from '../stock/stock.service.js'
import type { CancelApproved, CancelRestockEvents } from './cancel-events.js'
import type { ClaimStatus, ClaimType } from './claim-rules.js'
import type { RestockCandidate } from './restock-plan.js'
import { RESTOCK_TYPE, restockDecision, restockDue } from './restock-plan.js'
import type { ReturnCompleted, ReturnRestockEvents } from './return-events.js'

type Tx = Prisma.TransactionClient

/** 잠근 클레임에서 읽는 것. 판단에 필요한 둘뿐이다. */
interface LockedClaim {
  readonly id: string
  readonly status: ClaimStatus
  readonly type: ClaimType
}

/** 한 클레임의 복원이 남긴 것. 세 수의 합이 곧 그 클레임의 줄 수다. */
export interface RestockReport {
  readonly outcome: 'restocked' | 'skipped' | 'not_due' | 'failed'
  /** 이번에 원장에 새로 적은 줄 수. 두 번째 호출에서는 0 이다. */
  readonly restored: number
  /** 이미 적혀 있어 건너뛴 줄 수. */
  readonly alreadyRecorded: number
  /** 사라진 상품이라 되돌리지 못한 줄 수 (경고 로그가 함께 남는다). */
  readonly dropped: number
}

const NOTHING = { restored: 0, alreadyRecorded: 0, dropped: 0 } as const

/**
 * 취소·반품된 수량만큼 재고를 되돌린다 (TASK-0069).
 *
 * 판단은 `restock-plan.ts` 가, 원장에 적고 `ProductVariant.stock` 을 옮기는 일은
 * `StockService` 가 한다. 여기 있는 것은 **순서와 잠금**뿐이고, 그 모양은 환불
 * 실행기(`refund.service.ts`)와 일부러 같다 — 두 후속은 같은 자리에서 같은 방식으로
 * 불리므로, 둘이 다른 모양이면 다음에 붙는 세 번째가 어느 쪽을 흉내 낼지 알 수 없다.
 *
 * ## 열쇠는 **클레임 항목**의 id 다 — 클레임의 id 가 아니다
 *
 * TASK 문서가 정한 열쇠는 `(refType, refId, variantId)` 이고, 이 경로에서 그것은
 * `('CLAIM_ITEM', ClaimItem.id, 그 항목의 variant)` 다. 클레임의 id 로 접지 않은
 * 이유가 하나 있다.
 *
 * **한 클레임이 같은 조합을 두 줄로 들고 있을 수 있다.** `ClaimItem` 이 막는 것은
 * `(claimId, orderItemId)` 의 중복이고(`@@unique`), `OrderItem` 에는
 * `(sellerOrderId, variantId)` 유니크가 **없다.** 지금 그런 주문이 만들어지지 않는
 * 것은 `CartItem_cartId_variantId_key` 가 장바구니에서 이미 합쳐 주기 때문이지
 * 주문 표가 그것을 약속해서가 아니다. 열쇠를 클레임 id 로 잡으면 그 약속이 깨지는
 * 날 **둘째 줄이 조용히 삼켜지고**, 판매자는 되돌아오지 않은 재고를 영원히 모른다.
 * 항목 id 로 잡으면 두 줄은 서로 다른 원장 행이 되어 둘 다 돌아온다.
 *
 * ## 그 열쇠는 **이미 DB 제약이다**
 *
 * `StockLedger_ref_key` — `("variantId", "type", "refType", "refId") WHERE "refId"
 * IS NOT NULL` 부분 유니크 인덱스(TASK-0036, `20260904063655_stock_ledger`). 새
 * 마이그레이션이 필요 없는 것은 이 경로에서 그 인덱스가 문서의 열쇠와 **같은 것을
 * 말하기** 때문이다: `variantId` 는 `refId` 가 정하고(항목 → 주문 항목 → 조합이
 * 1:1), `type` 은 클레임의 유형이 정한다(한 클레임은 취소이거나 반품이고 둘 다일 수
 * 없다).
 *
 * ## 그래서 겹이 둘이다
 *
 * | 겹 | 무엇이 막나 |
 * | --- | --- |
 * | `ClaimRequest` 행을 **잠그고** 본다 | 같은 클레임에 두 번 불린 호출. 뒤에 온 쪽은 앞사람이 커밋한 원장을 보고 전부 건너뛴다 |
 * | `StockLedger_ref_key` | 잠금을 지나지 않은 삽입. 애플리케이션 검사만으로는 두 동시 호출이 **둘 다** 「아직 없다」를 읽는다 |
 *
 * 잠금이 답인데도 인덱스를 마지막 방어선으로 두는 이유는 TASK-0065 4.1 이 적어
 * 두었다 — 잠금을 안 쓰는 코드가 하나 생기는 날 조용히 넘친다.
 *
 * ## 던지지 않는다
 *
 * {@link restore} 는 무슨 일이 있어도 값으로 답한다. 재고를 되돌리지 못한 것이
 * 승인이나 검수를 되돌릴 이유는 아니고(`cancel-events.ts` · `return-events.ts`),
 * 되돌리려 해도 전이표에 그 화살표가 없다. 여기서 잘못되는 것은 「팔 수 있는 물건이
 * 안 팔린다」 하나이고 **아무도 신고하지 않으므로**, 남는 것은 로그와
 * `StockService.reconcile` 이다.
 */
@Injectable()
export class ClaimRestockService {
  private readonly log = new Logger(ClaimRestockService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /**
   * 이 클레임의 재고 복원을 한 번 시도한다. **던지지 않는다.**
   *
   * 두 번 불려도 안전하고(위 두 겹), 되돌릴 자리가 아니면 아무것도 하지 않는다.
   *
   * **한 트랜잭션이다.** 줄마다 나누면 그 틈에서 죽은 프로세스가 「두 줄 중 하나만
   * 돌아온 클레임」을 남기는데, 그 상태는 원장만 보고는 사고인지 정상인지 알 수
   * 없다 — 다시 부르면 나머지 한 줄만 채워지지만, 그것을 **다시 부르는 사람이
   * 없다.**
   */
  async restore(claimId: string): Promise<RestockReport> {
    try {
      return await this.prisma.$transaction((tx) => this.restoreWithin(tx, claimId))
    } catch (error) {
      this.log.error(`클레임 ${claimId} 의 재고 복원에 실패했습니다.`, error)

      return { outcome: 'failed', ...NOTHING }
    }
  }

  // ---------------------------------------------------------------- internals

  private async restoreWithin(tx: Tx, claimId: string): Promise<RestockReport> {
    const claim = await this.lock(tx, claimId)

    // **목록을 손으로 적지 않는다.** 「이 자리에서 물건이 우리 손에 있는가」는
    // 전이표가 이미 답하는 물음이고, 검수에서 떨어진 반품이 여기 오는 것은 사고가
    // 아니라 정상이다 — 부르는 쪽이 결과로 갈라 주지만, 그 갈림이 두 곳에 살면
    // 언젠가 한쪽만 고쳐진다.
    if (!restockDue(claim.type, claim.status)) return { outcome: 'not_due', ...NOTHING }

    const candidates = await this.candidates(tx, claimId)
    let restored = 0
    let alreadyRecorded = 0
    let dropped = 0

    for (const candidate of candidates) {
      const outcome = restockDecision(candidate)

      if (outcome === 'already_recorded') {
        alreadyRecorded += 1
        continue
      }

      if (outcome === 'variant_deleted') {
        dropped += 1
        // 이 한 줄이 이 경로의 유일한 흔적이다. 원장에는 아무것도 남지 않고
        // (남기면 아무도 살 수 없는 재고가 된다), 클레임은 정상으로 끝난다.
        this.log.warn(
          `클레임 ${claimId}: 사라진 상품 옵션 ${candidate.variantId} 의 ` +
            `${String(candidate.quantity)}개를 되돌리지 않았습니다.`,
        )
        continue
      }

      await this.stock.apply(tx, {
        variantId: candidate.variantId,
        type: RESTOCK_TYPE[claim.type],
        // 원장의 부호는 유형이 정하고 `StockLedger_direction_check` 가 강제한다.
        // 둘 다 `in` 이므로 그대로 양수다 (`stockDirections`).
        quantity: candidate.quantity,
        refType: 'CLAIM_ITEM',
        refId: candidate.claimItemId,
        // 사람이 없는 변동이다. 여기 승인한 판매자를 적으면 원장에 「그 사람이
        // 입고했다」는 거짓이 남는다 — 되돌린 것은 규칙이다.
        actorId: null,
      })
      restored += 1
    }

    return {
      outcome: restored > 0 ? 'restocked' : 'skipped',
      restored,
      alreadyRecorded,
      dropped,
    }
  }

  /**
   * 클레임 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 —
   * `ClaimRefundService.lock` · `ClaimService.lock` 이 같은 이유로 같은 모양이다.
   *
   * 이 잠금이 멱등의 첫 겹이다. 아래 {@link candidates} 는 **별개의 문장**이라
   * 잠금을 얻은 뒤 새 스냅샷을 뜨고, 그래서 앞사람이 방금 적은 원장 행을 본다
   * (`stock.service.ts` 가 같은 성질을 같은 이유로 쓴다).
   */
  private async lock(tx: Tx, claimId: string): Promise<LockedClaim> {
    const rows = await tx.$queryRaw<readonly LockedClaim[]>`
      SELECT "id", "status"::text AS "status", "type"::text AS "type"
        FROM "ClaimRequest"
       WHERE "id" = ${claimId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /**
   * 되돌릴 후보들 — 줄마다 「얼마를 어디로」와 판단에 필요한 두 사실.
   *
   * **`type` 으로 거르지 않는다.** 인덱스는 유형을 열쇠에 넣지만(같은 참조의
   * `SALE` 과 `CANCEL` 은 서로 다른 사실이므로 그래야 한다), 여기서 묻는 것은
   * 「이 클레임 항목이 이미 되돌아왔는가」다. 유형을 함께 보면 취소로 적힌 줄을
   * 반품 유형으로 한 번 더 적을 수 있게 되고, 그 조합은 아무도 막지 않는다.
   *
   * **조합 id 순서로 읽는다.** 뒤에서 그 순서대로 조합의 행 잠금을 잡으므로,
   * 같은 두 조합을 건드리는 두 클레임이 서로를 기다리다 데드락에 빠지지 않는다 —
   * 신청이 항목 id 순서로 잔여 수량을 잡는 것과 같은 장치다 (TASK-0065 4.1).
   */
  private candidates(tx: Tx, claimId: string): Promise<readonly RestockCandidate[]> {
    return tx.$queryRaw<readonly RestockCandidate[]>`
      SELECT ci."id"                       AS "claimItemId",
             oi."variantId",
             ci."quantity",
             (v."deletedAt" IS NOT NULL)   AS "variantDeleted",
             EXISTS (SELECT 1 FROM "StockLedger" l
                      WHERE l."refType" = 'CLAIM_ITEM' AND l."refId" = ci."id")
                                           AS "recorded"
        FROM "ClaimItem" ci
        JOIN "OrderItem" oi ON oi."id" = ci."orderItemId"
        JOIN "ProductVariant" v ON v."id" = oi."variantId"
       WHERE ci."claimId" = ${claimId}::uuid
       ORDER BY oi."variantId", ci."id"
    `
  }
}

/**
 * 승인된 취소만큼 재고를 되돌리는 **실제 구현** (TASK-0069).
 *
 * `NoopCancelRestockEvents` 를 대신한다. 하나씩 차례로 부르는 이유와 한 건의 실패가
 * 나머지를 멈추지 않는 이유는 `RefundingCancelEvents` 와 같다 —
 * {@link ClaimRestockService.restore} 가 던지지 않으므로 그 성질을 여기서 다시
 * 만들지 않는다.
 */
@Injectable()
export class RestockingCancelEvents implements CancelRestockEvents {
  constructor(private readonly restocks: ClaimRestockService) {}

  async restock(events: readonly CancelApproved[]): Promise<void> {
    for (const event of events) await this.restocks.restore(event.idempotencyKey)
  }
}

/** 검수를 통과한 반품만큼 재고를 되돌리는 **실제 구현** (TASK-0069). */
@Injectable()
export class RestockingReturnEvents implements ReturnRestockEvents {
  constructor(private readonly restocks: ClaimRestockService) {}

  async restock(events: readonly ReturnCompleted[]): Promise<void> {
    for (const event of events) await this.restocks.restore(event.idempotencyKey)
  }
}
