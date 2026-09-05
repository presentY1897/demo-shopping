import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'

/**
 * 결제사와 대화하는 포트 (TASK-0052 4.2).
 *
 * **`packages/shared` 가 아니라 여기 있다.** 이 인터페이스는 선을 넘어가지 않는다 —
 * 브라우저는 결제사와 직접 말하지 않고, 화면이 아는 것은 `Payment` 의 상태와
 * 금액뿐이다. 공유 패키지에 두면 브라우저 번들이 서버의 개념을 들고 다니게 되고,
 * 그것은 「공유」가 아니라 「어디에 둘지 안 정했다」는 뜻이다.
 *
 * **두 구현을 동시에 염두에 두고 만든다** (R1). 토스 전용 개념 — 결제창, 시크릿
 * 키, `orderId` 문자열 규칙 — 은 어댑터 안에 숨는다. 하나만 보고 만들면 그 하나의
 * 모양이 곧 인터페이스가 되고, 두 번째 구현이 들어올 때 전부 고쳐야 한다.
 */

/** 승인 요청. 프로바이더가 알아야 하는 최소한이다. */
export interface AuthorizeRequest {
  readonly paymentId: string
  readonly orderId: string
  readonly amount: number
  /**
   * 어느 수단으로 낼 것인가. **프로바이더마다 뜻이 다르다.**
   *
   * | 프로바이더 | 이 자리에 들어오는 것 |
   * | --- | --- |
   * | 가상 카드 | 카드 id (TASK-0054) |
   * | 토스 | 결제창이 돌려준 `paymentKey` (TASK-0055 4.6) |
   *
   * **원래 이름은 `cardId` 였다.** TASK-0052 는 「프로바이더마다 뜻이 달라도 되는
   * 자리」라고 적어 두고 첫 구현의 이름을 붙였고, 두 번째 구현이 붙는 순간 그
   * 이름이 거짓이 됐다 — 토스가 여기 넣는 것은 카드가 아니다. `Payment.methodRef`
   * 컬럼이 처음부터 이 뜻이었으므로 그 이름으로 맞춘다.
   */
  readonly methodRef?: string
}

/**
 * 승인 결과 — **셋 중 하나다** (TASK-0056 4.2 · D-220).
 *
 * **거절을 예외가 아니라 값으로 답한다.** 한도 초과는 프로그램의 오류가 아니라
 * 정상적인 대답이고, 그것을 던지면 부르는 쪽이 「진짜 오류」와 구분하려고 예외
 * 타입을 뒤지게 된다.
 *
 * **`unknown` 이 세 번째인 이유**는 「거절당했다」와 「승인됐는지 모른다」가 서로
 * 다른 사실이기 때문이다. 원래 이 타입은 `approved: boolean` 이었고, 그 불리언에는
 * 답이 오지 않은 경우를 넣을 자리가 없어 거절과 같은 칸에 들어갔다 — 그러면 우리
 * 장부는 「실패」라고 적는데 저쪽에서는 승인이 나 있을 수 있고, 그 불일치를
 * 되돌릴 방법이 없어진다.
 *
 * 판별 유니온인 덕분에 타입도 정확해졌다. 예전 모양은 `paymentKey` 가 승인됐을
 * 때만 있는데도 늘 `string | null` 이라, 부르는 쪽이 있을 리 없는 널을 매번 봤다.
 */
export type AuthorizeResult =
  /** 승인됐다. 결제키는 취소·환불이 이 승인을 되찾는 열쇠다. */
  | { readonly outcome: 'approved'; readonly paymentKey: string }
  /** 저쪽이 **답했고**, 그 답이 아니오였다. 사람에게 보여 줄 문장이 붙는다. */
  | { readonly outcome: 'declined'; readonly reason: string }
  /**
   * 저쪽에 닿지 못했다 — **승인됐는지 우리가 모른다.**
   *
   * 결제는 `UNRESOLVED` 로 가고 거기서 꺼내는 것은 대사뿐이다. 이 갈래를 내는
   * 것은 **남의 서버가 있는 프로바이더**뿐이다.
   */
  | { readonly outcome: 'unknown'; readonly reason: string }

export interface PaymentProviderPort {
  readonly name: PaymentProviderName
  authorize(request: AuthorizeRequest): Promise<AuthorizeResult>
  /** 매입 확정. 승인과 나뉜 이유는 그 사이의 취소가 수수료가 다르기 때문이다. */
  capture(paymentKey: string, amount: number): Promise<void>
  cancel(paymentKey: string, amount: number, reason: string): Promise<void>
  refund(paymentKey: string, amount: number, reason: string): Promise<void>
  /** 대사용. 우리가 아는 상태와 저쪽이 아는 상태가 같은지 물어본다. */
  getStatus(paymentKey: string): Promise<PaymentStatus>
}
