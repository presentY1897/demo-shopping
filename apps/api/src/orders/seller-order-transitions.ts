import type { OrderStatus } from '@shopping/shared'

/**
 * 판매자 몫 주문이 지나는 길 (TASK-0059 · `docs/design/state-machines.md` 1장).
 *
 * **상태가 `Order` 가 아니라 `SellerOrder` 에 붙는 이유**는 판매자 A가 배송완료인데
 * B는 준비중일 수 있어야 하기 때문이다 (D-023). 그래서 이 표의 주어는 언제나
 * 「한 판매자의 몫」이다.
 *
 * 데이터베이스도 시계도 보지 않는다. 그래서 분기 전부가 단위 테스트에서 닿고,
 * 이 TASK 의 Q5 는 **분기 커버리지 100%** 다. 뒤집어 말하면 **닿을 수 없는 방어
 * 분기를 쓰지 않는다** — `payment-rules.ts` 가 같은 이유로 같은 모양이다.
 */

/**
 * 전이를 요청할 수 있는 주체.
 *
 * **역할(`Role`)과 다르다.** 역할은 「이 사람이 누구인가」이고 이것은 「이 전이를
 * 누가 일으켰는가」다 — `SYSTEM` 이 그 차이를 만든다: 배송 시뮬레이터와 D+7 자동
 * 확정에는 사람이 없다. 역할을 그대로 쓰면 그 둘을 표현할 수 없어 관리자 계정을
 * 빌려 쓰게 되고, 그러면 이력에 「관리자가 확정했다」는 거짓이 남는다.
 */
export const sellerOrderActors = ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'] as const

export type SellerOrderActor = (typeof sellerOrderActors)[number]

/**
 * 전이가 요구하는 것. 상태만으로는 부족한 조건이다.
 *
 * 지금은 하나뿐이지만 열거형인 이유는, 조건을 불리언 필드로 늘리면 「어떤 조건이
 * 있었나」를 부르는 쪽이 필드 이름으로 알아야 하기 때문이다.
 */
export type TransitionRequirement =
  /** 운송장 없이 발송할 수 없다. 「보냈다」는데 어디 있는지 모르는 상태가 된다. */
  'tracking'

export interface TransitionRule {
  readonly to: OrderStatus
  /** 이 전이를 일으킬 수 있는 주체. 비어 있는 규칙은 없다 — 그런 전이는 규칙이 아니다. */
  readonly actors: readonly SellerOrderActor[]
  readonly requires?: TransitionRequirement
}

/**
 * 어느 상태에서 어디로, 누가.
 *
 * `switch` 가 아니라 **상태 전부를 덮는 레코드**인 이유는 `@shopping/shared` 에
 * 상태를 하나 더 넣고 여기를 안 고치면 **컴파일이 깨져야** 하기 때문이다. 안 그러면
 * 새 상태는 「아무 전이도 정의된 적 없는 상태」로 조용히 태어나고, 거기 도착한
 * 주문은 어디로도 못 간 채 멈춘다.
 *
 * **빈 배열이 곧 종착 상태다.** 종착 여부를 따로 적지 않는 것은 한 사실을 두 벌로
 * 적으면 언젠가 서로 다른 말을 하기 때문이다.
 *
 * 눈여겨 볼 세 줄.
 *
 * - **결제로 움직이는 두 전이의 주체는 `SYSTEM` 이다.** 사람이 「결제됨」을 누르는
 *   화면은 없다 — 그것은 결제가 끝났다는 사실의 결과이고, 그 사실을 아는 것은
 *   결제 쪽이다 (`OrderService.markPaid` · 예약 만료 스케줄러).
 * - **`SHIPPED → DELIVERED` 를 판매자도 할 수 있다.** 시뮬레이터가 정상 경로지만
 *   (TASK-0062), 그것이 멈춘 데모에서 판매자가 흐름을 이어 갈 수 있어야 한다.
 * - **`CANCELED` 로 가는 길에 구매자가 없다.** 취소는 클레임 절차를 지나고(M10),
 *   그 절차의 결론이 이 전이다 — 구매자가 직접 누르는 것이 아니라 신청이 승인된
 *   결과다. 그래서 주체가 판매자·관리자이고, 신청 화면은 M10 이 만든다.
 */
