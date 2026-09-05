import { cardBlock } from './cards'
import type { IssuedCard } from './payment-api'

/**
 * 주문서에서 고를 수 있는 것들 (TASK-0055 4.5).
 *
 * **순수 함수다.** 목록을 만드는 규칙과 기본값을 고르는 규칙이 화면 안에 흩어져
 * 있으면 「토스가 언제 나오는가」를 물어볼 자리가 없어지고, 그 질문이 곧 4.1 이다.
 *
 * **가상 카드가 기본이고 토스가 선택지다** (R3). 데모 방문자에게 익숙한 것은 우리가
 * 발급해 준 카드이고, 토스는 골라야 나타나는 쪽이다 — 순서가 그 판단을 그대로
 * 옮긴 것이라 토스는 언제나 목록의 **끝**에 있다.
 */

/**
 * 결제수단 한 줄. 카드 한 장이거나 토스다.
 *
 * `PaymentProviderName` 을 그대로 쓰지 않는 이유는 그 열거형이 **구현을 고르는
 * 열쇠**이지 화면이 고르는 것이 아니기 때문이다(`packages/shared/src/api/payments.ts`).
 * 사람이 고르는 것은 「어느 카드」이거나 「토스」이고, 카드 세 장은 같은 프로바이더의
 * 서로 다른 선택지다.
 */
export type PaymentMethod =
  { readonly kind: 'card'; readonly card: IssuedCard } | { readonly kind: 'toss' }

/**
 * 라디오의 `value` 로 쓰는 토스의 id.
 *
 * 카드 id 는 uuid 라 이 값과 겹칠 수 없다. 겹치지 않는다는 사실에 기대는 대신
 * {@link methodById} 가 종류를 먼저 보므로, 언젠가 카드 id 의 모양이 바뀌어도
 * 이 짝짓기는 틀리지 않는다.
 */
export const TOSS_METHOD_ID = 'toss'

export function methodId(method: PaymentMethod): string {
  return method.kind === 'toss' ? TOSS_METHOD_ID : method.card.id
}

/**
 * 이 사람이 고를 수 있는 것 전부.
 *
 * `tossOffered` 가 `false` 면 토스는 **목록에 없다** — 비활성으로도 없다 (4.1).
 * 「지금은 쓸 수 없어요」를 보여 주는 것은 정지된 카드에서 하는 일이고(그쪽은 사람이
 * 자기 손으로 정지시켰다), 키가 없는 것은 **방문자가 어찌할 수 없는 우리 설정**이라
 * 알려 줄 이유가 없다.
 */
export function paymentMethods(
  cards: readonly IssuedCard[],
  tossOffered: boolean,
): readonly PaymentMethod[] {
  const rows: PaymentMethod[] = cards.map((card) => ({ card, kind: 'card' }))

  if (tossOffered) rows.push({ kind: 'toss' })

  return rows
}

/**
 * 처음에 골라 둘 것. 없으면 `null`.
 *
 * 고를 수 있는 첫 카드가 먼저다 (R3). 카드가 한 장도 없거나 전부 정지됐을 때에만
 * 토스로 내려간다 — 그때 토스마저 없으면 고를 것이 없고, 화면은 「카드를 발급받으러
 * 가세요」로 끝난다.
 */
export function defaultMethod(methods: readonly PaymentMethod[]): PaymentMethod | null {
  const card = methods.find((method) => method.kind === 'card' && cardBlock(method.card) === null)

  if (card !== undefined) return card

  return methods.find((method) => method.kind === 'toss') ?? null
}

/** id 로 하나 찾기. 목록이 바뀌어 사라진 id 는 `null` 이다. */
export function methodById(
  methods: readonly PaymentMethod[],
  id: string | null,
): PaymentMethod | null {
  if (id === null) return null

  return methods.find((method) => methodId(method) === id) ?? null
}
