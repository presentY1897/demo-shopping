/**
 * 가상 카드의 순수 판단 (TASK-0053 4장).
 *
 * 서비스에서 떼어 놓은 이유는 **여기가 틀리면 이 카드의 두 존재 이유가 한꺼번에
 * 사라지기 때문**이다. 한도 판단이 한 칸 어긋나면 「사용액이 한도를 넘을 수 없다」가
 * 거짓이 되고, 반환 판단이 무르면 `usedAmount` 가 음수가 되어 **원장 합계와 사용액이
 * 어긋난다**(F3). 둘 다 빨간 테스트로 나타나지 않는다 — 환불이 제대로 됐는지를
 * 잔액으로 눈으로 확인하려고 만든 카드가, 그 순간부터 아무것도 확인해 주지 못한다.
 *
 * 데이터베이스도 시계도 보지 않는다. 유효기간(`VirtualCard.expiresAt`)이 여기에
 * 없는 것도 그래서다 — 지난 카드를 막는 것은 지금 시각을 아는 쪽의 일이고, 그
 * 판단을 이 파일에 들이면 시계가 인자로 따라 들어온다. I/O 가 없으므로 분기 전부가
 * 단위 테스트에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지 100%** 다(6.2). 뒤집어
 * 말하면 **닿을 수 없는 방어 분기를 쓰지 않는다** — `packages/shared` 의
 * `hangul.ts` 와 `pricing/allocate.ts` 에서 두 번 물렸고, 그때 남은 것은 영원히
 * 채워지지 않는 커버리지 구멍이었다.
 */

/**
 * 카드의 상태 (`docs/design/erd.md` 6장).
 *
 * Prisma 의 `VirtualCardStatus` 가 같은 세 값을 선언한다. 생성된 클라이언트에서
 * 가져오지 않고 여기서 다시 적는 이유는, 판단만 있는 파일이 `@prisma/client` 를
 * 끌고 오면 **스키마가 만들어지기 전에는 컴파일조차 되지 않기** 때문이다. 나중에
 * enum 으로 바꿔 끼울 때 값이 하나 늘어난 것은 아래 {@link chargeableStatuses} 가
 * 컴파일에서 잡는다.
 */
export const virtualCardStatuses = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const

export type VirtualCardStatus = (typeof virtualCardStatuses)[number]

/**
 * 이 상태의 카드로 **새로** 승인할 수 있는가.
 *
 * `status !== 'ACTIVE'` 가 아니라 상태 전부를 덮는 레코드인 이유는, 상태가 하나
 * 늘었을 때 **컴파일이 깨져야** 하기 때문이다. 비교문으로 적으면 새 상태는 아무도
 * 판단한 적 없는 채로 「쓸 수 없는 카드」에 조용히 편입되고, 그 상태를 만든 사람은
 * 자기가 카드를 막았다는 사실을 모른다. `stock/stock-ledger.ts` 의
 * `stockDirections` 와 `payment-rules.ts` 의 `paymentTransitions` 가 같은 장치다.
 */
export const chargeableStatuses: Readonly<Record<VirtualCardStatus, boolean>> = {
  ACTIVE: true,
  // 사람이 멈춰 세운 카드다. 되살릴 수 있으므로 원장은 그대로 두고 승인만 막는다.
  SUSPENDED: false,
  // 소프트 삭제다. 원장이 가리키므로 행은 남지만 새 승인은 받지 않는다.
  DELETED: false,
}

export function isChargeable(status: VirtualCardStatus): boolean {
  return chargeableStatuses[status]
}

/**
 * 카드번호의 접두어. 실제 카드 BIN 과 겹치지 않는 네 자리다 (F7 · R1).
 *
 * 「진짜 카드로 오해받는 것」은 이 TASK 가 이름 붙인 유일한 리스크다. 실제 BIN 으로
 * 시작하는 번호는 화면에 「가상 카드」라고 적어 두어도 **스크린샷 한 장이 지나가는
 * 순간 그 안내를 잃는다.** `9999` 로 시작하는 번호는 어느 카드망에도 배정된 적이
 * 없어서, 문맥 없이 봐도 결제에 쓸 수 없는 번호다.
 */
export const VIRTUAL_CARD_PREFIX = '9999'

/** 접두어 뒤의 난수 자릿수. `9999-XXXX-XXXX-XXXX` 의 X 열두 개다. */
export const VIRTUAL_CARD_RANDOM_DIGITS = 12