export const sellerOrderTransitions: Readonly<Record<OrderStatus, readonly TransitionRule[]>> = {
  PAYMENT_PENDING: [
    { to: 'PAID', actors: ['SYSTEM'] },
    { to: 'PAYMENT_FAILED', actors: ['SYSTEM'] },
  ],
  PAID: [
    { to: 'PREPARING', actors: ['SELLER', 'SYSTEM'] },
    { to: 'CANCELED', actors: ['SELLER', 'ADMIN'] },
  ],
  PREPARING: [
    { to: 'SHIPPED', actors: ['SELLER'], requires: 'tracking' },
    { to: 'CANCELED', actors: ['SELLER', 'ADMIN'] },
  ],
  SHIPPED: [{ to: 'DELIVERED', actors: ['SYSTEM', 'SELLER'] }],
  DELIVERED: [
    { to: 'CONFIRMED', actors: ['BUYER', 'SYSTEM'] },
    { to: 'RETURNED', actors: ['SELLER', 'ADMIN'] },
  ],
  // 종착 넷. 정산과 클레임이 여기서부터 시작하지만, 그것은 다른 표의 일이다.
  CONFIRMED: [],
  CANCELED: [],
  RETURNED: [],
  PAYMENT_FAILED: [],
}

/** 이 전이의 규칙, 또는 정의되지 않았으면 `null`. */
export function ruleFor(from: OrderStatus, to: OrderStatus): TransitionRule | null {
  return sellerOrderTransitions[from].find((rule) => rule.to === to) ?? null
}

/**
 * 전이 요청이 거절되는 세 가지 이유.
 *
 * **셋을 나누는 이유는 부르는 쪽이 할 일이 다르기 때문이다.** 정의되지 않은
 * 전이는 요청 자체가 틀린 것이고(고쳐도 안 된다), 권한이 없는 것은 다른 사람이면
 * 되는 것이며, 조건이 모자란 것은 **그 조건을 채우면 되는 것**이다 — 마지막은
 * 화면이 「운송장을 입력해 주세요」로 바꿔 말할 수 있는 유일한 거절이다.
 */
export type TransitionRefusal = 'undefined_transition' | 'actor_forbidden' | 'requirement_unmet'

export type TransitionDecision =
  | { readonly outcome: 'allowed'; readonly rule: TransitionRule }
  | { readonly outcome: 'refused'; readonly reason: TransitionRefusal }

/** 이 전이를 지금 이 주체가 요구한 것을 갖추고 일으킬 수 있는가. */
export interface TransitionRequest {
  readonly from: OrderStatus
  readonly to: OrderStatus
  readonly actor: SellerOrderActor
  /** 운송장이 이미 붙어 있는가. `requires: 'tracking'` 인 전이만 본다. */
  readonly hasTracking: boolean
}

/**
 * 전이를 허락할지 정한다.
 *
 * 셋을 **순서대로** 본다. 앞의 것이 어긋나면 뒤는 볼 필요가 없고, 그 순서가 곧
 * 답의 우선순위다 — 애초에 정의되지 않은 전이에 「권한이 없다」고 답하면 권한을
 * 얻으면 될 것처럼 들린다.
 */
export function transitionDecision(request: TransitionRequest): TransitionDecision {
  const rule = ruleFor(request.from, request.to)

  if (rule === null) return { outcome: 'refused', reason: 'undefined_transition' }
  if (!rule.actors.includes(request.actor)) {
    return { outcome: 'refused', reason: 'actor_forbidden' }
  }
  if (rule.requires === 'tracking' && !request.hasTracking) {
    return { outcome: 'refused', reason: 'requirement_unmet' }
  }

  return { outcome: 'allowed', rule }
}

/**
 * 지금 이 주체가 할 수 있는 것들 (F4 — 「화면이 버튼을 결정하는 근거」).
 *
 * **화면이 상태로 분기하지 않게 하려고 있다.** 「`PAID` 면 발송 버튼」을 화면에
 * 적으면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때 한 곳만 고쳐진다. 서버가
 * 「지금 할 수 있는 것」을 답하면 화면은 그것을 그리기만 한다.
 *
 * **요구 조건이 모자란 전이도 답에 들어간다.** 운송장이 없다고 발송 버튼을 감추면
 * 판매자는 그 버튼을 **찾다가** 포기한다 — 버튼은 보이고, 누르면 무엇이 필요한지
 * 말해 주는 편이 낫다. 그래서 이 함수는 규칙을 그대로 돌려주고 조건은
 * {@link transitionDecision} 이 본다.
 */
export function availableTransitions(
  status: OrderStatus,
  actor: SellerOrderActor,
): readonly TransitionRule[] {
  return sellerOrderTransitions[status].filter((rule) => rule.actors.includes(actor))
}
