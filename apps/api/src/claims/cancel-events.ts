import type { SellerOrderActor } from '../orders/seller-order-transitions.js'
import type { CancelScope } from './cancel-rules.js'

/**
 * 취소 승인 하나가 뒤에 남기는 일 — **자리만** (TASK-0066 4장 · TASK-0068 · 0069).
 *
 * `order-confirmed-events.ts` 가 같은 모양이고, 그 파일이 이 형태의 이유를 길게
 * 적어 두었다. 여기서는 **다른 점 하나**만 적는다.
 *
 * ## 왜 포트가 둘인가
 *
 * 승인된 취소가 부르는 것은 **환불**(TASK-0068)과 **재고 복원**(TASK-0069)이다.
 * 한 이벤트로 묶어 한 포트에 넘기지 않는 이유는 저쪽 파일이 정산과 알림을 나눈
 * 이유와 같다 — **받는 쪽도 실패의 뜻도 다르다.**
 *
 * | 포트 | 실패하면 | 그래서 |
 * | --- | --- | --- |
 * | {@link CancelRefundEvents} | **구매자가 돈을 못 받는다.** 사람이 문의한다 | 재시도가 필수이고, 두 번 나가면 안 된다 |
 * | {@link CancelRestockEvents} | **팔 수 있는 물건이 안 팔린다.** 아무도 신고하지 않는다 | 재시도는 늦어도 되지만, 그것을 **발견하는 장치**가 필요하다 |
 *
 * 둘을 한 포트에 묶으면 나중에 그 둘의 재시도 정책을 함께 정해야 하고, 위 표의
 * 오른쪽 칸이 서로 다르므로 그 결정은 반드시 한쪽을 잘못 다룬다.
 *
 * ## 지금 무엇이 붙어 있고 무엇이 안 붙어 있는가
 *
 * **환불은 붙었다** (TASK-0068). `RefundingCancelEvents` 가 바인딩돼 있고, 그것이
 * 하는 일은 `refund.service.ts` 가 설명한다 — 항목별 몫을 `ClaimItem.refundAmount`
 * 에 적고, `PaymentService.refundWithin` 으로 돈을 내보내고, 클레임을 `REFUNDED` 로
 * 옮기는 일이 한 트랜잭션 안에 있다.
 *
 * **재고도 붙었다** (TASK-0069). `RestockingCancelEvents` 가 바인딩돼 있고, 그것이
 * 하는 일은 `restock.service.ts` 가 설명한다 — 클레임 항목마다 `CANCEL` 을 원장에
 * 적고 그 결과로 `ProductVariant.stock` 이 움직인다. 멱등의 열쇠는 **클레임 항목의
 * id** 이고(`StockLedger_ref_key`), 사라진 상품은 건너뛰되 클레임은 끝난다.
 *
 * 위 표의 오른쪽 칸은 그대로 유효하다 — 여기서 잘못되면 「팔 수 있는 물건이 안
 * 팔린다」이고 **아무도 신고하지 않는다.** 그래서 발견하는 장치가 실행기 바깥에
 * 있다: 경고 로그와 `StockService.reconcile`.
 *
 * **던지지 않는 것도 결정이다.** 환불에 실패한 것이 승인을 되돌릴 이유는 아니다 —
 * 규칙이든 판매자든 「취소한다」고 이미 판단했고, 그 판단은 유효하다. 되돌리려 해도
 * 전이표에 `CANCELED` 를 떠나는 화살표가 없다. 그래서 부르는 쪽은 **커밋한 뒤에**
 * 부르고, 실제 구현이 그 성질을 지키는 방법은 `ClaimRefundService.settle` 이
 * **무슨 일이 있어도 값으로 답하는 것**이다 — 실패는 예외가 아니라 `ClaimRefund`
 * 행에 남아 재시도 배치가 읽는다 (`refund-retry.ts`).
 *
 * ## 반품(TASK-0067)이 이 파일을 쓰지 않는 이유
 *
 * 반품도 끝에서 환불하고 재입고한다. 그래도 이름에 `Cancel` 이 붙어 있는 것은
 * **부르는 시점이 다르기** 때문이다 — 취소는 **승인** 자리에서 부르고, 반품은
 * 물건이 돌아와 검수를 지난 뒤(`RETURN_COMPLETED`)에야 부른다. 그 둘을 한 포트에
 * 두면 「승인만 하고 물건은 안 왔는데 재입고된 반품」이 한 줄 실수로 가능해진다.
 */
