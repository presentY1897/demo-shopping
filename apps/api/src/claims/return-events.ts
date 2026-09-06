import type { SellerOrderActor } from '../orders/seller-order-transitions.js'

/**
 * 검수를 통과한 반품이 뒤에 남기는 일 — **자리만** (TASK-0067 · TASK-0068 · 0069).
 *
 * `cancel-events.ts` 가 같은 모양이고, 그 파일이 「포트가 왜 둘인지」와 「아무것도
 * 하지 않는 구현이 무엇을 뜻하는지」를 길게 적어 두었다. 여기서는 **저쪽과 다른
 * 점 하나**만 적는다.
 *
 * ## 왜 취소의 포트를 나눠 쓰지 않는가
 *
 * 저쪽 파일이 이미 그 이유를 예고해 두었다 — **부르는 시점이 다르다.** 취소는
 * **승인** 자리에서 부르고, 반품은 물건이 실제로 돌아와 **검수를 지난 뒤**에야
 * 부른다. 한 포트에 두면 「승인만 하고 물건은 안 왔는데 재입고된 반품」이 한 줄
 * 실수로 가능해지고, 그것이 바로 검수 단계를 만든 이유다(TASK-0067 4장).
 *
 * 실을 것도 다르다. 취소는 「이 몫에 남은 것이 있는가」(`CancelScope`)를 실어
 * 배송비 재부과를 판단하게 하지만, 반품은 **배송비 판정이 이미 끝나 있다** —
 * 귀책이 그것을 정했고 그 결과는 신청 시점에 `ReturnDetail` 에 굳었다
 * (`return-rules.ts` 의 `returnCostShare`). 그래서 여기 실리는 것은 계산의 입력이
 * 아니라 **계산된 결과**다.
 *
 * ## 「아무것도 안 하는 구현」이 지금 무엇을 뜻하는가
 *
 * 빠지는 것은 **후속 처리뿐**이다. 반품 자체는 이미 끝났다 — 클레임은
 * `RETURN_COMPLETED` 이고, 이력에 누가 언제 검수했는지가 남아 있으며, 검수 결과와
 * 배송비 부담은 `ReturnDetail` 에 적혀 있다. 즉 이 구현으로 도는 시스템에서
 * 잘못되는 것은 둘이고 **둘 다 뒤늦게 할 수 있다** — 돈이 안 돌아가고 재고가 안
 * 돌아온다.
 *
 * **던지지 않는 것도 결정이다.** 환불에 실패한 것이 검수를 되돌릴 이유는 아니다 —
 * 물건은 이미 판매자에게 있고, 되돌리려 해도 전이표에 `RETURN_COMPLETED` 를 떠나는
 * 화살표는 `REFUNDED` 뿐이다. 그래서 부르는 쪽은 **커밋한 뒤에** 부른다.
 */
export interface ReturnCompletedLine {
  readonly orderItemId: string
  /** 어떤 조합을 몇 개 되돌리는가. 재입고가 읽는다 (TASK-0069). */
  readonly variantId: string
  readonly quantity: number
}

export interface ReturnCompleted {
  readonly claimId: string
  readonly sellerOrderId: string
  /** 검수를 통과한 시각. `ReturnDetail.inspectedAt` 과 같은 값이다. */
  readonly completedAt: Date
  /** 누가 합격을 찍었나. 판매자인지 관리자인지는 문의를 받는 쪽에 다르다. */
  readonly actor: SellerOrderActor
  readonly lines: readonly ReturnCompletedLine[]
  /**
   * 환불액에서 뺄 반품 배송비 (`pricing.md` 3장 · 단순 변심).
   *
   * **여기서 다시 계산하지 않는다.** 신청 시점에 굳은 값이라(`ReturnDetail`) 그 뒤에
   * 판매자가 배송비 정책을 바꿔도 움직이지 않는다 — 안분액을 항목마다 저장해 두는
   * 것과 같은 이유다.
   */
  readonly returnShippingDeduction: number
  /** 돌려줄 원 배송비. 판매자 귀책에서만 0보다 크다. */
  readonly originalShippingRefund: number
  /**
   * 같은 완료가 두 번 도착해도 한 번만 처리되게 하는 열쇠 (이중 환불 · 이중 입고).
   *
   * **클레임의 id 그 자체다.** 전이표에 `RETURN_COMPLETED` 로 **돌아오는** 화살표가
   * 없어(`claim-rules.ts`) 한 반품은 평생 한 번만 완료되고, 그래서 그 id 가 곧
   * 「이 완료」의 이름이다.
   *
   * 이 열쇠가 실제로 필요한 순간이 이 TASK 에 이미 있다. 검수는 **멱등**이라 같은
   * 요청이 두 번 와도 성공하는데(전이가 `changed: false` 로 끝난다), 그때도 포트는
   * 다시 불린다 — 첫 번째 호출과 커밋 사이에서 죽은 프로세스를 이어붙이는 유일한
   * 방법이 그것이기 때문이다. 「바뀌었을 때만 부른다」로 두면 그 경우 환불이 영영
   * 나가지 않고, 아무것도 실패하지 않는다.
   */
  readonly idempotencyKey: string
}

/** 검수를 통과한 반품만큼 돈을 돌려줄 곳 (TASK-0068). */
export interface ReturnRefundEvents {
  refund: (events: readonly ReturnCompleted[]) => Promise<void>
}

/** 검수를 통과한 반품만큼 재고를 되돌릴 곳 (TASK-0069). */
export interface ReturnRestockEvents {
  restock: (events: readonly ReturnCompleted[]) => Promise<void>
}

/** 주입 토큰. 인터페이스에는 프로바이더를 걸 런타임 값이 없다. */
export const RETURN_REFUND_EVENTS = Symbol('RETURN_REFUND_EVENTS')

export const RETURN_RESTOCK_EVENTS = Symbol('RETURN_RESTOCK_EVENTS')

/**
 * 지금 바인딩되는 환불 구현. **아무것도 하지 않는다.**
 *
 * 무엇을 뜻하는지는 {@link ReturnCompleted} 에 적혀 있다. TASK-0068 이 붙을 때
 * `return.module.ts` 의 한 줄만 바뀐다.
 */
export class NoopReturnRefundEvents implements ReturnRefundEvents {
  refund(): Promise<void> {
    return Promise.resolve()
  }
}

/** 지금 바인딩되는 재입고 구현. **아무것도 하지 않는다** (TASK-0069). */
export class NoopReturnRestockEvents implements ReturnRestockEvents {
  restock(): Promise<void> {
    return Promise.resolve()
  }
}
