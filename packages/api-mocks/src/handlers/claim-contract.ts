import { MOCK_ORDER_IDS, MOCK_SELLER_ORDER_IDS } from './order-contract'

/**
 * 클레임 대역이 픽스처와 핸들러 **양쪽에서** 읽는 것들 (TASK-0066).
 *
 * 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없으므로(`registry.spec.ts`), 두
 * 곳이 함께 쓰는 값은 여기 산다 — `order-contract.ts` 가 같은 이유로 있고, 그
 * 파일이 그 이유를 길게 적어 두었다.
 *
 * **여기 있는 것은 스키마가 아니라 id 와 시각뿐이다.** 계약은 이미 전부
 * `@shopping/shared` 의 `api/claims.ts` 에 있다 — 대역이 자기 스키마를 한 벌 더 갖는
 * 순간 「서버가 무엇을 답하나」의 답이 둘이 되고, 그 둘은 언젠가 다른 말을 한다.
 */

/**
 * 이 대역이 답하는 일곱 몫 — **거절 여섯과 정상 흐름마다 하나씩**이다.
 *
 * 「지금 무엇을 신청할 수 있나」의 답을 주문 상태가 정하므로(`claim-rules.ts` 의
 * `claimRouteFor` · `claimEligibility`), 화면이 그 갈래를 전부 그려 보려면 갈래마다
 * 라우팅할 id 가 하나씩 있어야 한다. 다섯은 주문 대역이 이미 들고 있는 묶음을
 * 그대로 가리키고, 둘은 **거기 없는 상태**라 이 대역이 직접 세운다.
 *
 * 주문 대역의 묶음을 가리키는 다섯이 자기 id 를 새로 만들지 않는 이유는, 같은
 * 화면이 주문 상세와 클레임 신청을 오가기 때문이다 — id 가 갈리면 「방금 본 그
 * 묶음」을 신청 화면에서 못 찾는다.
 */
export const MOCK_CLAIM_SELLER_ORDER_IDS = {
  /**
   * 결제완료. 판매자가 아직 아무것도 하지 않았다.
   *
   * 주문 픽스처에 `PAID` 인 묶음이 없어 새로 세운 id 이고, **자동 승인이 여기서만
   * 재현된다** (TASK-0066 4장). 이 상태의 취소가 승인을 기다리면 구매자는 의미 없이
   * 기다리고 판매자에게는 의미 없는 업무가 생긴다.
   */
  paid: '019596d0-1f1c-7c2e-9a0e-6d0000000011',
  /** 상품준비중. 취소가 열리되 **판매자 승인 대기**로 태어난다. */
  preparing: MOCK_SELLER_ORDER_IDS.mixedPreparing,
  /** 배송중. 취소하기엔 떠났고 반품하기엔 안 왔다 (F4) — `in_transit`. */
  shipped: MOCK_SELLER_ORDER_IDS.mixedShipped,
  /** 배송완료, 기간 안. 이 대역에서 **반품 경로가 열리는 유일한 몫**이다. */
  delivered: MOCK_SELLER_ORDER_IDS.mixedDelivered,
  /** 구매확정. 일반 반품은 끝났고 관리자 개입만 남는다 — `confirmed`. */
  confirmed: MOCK_SELLER_ORDER_IDS.confirmed,
  /** 이미 취소됨. 애초에 걸 것이 없다 — `not_claimable`. */
  canceled: MOCK_SELLER_ORDER_IDS.canceled,
  /**
   * 배송완료지만 기간이 지났다 — `window_closed`.
   *
   * `delivered` 와 **같은 상태**라 상태만으로는 갈리지 않는다. 그것이 이 몫이 따로
   * 있는 이유다: 기간은 상태가 아니라 시각이 정하고, 화면이 그 둘을 하나로 읽으면
   * 「배송완료면 반품 버튼」이라는 틀린 규칙이 남는다.
   */
  windowClosed: '019596d0-1f1c-7c2e-9a0e-6d0000000012',
} as const

/**
 * 이 대역의 클레임이 딸린 주문.
 *
 * 신청이 실제로 만들어지는 몫 셋(`paid` · `preparing` · `delivered`)이 전부 이 주문
 * 아래에 있다고 답한다. 대역이 주문번호를 지어내지 않고 픽스처의 것을 그대로 쓰는
 * 이유는, 클레임 상세가 그리는 주문번호가 주문 상세의 것과 같아야 하기 때문이다 —
 * 다르면 화면은 두 화면이 같은 주문을 말하고 있다는 것을 보여 줄 수 없다.
 */
export const MOCK_CLAIM_ORDER_ID = MOCK_ORDER_IDS.mixed

/**
 * 새 신청에 붙는 id — **첫 건의 것**이다.
 *
 * 한 검사가 두 번 신청하면 뒤엣것은 여기서 하나씩 올라간 id 를 받는다. 고정값인
 * 이유는 `MOCK_REQUEST_ID` 와 같다: 화면이 「방금 만든 클레임」으로 이동하는지를
 * 리터럴로 확인할 수 있어야 한다.
 */
export const MOCK_CLAIM_ID = '019596d0-1f1c-7c2e-9a0e-7a0000000001'

/**
 * `delivered` 몫이 답하는 반품 기간의 끝 (R2).
 *
 * 주문 픽스처의 `autoConfirmAt` 과 **같은 순간**이다 — 배송완료(2026-09-06T02:30Z)
 * 로부터 이레이고, 반품 기간과 자동 확정 기간이 같은 축(`FULFILLMENT_PACE`)을 쓰기
 * 때문에 압축하지 않는 배포에서 둘은 실제로 같은 날이다.
 *
 * `MOCK_ORDER_NOW` 보다 뒤라, 이 몫은 「아직 기간 안」이다. **화면이 D+7 을 더해
 * 만든 값이 아니라 서버가 준 값**을 그리는지는 이 상수와 비교해야만 드러난다.
 */
export const MOCK_CLAIM_RETURN_WINDOW_ENDS_AT = '2026-09-13T02:30:00.000Z'

/**
 * `windowClosed` 몫이 답하는 반품 기간의 끝. **`MOCK_ORDER_NOW` 보다 앞**이다.
 *
 * 기간이 지났어도 값이 `null` 이 되지는 않는다 — 실제 서버는 배송완료한 몫이면
 * 언제나 이 날짜를 싣고(`ClaimService.claimable`), 화면은 그것으로 「언제까지였는지」
 * 를 말한다. `null` 로 답하는 대역은 화면에서 그 문장을 지운다.
 */
export const MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT = '2026-08-27T02:30:00.000Z'
