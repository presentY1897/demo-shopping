import type { CardStatus, IssuedCard } from './payment-api'

/**
 * 카드 한 장을 두고 화면이 하는 판단 (TASK-0054).
 *
 * 순수 함수다. **고를 수 있는가**와 **얼마나 남았는가**는 카드 목록이 올 때마다
 * 다시 묻는 질문이고, 서버가 그 답을 필드로 주지 않는다 — 사용 가능액은 한도에서
 * 쓴 금액을 뺀 값이지 저장된 숫자가 아니다(`virtual-card-rules.ts` 의
 * `availableCredit` 이 서버 쪽의 같은 계산이다).
 */

/**
 * 사용 가능액 = 한도 − 사용액.
 *
 * **음수를 0으로 접지 않는다.** 서버가 접지 않는 이유(한도보다 많이 쓴 카드는 대사가
 * 이미 깨졌다는 신호다)가 여기에도 그대로 적용되고, 접으면 화면은 그 카드를
 * 「0원 남은 정상 카드」로 그린다. 접지 않으면 모자란 금액이 그대로 문장에 실린다.
 */
export function availableCredit(card: IssuedCard): number {
  return card.creditLimit - card.usedAmount
}

/**
 * 이 카드를 고를 수 없는 이유. 고를 수 있으면 `null`.
 *
 * **한도가 모자란 것은 여기 없다.** 그것은 고를 수 없는 이유가 아니라 골랐을 때
 * 거절당하는 이유이고, 미리 막으면 「한도 초과」를 재현할 방법이 화면에서 사라진다
 * (TASK-0054 2장이 그 재현을 이 TASK 의 핵심 가치로 적는다). 게다가 승인은 우리가
 * 아는 숫자가 아니라 **서버의 원장**이 정한다 — 목록을 읽은 뒤에 다른 결제가
 * 지나갔을 수 있고, 그때 화면이 미리 내린 판단은 틀린 판단이다.
 */
export function cardBlock(card: IssuedCard): CardBlock | null {
  return card.status === 'ACTIVE' ? null : card.status
}

/** 고를 수 없는 카드의 상태. `ACTIVE` 를 뺀 나머지다. */
export type CardBlock = Exclude<CardStatus, 'ACTIVE'>

/**
 * 처음에 골라 둘 카드. 없으면 `null`.
 *
 * 기본값을 두는 이유는 배송지와 같다 — 고를 것이 하나뿐인 사람에게 「고르세요」를
 * 시키지 않는다. 고를 수 있는 첫 장이고, 정지된 카드는 건너뛴다.
 */
export function defaultCard(cards: readonly IssuedCard[]): IssuedCard | null {
  return cards.find((card) => cardBlock(card) === null) ?? null
}
