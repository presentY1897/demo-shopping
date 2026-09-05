import type { Payment } from '@shopping/shared'
import { paymentProviderSchema, paymentResponseSchema } from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'

import { defineFixture } from '../define'
import { shopperOrder } from '../fixtures/checkout'
import { shopperCards } from '../fixtures/payment'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 결제와 카드 (TASK-0054 의 라우트, 주문서의 결제 영역이 부른다).
 *
 * **상태를 갖는다** — `handlers/checkout.ts` 와 같은 이유다. 이 화면이 묻는 것은
 * 「API 가 무엇을 주느냐」가 아니라 「요청에 무엇을 하느냐」다: 승인을 두 번 부르면
 * 두 번 승인되는가, 거절당한 결제로 매입할 수 있는가, 거절 뒤에 다른 카드로 다시
 * 걸면 그것은 새 결제인가. 얼어붙은 픽스처는 그중 어느 것에도 답하지 못한다.
 *
 * **거절은 200이다** (TASK-0052 4.3). 한도가 모자라 승인되지 않은 것은 프로그램의
 * 오류가 아니라 정상적인 대답이고, 그래서 `FAILED` 인 결제가 몸통에 담겨 온다 —
 * 화면이 그것을 오류 화면이 아니라 「다시 해 볼 수 있는 상태」로 그리는지가 이
 * 대역으로 확인된다. HTTP 오류로 답하면 그 확인이 불가능해진다.
 *
 * **재현하지 않는 것.** 카드 원장 차감, 예약 확정, 승인 지연·타임아웃은 여기 없다.
 * 앞의 둘은 실 PostgreSQL 에 대고 도는 `apps/api` 의 검사가 이미 증명하고, 뒤의
 * 것은 서버 설정(`paymentSimulation`)으로만 존재하는 장치라 브라우저에서 켤 수 있는
 * 것이 아니다 — 흉내 내면 더 약한 두 번째 구현이 된다 (QUALITY-GATES 6장).
 * 브라우저가 관찰할 수 있는 것은 **승인됐거나 안 됐거나** 둘뿐이고, 그것은 여기 있다.
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

/** `POST /payments` 의 몸통. 서버의 `startPaymentSchema` 와 같은 모양이다. */
const startPaymentRequestSchema = z.object({
  orderId: z.uuid(),
  provider: paymentProviderSchema,
  /** 어느 수단으로. 가상 카드에서는 카드 id 다. */
  cardId: z.uuid().optional(),
})

type CardList = typeof shopperCards

interface PaymentRow {
  readonly payment: Payment
  /** 시작할 때 고른 카드. 승인이 이 카드를 보고 판단한다. */
  readonly cardId: string | null
}

interface PaymentStore {
  readonly cards: CardList
  readonly rows: ReadonlyMap<string, PaymentRow>
  /** 만든 결제의 수. id 를 예측 가능하게 만드는 데 쓴다. */
  readonly serial: number
}

let store: PaymentStore = { cards: shopperCards, rows: new Map(), serial: 0 }

/**
 * 결제 id. 순번이라 검사가 응답을 읽지 않고도 다음 id 를 안다.
 *
 * 무작위 uuid 를 쓰지 않는 이유는 그것이 아무것도 더 증명하지 않으면서 실패한
 * 검사의 출력만 읽기 어렵게 만들기 때문이다.
 */
function nextPaymentId(serial: number): string {
  return `019596d0-1f1c-7c2e-9a0e-6b${String(serial).padStart(10, '0')}`
}

function answer(payment: Payment): Response {
  return HttpResponse.json(defineFixture(paymentResponseSchema, { payment }))
}

/** 이 결제 하나. 없으면 404 — 남의 결제도 화면에는 없는 것으로 보인다. */
function rowOf(paymentId: string): PaymentRow {
  const row = store.rows.get(paymentId)

  if (row === undefined) throw new MockApiError(404, '결제를 찾을 수 없어요.')

  return row
}

function put(row: PaymentRow): Response {
  const rows = new Map(store.rows)

  rows.set(row.payment.id, row)
  store = { ...store, rows }

  return answer(row.payment)
}

/**
 * 이 카드로 이 금액을 승인할 수 있는가.
 *
 * `virtual-card-rules.ts` 의 `chargeDecision` 이 같은 판단을 하고, 여기서는 **결과만**
 * 필요하다 — 거절 사유를 몸통에 실을 자리가 계약에 없기 때문이다(`paymentSchema` 에
 * 사유 필드가 없다). 화면은 자기가 고른 카드의 사용 가능액을 알고 있으므로 그것으로
 * 문장을 고르고, 그 갈림을 이 대역이 재현한다.
 */
function approves(cardId: string | null, amount: number): boolean {
  const card = store.cards.cards.find((each) => each.id === cardId)

  if (card?.status !== 'ACTIVE') return false

  return card.creditLimit - card.usedAmount >= amount
}

