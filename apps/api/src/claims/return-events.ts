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
 * ## 지금 무엇이 붙어 있고 무엇이 안 붙어 있는가
 *
 * **환불은 붙었다** (TASK-0068). `RefundingReturnEvents` 가 바인딩돼 있고, 취소와
 * **같은 실행기**를 쓴다 — 환불은 끝에서 같은 일이고 그 앞까지 오는 길이 다를
 * 뿐이라, 「이 항목에서 이미 몇 개를 환불했나」를 세는 규칙이 두 곳에 살면 안 된다.
 * 이 파일이 계산의 입력이 아니라 **계산된 결과**를 싣는다는 성질은 그대로다:
 * 실행기는 `ReturnDetail` 의 두 금액을 그대로 쓰고 다시 계산하지 않는다.
 *
 * **재입고는 아직이다** (TASK-0069). 그동안 잘못되는 것은 재고 하나이고, 뒤늦게 할
 * 수 있다.
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
 * 아무것도 하지 않는 환불 구현. **더 이상 바인딩되지 않는다** (TASK-0068).
 *
 * 지금 바인딩되는 것은 `RefundingReturnEvents` 다. 이 클래스를 남겨 두는 이유는
 * 환불이 도는 것이 방해가 되는 검사 — 수거와 검수의 전이만 재는 스펙 — 이 포트를
 * 이것으로 바꿔 끼울 수 있게 하기 위해서다.
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