export interface CancelApprovedLine {
  readonly orderItemId: string
  /** 어떤 조합을 몇 개 되돌리는가. 재고 복원이 읽는다 (TASK-0069). */
  readonly variantId: string
  readonly quantity: number
}

export interface CancelApproved {
  readonly claimId: string
  readonly sellerOrderId: string
  /**
   * 이 승인 뒤에 이 몫에 남은 것이 있는가 (`cancelScopeOf`).
   *
   * 배송비를 가르는 사실이다 — 전체 취소는 배송비까지 돌려주지만 부분 취소는 남은
   * 항목이 여전히 배송되므로 그렇지 않고, 남은 금액이 무료배송 문턱 아래로 내려가면
   * 배송비가 **다시 붙는다** (TASK-0066 R2 · `pricing.md` 4장).
   *
   * **그런데 환불은 이 값을 읽지 않는다** (TASK-0068). 여기 실린 것은 **승인 시점의
   * 답**이고, 환불이 실패해 며칠 뒤 재시도되면 그 사이에 다른 취소가 승인돼 있을 수
   * 있다. 그때 옛 답으로 배송비를 돌려주면 두 클레임이 같은 배송비를 각자 한 번씩
   * 돌려준다. 실행기는 대신 **환불 원장에서 같은 판정을 다시 세고, 이번 환불 전후의
   * 차이만** 움직인다 — 그 차분이 성립하려면 두 판정이 같은 사실을 봐야 한다
   * (`refund-plan.ts`). 이 값은 이벤트를 받는 다른 쪽(알림 · 화면)의 것으로 남는다.
   */
  readonly scope: CancelScope
  /** 승인된 시각. 클레임 이력에 적힌 것과 같은 값이다. */
  readonly approvedAt: Date
  /** 규칙이 승인했나(`SYSTEM`), 판매자가 승인했나. 문의를 받는 쪽에는 다르다. */
  readonly actor: SellerOrderActor
  readonly lines: readonly CancelApprovedLine[]
  /**
   * 같은 승인이 두 번 도착해도 한 번만 처리되게 하는 열쇠 (이중 환불 · 이중 입고).
   *
   * **클레임의 id 그 자체다.** 전이표에 `CANCEL_APPROVED` 로 **돌아오는** 화살표가
   * 없어(`claim-rules.ts`) 한 클레임은 평생 한 번만 승인되고, 그래서 그 id 가 곧
   * 「이 승인」의 이름이다. 시각이나 난수를 섞으면 재발행이 다른 열쇠를 갖게 되어
   * 멱등이 깨지는데, 열쇠가 막아야 하는 것이 정확히 그 경우다.
   */
  readonly idempotencyKey: string
}

/** 승인된 취소만큼 돈을 돌려줄 곳 (TASK-0068). */
export interface CancelRefundEvents {
  refund: (events: readonly CancelApproved[]) => Promise<void>
}

/** 승인된 취소만큼 재고를 되돌릴 곳 (TASK-0069). */
export interface CancelRestockEvents {
  restock: (events: readonly CancelApproved[]) => Promise<void>
}

/** 주입 토큰. 인터페이스에는 프로바이더를 걸 런타임 값이 없다. */
export const CANCEL_REFUND_EVENTS = Symbol('CANCEL_REFUND_EVENTS')

export const CANCEL_RESTOCK_EVENTS = Symbol('CANCEL_RESTOCK_EVENTS')

/**
 * 아무것도 하지 않는 환불 구현. **더 이상 바인딩되지 않는다** (TASK-0068).
 *
 * 지금 바인딩되는 것은 `RefundingCancelEvents` 다. 이 클래스를 남겨 두는 이유는
 * 환불이 도는 것이 방해가 되는 검사 — 취소의 상태 전이만 재는 스펙 — 이 포트를
 * 이것으로 바꿔 끼울 수 있게 하기 위해서다.
 */
export class NoopCancelRefundEvents implements CancelRefundEvents {
  refund(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * 아무것도 하지 않는 재고 복원 구현. **더 이상 바인딩되지 않는다** (TASK-0069).
 *
 * 지금 바인딩되는 것은 `RestockingCancelEvents` 다. 이 클래스가 남아 있는 이유는
 * 환불 쪽의 것과 같다 — 재고가 도는 것이 방해가 되는 검사(취소의 상태 전이만 재는
 * 스펙)가 포트를 이것으로 바꿔 끼울 수 있어야 한다.
 */
export class NoopCancelRestockEvents implements CancelRestockEvents {
  restock(): Promise<void> {
    return Promise.resolve()
  }
}