export const paymentHandlers: readonly RequestHandler[] = [
  /**
   * 내 카드들.
   *
   * **정지된 카드도 나간다.** 서버가 살아 있는 카드를 전부 내보내기 때문이고,
   * 화면은 그것을 숨기지 않고 비활성으로 그린다 (TASK-0023 4장) — 없는 것처럼
   * 감추면 카드를 정지시킨 사람은 자기 카드가 사라졌다고 믿는다.
   *
   * 몸통을 다시 감싸지 않는 것은 **그 값이 이미 픽스처**이기 때문이다 —
   * `fixtures/payment.ts` 에서 `defineFixture` 를 지나며 파싱됐고, 여기서 바꾸는
   * 것이 없으므로 한 번 더 파싱해도 같은 값이다 (게이트 C2).
   */
  http.get(mockPaths.cards, () => HttpResponse.json(store.cards)),

  /**
   * 결제를 연다. `READY` 로 시작한다.
   *
   * **승인액은 주문이 정한다.** 부르는 쪽이 금액을 보내지 않는 것이 계약이고, 그래서
   * 이 대역도 씨앗 주문의 실결제금액을 쓴다 — 화면이 보낸 숫자를 그대로 믿으면
   * 「주문서의 금액과 승인액이 다르다」가 검사에서 표현 불가능해진다.
   *
   * 모르는 주문은 404 다. 실제 서비스가 「내 주문 중에 그 id 가 있는가」로 찾으므로,
   * 남의 주문에 결제를 거는 일도 화면에서는 같은 404 로 보인다.
   */
  http.post(mockPaths.payments, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, startPaymentRequestSchema)
      const { order } = shopperOrder

      if (body.orderId !== order.id) throw new MockApiError(404, '주문을 찾을 수 없어요.')

      const serial = store.serial + 1

      store = { ...store, serial }

      return put({
        cardId: body.cardId ?? null,
        payment: {
          id: nextPaymentId(serial),
          orderId: order.id,
          provider: body.provider,
          status: 'READY',
          authorizedAmount: order.paidAmount,
          canceledAmount: 0,
          paymentKey: null,
          approvedAt: null,
          refunds: [],
        },
      })
    }),
  ),

  /**
   * 승인. 카드가 받아 주면 `AUTHORIZED`, 아니면 `FAILED` 다.
   *
   * **둘 다 200이다.** 거절은 값이지 오류가 아니고(4.3), 그 구분이 이 대역이
   * 화면에 지키는 약속이다 — 여기서 4xx 로 답하면 화면은 「결제가 거절됐다」와
   * 「결제 요청이 실패했다」를 구분할 방법을 잃는다.
   *
   * 이미 승인됐거나 실패한 결제를 다시 승인하는 것은 409 다. 정의된 전이가 아니고
   * (`payment-rules.ts` 의 `paymentTransitions`), 그때 화면이 할 일은 새 결제를
   * 여는 것이지 같은 결제를 다시 미는 것이 아니다.
   */
  http.post(mockPaths.paymentAuthorize, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))

      if (row.payment.status !== 'READY') {
        throw new MockApiError(409, '이미 처리된 결제예요.')
      }

      if (!approves(row.cardId, row.payment.authorizedAmount)) {
        return put({ ...row, payment: { ...row.payment, status: 'FAILED' } })
      }

      return put({
        ...row,
        payment: {
          ...row.payment,
          status: 'AUTHORIZED',
          // 가상 카드는 결제 id 를 그대로 결제키로 쓴다 — 취소·환불이 그것으로 이
          // 승인을 되찾는다 (`virtual-card.provider.ts`).
          paymentKey: row.payment.id,
          approvedAt: new Date().toISOString(),
        },
      })
    }),
  ),

  /**
   * 매입 확정. `AUTHORIZED` → `PAID`.
   *
   * 가상 카드는 이 사이에 아무 일도 하지 않지만(승인 시점에 이미 한도가 빠졌다) 두
   * 라우트인 것은 **계약**이다 — 토스에는 그 사이에 은행이 있고, 두 구현이 같은
   * 순서를 따라야 추상화가 값을 한다 (D-031). 그래서 화면도 두 번 부른다.
   */
  http.post(mockPaths.paymentCapture, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))

      if (row.payment.status !== 'AUTHORIZED') {
        throw new MockApiError(409, '승인된 결제만 확정할 수 있어요.')
      }

      return put({ ...row, payment: { ...row.payment, status: 'PAID' } })
    }),
  ),
]

/**
 * 이 목의 카드와 결제를 처음 상태로.
 *
 * 다른 카드로 시작하려면 픽스처를 넘긴다 — 카드가 없는 사람은 `noCards` 다.
 * 「정지된 카드밖에 없다」 같은 조합을 인자로 만들지 않는 이유는, 그것이 씨앗의
 * 문제가 아니라 **어느 카드를 고르느냐**의 문제이기 때문이다: 세 장이 한 화면에
 * 같이 있어야 고를 수 있는 것과 없는 것이 나란히 보인다.
 */
export function resetPaymentStore(seed: CardList = shopperCards): void {
  store = { cards: seed, rows: new Map(), serial: 0 }
}
