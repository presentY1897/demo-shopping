import { defineFixture } from '../define'
import {
  cardListResponseSchema,
  cardTransactionsResponseSchema,
  MOCK_CARD_EXPIRES_AT,
} from '../handlers/card-contract'
import { shopperOrder } from './checkout'

/**
 * 가상 카드와 그 원장 (TASK-0054 의 결제 화면이 고르고, TASK-0058 의 관리 화면이
 * 발급하고 들여다본다).
 *
 * 카드의 모양은 `handlers/card-contract.ts` 가 한 번만 선언한다 — 그 파일이 왜
 * 픽스처 밖에 있어야 하는지도 거기 적혀 있다.
 *
 * **세 장이 서로 다른 대답을 만든다.** 카드가 한 장이면 이 화면들이 그려야 하는
 * 것의 대부분이 표현되지 않는다 — 고를 수 있는 카드와 고를 수 없는 카드가 한
 * 화면에 있어야 「보여 주되 비활성」(TASK-0023 4장)이 확인되고, 한도가 모자란
 * 카드가 있어야 거절이 값으로 오는 길(TASK-0054 4.3)을 화면이 지난다.
 */

/**
 * 로그인한 사람의 카드 세 장.
 *
 * `shopperCheckout` 의 결제예정금액은 476,500원이다. 첫 장은 그것을 덮고 둘째 장은
 * 덮지 못한다 — **한도 초과를 재현하는 것이 TASK-0054 의 핵심 가치**이므로, 그
 * 카드는 빠뜨린 것이 아니라 있어야 하는 것이다.
 *
 * `DELETED` 는 없다. 서버의 `list` 가 살아 있는 카드만 내보내므로 화면이 그것을 볼
 * 길이 없고, 볼 수 없는 것을 대역이 보여 주면 화면은 있지도 않은 경우를 그리게 된다.
 *
 * **세 장은 곧 한 장을 더 만들 수 없다는 뜻이기도 하다** (`MOCK_CARDS_PER_USER`).
 * 관리 화면의 발급이 거절당하는 길이 씨앗에서 이미 열려 있다.
 */
export const shopperCards = defineFixture(cardListResponseSchema, {
  cards: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000001',
      maskedNumber: '9999-****-****-4193',
      brand: '누리카드',
      creditLimit: 1_000_000,
      usedAmount: 300_000,
      status: 'ACTIVE',
      expiresAt: MOCK_CARD_EXPIRES_AT,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000002',
      maskedNumber: '9999-****-****-7025',
      brand: '한결카드',
      creditLimit: 300_000,
      usedAmount: 250_000,
      status: 'ACTIVE',
      expiresAt: MOCK_CARD_EXPIRES_AT,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000003',
      maskedNumber: '9999-****-****-8810',
      brand: '새벽카드',
      creditLimit: 500_000,
      usedAmount: 0,
      status: 'SUSPENDED',
      expiresAt: MOCK_CARD_EXPIRES_AT,
    },
  ],
})

/**
 * 카드가 한 장도 없는 사람.
 *
 * 「없음」을 인자가 아니라 픽스처로 두는 이유는 그것이 **서버가 실제로 내보내는
 * 응답**이기 때문이다 — 빈 배열은 오류가 아니라 아직 카드를 받지 않은 계정의 정상적인
 * 대답이고, 화면은 그때 카드를 만들러 갈 곳을 알려 줘야 한다.
 */
export const noCards = defineFixture(cardListResponseSchema, { cards: [] })

/**
 * 씨앗 주문 말고 원장이 가리키는 지난 주문 둘.
 *
 * `shopperOrder` 하나로는 **환불이 붙은 주문**과 **다른 카드가 결제한 주문**이 한
 * 원장 안에 같이 있을 수 없다. 목에 `GET /orders/:id` 가 없으므로 이 id 들이 닿는
 * 곳은 없지만, 화면이 링크를 **어디로** 거는지는 여기서 정해진다.
 */
const OLDER_ORDER = { id: '019596d0-1f1c-7c2e-9a0e-6d0000000001', number: '20260828-4RJ7H2NC' }
const TIGHT_ORDER = { id: '019596d0-1f1c-7c2e-9a0e-6d0000000002', number: '20260902-9BX4T6KD' }