/**
 * 발급된 번호가 만족해야 하는 형식.
 *
 * 접두어가 위와 여기 두 번 적혀 있다. 정규식에 상수를 끼워 넣지 않는 이유는 그렇게
 * 만든 패턴은 **자기가 검사할 값과 같은 자리에서 왔기** 때문에 아무것도 검사하지
 * 못해서다. 둘이 갈라지지 않는 것은 스펙이 잰다.
 */
export const VIRTUAL_CARD_NUMBER_PATTERN = /^9999-[0-9]{4}-[0-9]{4}-[0-9]{4}$/u

/**
 * 카드번호 한 장 (F7).
 *
 * 난수를 인자로 받는 이유는 `orders/order-number.ts` 와 같다 — crypto 모듈을 흉내
 * 내지 않고 형식을 재기 위해서고, 서비스는 `randomBytes(VIRTUAL_CARD_RANDOM_DIGITS)`
 * 를 그대로 넘긴다.
 *
 * 한 바이트가 한 자리이고 `% 10` 이다. 256 은 10의 배수가 아니라 0~5 가 6~9 보다
 * 조금 더 자주 나온다(26/256 대 25/256). 주문번호의 32글자 알파벳과 달리 여기서는
 * 치우침을 없앨 수 없고, 없애려면 바이트를 버리고 다시 뽑는 순환이 필요하다.
 * 그러지 않은 이유는 이 번호가 지켜야 하는 성질이 **비밀이 아니라 충돌하지 않는
 * 것**이기 때문이다 — 승인은 카드 id 로 하지 번호로 하지 않는다. 10^12 의 공간에서
 * 저 정도 치우침이 충돌 확률에 하는 일은 없다시피 하고, 그마저도 마지막 방어선은
 * `VirtualCard.number` 의 유니크 인덱스다.
 */
export function virtualCardNumberFrom(bytes: Uint8Array): string {
  const digits = Array.from(bytes, (byte) => String(byte % 10)).join('')

  return `${VIRTUAL_CARD_PREFIX}-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`
}

/**
 * 사람에게 보여 줄 카드번호 — 앞 네 자리와 뒤 네 자리만 남는다 (TASK-0058 F2).
 *
 * 화면만의 이야기가 아니다. 6.2 는 **로그에 카드번호 전문이 남지 않는 것**을 완료
 * 기준에 넣었고, 카드번호가 문자열로 새어 나가는 경로는 화면보다 로그가 많다.
 *
 * 앞 네 자리를 입력에서 잘라 오지 않고 상수를 쓰는 이유는, **출력에 남는 입력이 뒤
 * 네 자리뿐이라는 성질을 함수 자체가 보증**하게 하려는 것이다. 잘라 오는 구현은
 * 실제 카드번호가 실수로 들어온 날 그 카드의 BIN 을 그대로 찍고, 그런 날은 반드시
 * 온다 — 마스킹 함수가 도는 자리는 「무엇이 들어올지 모르는 자리」니까 있는 것이다.
 */
export function maskVirtualCardNumber(number: string): string {
  return `${VIRTUAL_CARD_PREFIX}-****-****-${number.slice(-4)}`
}

/** 사용 가능액을 셀 때 필요한 두 값. Prisma 의 `VirtualCard` 행을 그대로 넘길 수 있다. */
export interface VirtualCardCredit {
  readonly creditLimit: number
  /** 원장 합계와 같아야 하는 값 (F3). */
  readonly usedAmount: number
}

/**
 * 사용 가능액 = `creditLimit` − `usedAmount` (4장).
 *
 * 음수를 0으로 접지 않는다. `reservation-rules.ts` 의 `availableStock` 은 접는데
 * 여기서 접지 않는 이유는 **그 음수가 뜻하는 바가 다르기** 때문이다. 가용재고의
 * 음수는 예약이 스쳐 지나가는 중간 상태지만, 사용 가능액의 음수는 한도보다 많이 쓴
 * 카드 — 즉 대사가 이미 깨졌다는 신호다. 접으면 F3 점검이 볼 수 있는 유일한 표시가
 * 사라지고, 접지 않으면 아래 승인 판단이 그 카드의 모든 승인을 거절한다. 안전한
 * 쪽이다.
 */
export function availableCredit(card: VirtualCardCredit): number {
  return card.creditLimit - card.usedAmount
}

/** 승인 판단이 보는 카드. 판단에 필요한 세 값이 전부다. */
export interface ChargeableCard extends VirtualCardCredit {
  readonly status: VirtualCardStatus
}

/**
 * 승인이 거절되는 세 가지 이유.
 *
 * 셋을 나눠 두는 이유는 **거절당한 사람이 다음에 할 일이 서로 다르기** 때문이다.
 * 하나로 뭉치면 「결제할 수 없습니다」가 되고, 그 문장은 셋 중 어느 경우에도 다음
 * 행동을 알려 주지 못한다.
 */
export type CardChargeRefusal =
  /** 정지·삭제된 카드다. 금액을 고쳐도 소용없고, 카드를 되살리거나 다른 카드를 골라야 한다. */
  | 'card_unusable'
  /** 0원 이하이거나 원 단위가 아니다. 사람의 실수가 아니라 부르는 쪽의 버그다. */
  | 'invalid_amount'
  /** 잔여 한도를 넘는다. 금액을 줄이거나 한도를 올리면 된다 (F4). */
  | 'exceeds_credit'

/** 승인해도 된다. 담긴 숫자는 그대로 쓰라고 있는 것이다. */
export interface CardChargeAllowed {
  readonly outcome: 'allowed'
  /**
   * 이 승인 뒤의 `usedAmount` — 카드에 쓸 값이자 원장 행의 `balanceAfter` 다.
   *
   * 부르는 쪽이 다시 더하게 두지 않는 이유는 `payment-rules.ts` 의 `refundDecision`
   * 과 같다. **넘지 않았는지 판단한 자리와 쓰는 자리가 같아야** 한다. 판단만 여기서
   * 하고 덧셈은 저쪽에서 하면 두 값이 갈라질 수 있고, 갈라지는 순간이 곧 원장 합계와
   * 사용액이 어긋나는 순간(F3)이다.
   */
  readonly usedAmount: number
  /** 이 승인을 하고도 남는 한도. */
  readonly availableAmount: number
}

/** 승인하면 안 된다. */
export interface CardChargeRefused {
  readonly outcome: 'refused'
  readonly reason: CardChargeRefusal
  /**
   * 지금 승인할 수 있는 최대 금액.
   *
   * 거절이 숫자를 들고 있어야 다음 행동이 정해진다 — 「한도를 초과했습니다」로 끝나는
   * 화면은 얼마짜리로 나눠 담아야 하는지 알려 주지 않는다.
   *
   * 쓸 수 없는 카드에는 0이다. 정지된 카드의 남은 한도를 알려 주면 **쓸 수 없는 돈을
   * 쓸 수 있다고 말하는 셈**이 된다.
   */
  readonly availableAmount: number
}

export type CardChargeDecision = CardChargeAllowed | CardChargeRefused

/**
 * 이 카드로 `amount` 를 승인해도 되는가 (F1 · F4).
 *
 * 순서가 있고, 그 순서가 곧 「무엇을 먼저 말해 줄 것인가」다. 정지된 카드에 「한도를
 * 초과했습니다」라고 답하면 부르는 쪽은 금액을 줄여 다시 시도하고, 그 시도는 전부
 * 같은 이유로 거절된다.
 *
 * 정수만 받는 것은 금액을 정수로 다루는 규칙(CLAUDE.md 6장)이기도 하지만, 여기서는
 * **원장이 대사되게 하는 장치**다. 소수가 한 번 섞이면 원장 합계와 `usedAmount` 의
 * 비교가 부동소수 비교가 되고, F3 은 그 뒤로 영원히 「거의 같다」까지만 말할 수 있다.
 *
 * 던지지 않고 값으로 답한다. 한도 초과는 프로그램의 오류가 아니라 **정상적인
 * 대답**이고 — 이 카드는 한도 초과·잔액 부족을 의도적으로 재현하려고 있는 것이다
 * (`docs/design/erd.md` 6장) — 부르는 쪽은 트랜잭션 안에서 그 대답으로 무엇을 할지
 * 정해야 한다.
 *
 * 마지막 방어선은 아니다. 동시에 들어온 두 승인이 각자 「아직 여유가 있다」를 읽는
 * 경합(F8)에서 지는 쪽을 거절하는 것은 행 잠금과 제약이지 이 함수가 아니다.
 */