/**
 * 첫 카드의 사용 내역 (TASK-0058 F3 · F4).
 *
 * **마지막 줄의 `balanceAfter` 가 카드의 `usedAmount` 와 같다** — 300,000. 원장이
 * 잔액을 설명하지 못하면 이 화면의 존재 이유(「환불이 잘 됐는지 잔액으로 확인」)가
 * 사라지므로, 이 두 숫자가 어긋난 씨앗은 씨앗이 아니라 버그다.
 *
 * 다섯 줄이 저마다 다른 것을 증명한다.
 *
 * - 첫 줄은 **주문번호가 `null`** 이다 (4.2). 카드는 결제 말고도 쓸 수 있고, 그때
 *   링크가 없는 줄이 나온다 — 화면이 그 줄에서 깨지지 않는지가 여기서 확인된다.
 * - 둘째·셋째 줄이 **부분 환불**이다. 420,000 을 쓰고 150,000 을 돌려받아 잔액이
 *   450,000 에서 300,000 으로 **줄어든다** — F4 가 재는 「복구」가 이것이다.
 * - 넷째·다섯째 줄은 씨앗 주문(`shopperOrder`)의 승인과 **전체 취소**다. 금액을
 *   그 주문의 실결제금액에서 꺼내 오므로, 주문서가 바뀌면 원장도 따라 바뀐다.
 */
export const shopperCardLedger = defineFixture(cardTransactionsResponseSchema, {
  transactions: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000001',
      kind: 'CHARGE',
      amount: 30_000,
      balanceAfter: 30_000,
      createdAt: '2026-08-20T02:10:00.000Z',
      orderNumber: null,
      orderId: null,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000002',
      kind: 'CHARGE',
      amount: 420_000,
      balanceAfter: 450_000,
      createdAt: '2026-08-28T05:30:00.000Z',
      orderNumber: OLDER_ORDER.number,
      orderId: OLDER_ORDER.id,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000003',
      kind: 'REFUND',
      amount: -150_000,
      balanceAfter: 300_000,
      createdAt: '2026-08-31T08:05:00.000Z',
      orderNumber: OLDER_ORDER.number,
      orderId: OLDER_ORDER.id,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000004',
      kind: 'CHARGE',
      amount: shopperOrder.order.paidAmount,
      balanceAfter: 300_000 + shopperOrder.order.paidAmount,
      createdAt: '2026-09-05T04:03:00.000Z',
      orderNumber: shopperOrder.order.orderNumber,
      orderId: shopperOrder.order.id,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000005',
      kind: 'CANCEL',
      amount: -shopperOrder.order.paidAmount,
      balanceAfter: 300_000,
      createdAt: '2026-09-05T04:41:00.000Z',
      orderNumber: shopperOrder.order.orderNumber,
      orderId: shopperOrder.order.id,
    },
  ],
})

/**
 * 둘째 카드의 사용 내역 — 한 줄뿐이다.
 *
 * 이 카드가 있는 이유는 한도가 모자라는 것이고, 그 상태를 만든 승인이 무엇인지가
 * 원장에 그대로 있어야 「왜 5만원밖에 안 남았나」에 답이 된다. 250,000 은 카드의
 * `usedAmount` 와 같다.
 */
export const tightCardLedger = defineFixture(cardTransactionsResponseSchema, {
  transactions: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000011',
      kind: 'CHARGE',
      amount: 250_000,
      balanceAfter: 250_000,
      createdAt: '2026-09-02T01:20:00.000Z',
      orderNumber: TIGHT_ORDER.number,
      orderId: TIGHT_ORDER.id,
    },
  ],
})

/**
 * 한 번도 쓰지 않은 카드의 사용 내역.
 *
 * 빈 배열을 픽스처로 두는 이유는 `noCards` 와 같다 — 오류가 아니라 **정상적인
 * 대답**이고, 방금 발급받은 카드가 늘 이 대답을 받는다. 화면이 그때 그릴 것을
 * 가지고 있는지가 씨앗으로 확인된다.
 */
export const emptyCardLedger = defineFixture(cardTransactionsResponseSchema, {
  transactions: [],
})