export function chargeDecision(card: ChargeableCard, amount: number): CardChargeDecision {
  if (!isChargeable(card.status)) {
    return { outcome: 'refused', reason: 'card_unusable', availableAmount: 0 }
  }

  const available = availableCredit(card)

  if (!Number.isInteger(amount) || amount <= 0) {
    return { outcome: 'refused', reason: 'invalid_amount', availableAmount: available }
  }

  if (amount > available) {
    return { outcome: 'refused', reason: 'exceeds_credit', availableAmount: available }
  }

  return {
    outcome: 'allowed',
    usedAmount: card.usedAmount + amount,
    availableAmount: available - amount,
  }
}

/** 반환이 거절되는 두 가지 이유. */
export type CardReleaseRefusal =
  /** 0원 이하이거나 원 단위가 아니다. */
  | 'invalid_amount'
  /** 쓴 것보다 많이 돌려준다 — 그러면 `usedAmount` 가 음수가 된다. */
  | 'exceeds_used'

/** 돌려줘도 된다. */
export interface CardReleaseAllowed {
  readonly outcome: 'allowed'
  /** 이 반환 뒤의 `usedAmount` — 카드에 쓸 값이자 원장 행의 `balanceAfter` 다. */
  readonly usedAmount: number
  /** 돌려주고 난 뒤의 사용 가능액. */
  readonly availableAmount: number
}

/** 돌려주면 안 된다. */
export interface CardReleaseRefused {
  readonly outcome: 'refused'
  readonly reason: CardReleaseRefusal
  /** 지금 돌려줄 수 있는 최대 금액. 곧 지금까지 쓴 금액이다. */
  readonly releasableAmount: number
}

export type CardReleaseDecision = CardReleaseAllowed | CardReleaseRefused

/**
 * 취소·환불로 한도를 돌려받는다 (F2).
 *
 * **상태를 보지 않는 것이 이 함수의 결정이다.** 정지·삭제된 카드로 새 결제는 할 수
 * 없지만, 그 카드로 이미 나간 결제의 환불은 반드시 돌아와야 한다. 막으면 카드를
 * 정지시키는 순간 그 카드의 미결 환불이 갈 곳을 잃고, `usedAmount` 는 영원히 그
 * 금액을 물고 있는다 — 「원장 합계와 사용액이 일치한다」는 요구가 「정지된 카드는
 * 쓸 수 없다」보다 강하다. 사용자가 카드를 지워서 장부가 안 맞는 일은 없어야 한다.
 *
 * 쓴 것보다 많이 돌려주는 것을 거절하는 이유도 같은 자리에 있다. `usedAmount` 가
 * 음수가 되면 사용 가능액이 한도보다 커지고, 그 카드는 **없는 돈을 쓸 수 있는
 * 카드**가 된다. 원장 합계는 그때부터 사용액과 만나지 못한다.
 */
export function releaseDecision(card: VirtualCardCredit, amount: number): CardReleaseDecision {
  const releasable = card.usedAmount

  if (!Number.isInteger(amount) || amount <= 0) {
    return { outcome: 'refused', reason: 'invalid_amount', releasableAmount: releasable }
  }

  if (amount > releasable) {
    return { outcome: 'refused', reason: 'exceeds_used', releasableAmount: releasable }
  }

  const usedAmount = releasable - amount

  return { outcome: 'allowed', usedAmount, availableAmount: card.creditLimit - usedAmount }
}

/**
 * 한 사람이 가질 수 있는 카드의 최대 장수 (F6).
 *
 * 데모 계정은 발급 때 한 장을 자동으로 받는다(F5). 나머지 두 장은 「한도가 다른
 * 카드로 다시 해 보는」 체험의 여유다 — 한 장이면 한도를 다 쓴 사람이 더 볼 것이
 * 없고, 열 장이면 24시간 뒤 지워질 계정 하나가 열 장의 원장을 남긴다.
 */
export const VIRTUAL_CARDS_PER_USER = 3

/**
 * 한 장 더 발급해도 되는가 (F6).
 *
 * 세는 대상은 **살아 있는 카드**다. `DELETED` 는 소프트 삭제라 행이 남고, 그 행까지
 * 세면 카드를 한 번 지운 사람은 영영 새 카드를 받지 못한다 — 지워도 줄지 않는
 * 개수 제한은 사용자에게 고장으로 보인다. `VirtualCard` 의
 * `[userId, status, createdAt]` 인덱스가 그 세기를 위한 것이다.
 */
export function canIssueVirtualCard(livingCards: number): boolean {
  return livingCards < VIRTUAL_CARDS_PER_USER
}
