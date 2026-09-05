import type { Payment } from '@shopping/shared'
import { paymentProviderSchema, paymentResponseSchema } from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'

import { defineFixture } from '../define'
import { shopperOrder } from '../fixtures/checkout'
import {
  emptyCardLedger,
  shopperCardLedger,
  shopperCards,
  tightCardLedger,
} from '../fixtures/payment'
import { mockPaths } from '../paths'
import type { CardTransaction, IssuedCard } from './card-contract'
import {
  cardListResponseSchema,
  cardResponseSchema,
  cardTransactionsResponseSchema,
  issueCardRequestSchema,
  MOCK_CARD_EXPIRES_AT,
  MOCK_CARDS_PER_USER,
} from './card-contract'
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
 * **원장도 그 선 위에 있다** (TASK-0058 4.1). `GET /cards/:id/transactions` 는 씨앗
 * 원장을 그대로 내보내지, 이 목을 지난 결제로 줄을 하나 더 만들지 않는다 — 그 계산은
 * 잠금 아래에서 도는 서버의 것이고, 여기서 다시 쓰면 두 번째 구현이 된다. 관리 화면이
 * 물어보는 것은 **원장이 어떻게 만들어지는가**가 아니라 「원장이 오면 그것을 읽고
 * 환불을 알아볼 수 있게 그리는가」이고, 그 질문에는 얼어붙은 원장으로 답할 수 있다.
 * 반대로 발급·정지·삭제는 **요청이 목록을 바꾸는가**를 묻는 것이라 상태를 갖는다.
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

/**
 * `POST /payments/:id/toss/confirm` 의 몸통 (TASK-0055).
 *
 * **금액을 받는 이유는 쓰기 위해서가 아니라 대조하기 위해서다** (F2). 브라우저가
 * 무엇을 들고 돌아왔는지 알아야 조작을 발견할 수 있고, 받지 않으면 발견할 것
 * 자체가 없다.
 */
const confirmTossRequestSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  amount: z.int().nonnegative(),
})

type CardList = typeof shopperCards

interface PaymentRow {
  readonly payment: Payment
  /** 시작할 때 고른 카드. 승인이 이 카드를 보고 판단한다. */
  readonly cardId: string | null
}

interface PaymentStore {
  /**
   * 살아 있는 카드들.
   *
   * 픽스처가 아니라 **배열**인 것은 TASK-0058 이 발급·정지·삭제를 더했기 때문이다 —
   * 목록이 요청에 따라 바뀌므로 얼어붙은 픽스처를 그대로 돌려줄 수 없고, 대신 나갈
   * 때마다 `defineFixture` 를 지난다 (게이트 C2).
   *
   * `DELETED` 는 여기 남지 않는다. 서버의 `list` 가 살아 있는 카드만 내보내므로,
   * 지운 카드를 들고 있으면 대역만 아는 상태가 하나 생긴다.
   */
  readonly cards: readonly IssuedCard[]
  /**
   * 카드별 원장 (TASK-0058 4.1).
   *
   * 카드에 딸려 다니는 것이지 따로 서 있는 것이 아니라서 맵이다 — 카드를 지우면
   * 원장도 같이 사라지고, 그러면 지워진 카드의 원장을 읽는 길이 대역에도 없다.
   */
  readonly ledgers: ReadonlyMap<string, readonly CardTransaction[]>
  readonly rows: ReadonlyMap<string, PaymentRow>
  /** 만든 결제의 수. id 를 예측 가능하게 만드는 데 쓴다. */
  readonly serial: number
  /** 발급한 카드의 수. 결제와 같은 이유로 순번이다. */
  readonly issued: number
}

/**
 * 씨앗 카드에 딸린 원장.
 *
 * 카드 id 로 붙인다 — `noCards` 처럼 다른 씨앗으로 시작하면 아무것도 딸려 오지
 * 않고, 그것이 맞다: 원장은 카드의 것이지 계정의 것이 아니다. 씨앗에 없는 카드는
 * 빈 원장을 받는다.
 */
function seedLedgers(
  cards: readonly IssuedCard[],
): ReadonlyMap<string, readonly CardTransaction[]> {
  const [first, second] = shopperCards.cards
  const known = new Map<string, readonly CardTransaction[]>()

  if (first !== undefined) known.set(first.id, shopperCardLedger.transactions)
  if (second !== undefined) known.set(second.id, tightCardLedger.transactions)

  return new Map(
    cards.map((card) => [card.id, known.get(card.id) ?? emptyCardLedger.transactions] as const),
  )
}

/** {@link declineNextTossApproval} 이 세우고, 그것이 만든 거절이 내린다. */
let declineNextToss = false

/** {@link unresolveNextApproval} 이 세우고, 그것이 만든 `UNRESOLVED` 가 내린다. */
let unresolveNext = false

let store: PaymentStore = {
  cards: shopperCards.cards,
  issued: 0,
  ledgers: seedLedgers(shopperCards.cards),
  rows: new Map(),
  serial: 0,
}

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
  const card = store.cards.find((each) => each.id === cardId)

  if (card?.status !== 'ACTIVE') return false

  return card.creditLimit - card.usedAmount >= amount
}

/** 지금의 카드 목록, 계약을 지나서. */
function cardList(): Response {
  return HttpResponse.json(defineFixture(cardListResponseSchema, { cards: [...store.cards] }))
}

/** 카드 한 장의 봉투. 발급·정지·해제가 전부 이 모양으로 답한다. */
function cardAnswer(card: IssuedCard): Response {
  return HttpResponse.json(defineFixture(cardResponseSchema, { card }))
}

/**
 * 내 카드 한 장. 없으면 404.
 *
 * **남의 카드도 화면에는 「없다」로 보인다** (3장 A3). 서버가 소유권을 조건에 두고
 * 찾으므로 「있지만 당신 것이 아니다」라는 대답 자체가 존재하지 않고, 대역이 그것을
 * 403 으로 바꾸면 화면은 있지도 않은 갈림을 그리게 된다.
 */
function cardOf(cardId: string): IssuedCard {
  const card = store.cards.find((each) => each.id === cardId)

  if (card === undefined) throw new MockApiError(404, '카드를 찾을 수 없어요.')

  return card
}

/** 이 카드의 상태를 바꿔 저장한다. 정지와 해제가 같은 길을 쓴다. */
function setCardStatus(cardId: string, status: IssuedCard['status']): Response {
  const card = cardOf(cardId)
  const updated: IssuedCard = { ...card, status }

  store = {
    ...store,
    cards: store.cards.map((each) => (each.id === cardId ? updated : each)),
  }

  return cardAnswer(updated)
}

/**
 * 발급되는 카드의 브랜드. 순번으로 돌린다.
 *
 * 무작위로 뽑지 않는 이유는 검사가 방금 만든 카드를 **이름으로** 찾기 때문이다 —
 * 매번 다른 이름이 나오면 그 검사는 화면이 아니라 난수를 재게 된다. 실제 상표와
 * 겹치지 않는 가상 브랜드다.
 */
const ISSUED_BRANDS = ['하늘카드', '온새미카드', '가람카드'] as const

/** 새 카드 한 장. 순번이라 검사가 응답을 읽지 않고도 다음 카드를 안다. */
function mint(serial: number, creditLimit: number): IssuedCard {
  const brand = ISSUED_BRANDS[(serial - 1) % ISSUED_BRANDS.length] ?? ISSUED_BRANDS[0]

  return {
    id: `019596d0-1f1c-7c2e-9a0e-6f${String(serial).padStart(10, '0')}`,
    // 뒤 네 자리만 다르다. 앞은 언제나 `9999` 여야 하고(TASK-0053 R1), 가운데는
    // 서버도 내보내지 않는다 — 마스킹된 번호가 유일하게 나가는 형태다.
    maskedNumber: `9999-****-****-${String(3_000 + serial).padStart(4, '0')}`,
    brand,
    creditLimit,
    usedAmount: 0,
    status: 'ACTIVE',
    expiresAt: MOCK_CARD_EXPIRES_AT,
  }
}

export const paymentHandlers: readonly RequestHandler[] = [
  /**
   * 내 카드들.
   *
   * **정지된 카드도 나간다.** 서버가 살아 있는 카드를 전부 내보내기 때문이고,
   * 화면은 그것을 숨기지 않고 비활성으로 그린다 (TASK-0023 4장) — 없는 것처럼
   * 감추면 카드를 정지시킨 사람은 자기 카드가 사라졌다고 믿는다.
   *
   * 목록이 **씨앗 그대로가 아니게 됐다** (TASK-0058). 발급·정지·삭제가 이 배열을
   * 바꾸므로 나갈 때마다 `defineFixture` 를 다시 지난다 — 계약에서 벗어난 카드는
   * 그것을 잘못 그리는 화면이 아니라 여기서 실패한다 (게이트 C2).
   */
  http.get(mockPaths.cards, () => cardList()),

  /**
   * 카드 발급 (TASK-0058 F1).
   *
   * **한도는 사람이 정한다.** 이 카드가 존재하는 이유가 「한도 초과를 재현해 본다」인
   * 만큼 낮은 한도를 일부러 고를 수 있어야 하고, 그래서 몸통에 그 숫자가 있다.
   *
   * 두 가지로 거절한다. 범위를 벗어난 한도는 **400**이고(`issueCardRequestSchema`),
   * 장수를 채운 것은 `CARD_COUNT_REACHED` 다 — 이름이 비슷하지만 사람이 할 일이
   * 정반대라 코드가 다르다: 앞은 숫자를 고치는 것이고 뒤는 카드를 지우는 것이다.
   */
  http.post(mockPaths.cards, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, issueCardRequestSchema)

      if (store.cards.length >= MOCK_CARDS_PER_USER) {
        throw new MockApiError(400, `카드는 ${String(MOCK_CARDS_PER_USER)}장까지 만들 수 있어요.`, {
          code: 'CARD_COUNT_REACHED',
          field: 'creditLimit',
          params: { max: MOCK_CARDS_PER_USER },
        })
      }

      const issued = store.issued + 1
      const card = mint(issued, body.creditLimit)

      store = {
        ...store,
        cards: [card, ...store.cards],
        issued,
        // 갓 만든 카드의 원장은 비어 있다. 「아직 아무 일도 없었다」는 오류가 아니다.
        ledgers: new Map(store.ledgers).set(card.id, emptyCardLedger.transactions),
      }

      return cardAnswer(card)
    }),
  ),

  /**
   * 정지와 해제 (F5).
   *
   * **목록에서 사라지지 않는다.** 정지는 삭제가 아니고(TASK-0054 4.1), 감추면 카드를
   * 정지시킨 사람은 자기 카드가 사라졌다고 믿는다 — 화면이 그것을 「보여 주되
   * 비활성」으로 그리는지가 이 대역으로 확인된다.
   *
   * 이미 그 상태인 카드에 다시 걸어도 409 가 아니다. 서버가 상태를 **대입**하지
   * 전이를 검사하지 않으므로(`setStatus`), 여기서 거절하면 대역만 아는 규칙이 된다.
   */
  http.post(mockPaths.cardSuspend, ({ params }) =>
    answering(() => setCardStatus(String(params.id), 'SUSPENDED')),
  ),

  http.post(mockPaths.cardActivate, ({ params }) =>
    answering(() => setCardStatus(String(params.id), 'ACTIVE')),
  ),

  /**
   * 카드 사용 내역 (F3 · F4).
   *
   * 시간순으로 나간다 — 서버의 `ORDER BY t."createdAt" ASC` 와 같은 순서이고, 그
   * 순서라야 `balanceAfter` 가 잔액의 **이야기**가 된다. 뒤집어 보내면 화면이 다시
   * 정렬해야 하고, 그 정렬은 서버와 갈릴 수 있는 두 번째 규칙이다.
   *
   * 모르는 카드는 404 다. 남의 카드 원장은 있는지 없는지도 알려 주지 않는다 —
   * 그 사람이 무엇을 샀는지가 그 목록에 그대로 적혀 있다 (3장 A3).
   */
  http.get(mockPaths.cardTransactions, ({ params }) =>
    answering(() => {
      const card = cardOf(String(params.id))

      return HttpResponse.json(
        defineFixture(cardTransactionsResponseSchema, {
          transactions: [...(store.ledgers.get(card.id) ?? [])],
        }),
      )
    }),
  ),

  /**
   * 카드 삭제. **204 이고 몸통이 없다.**
   *
   * 서버에서는 소프트 삭제이고(원장이 이 카드를 가리킨다) 목록에서만 빠지므로,
   * 대역도 배열에서 빼는 것으로 같은 관찰 결과를 만든다. 지운 카드의 원장을 읽는
   * 길이 남지 않는 것도 서버와 같다 — 목록에 없는 카드는 404 다.
   */
  http.delete(mockPaths.card, ({ params }) =>
    answering(() => {
      const card = cardOf(String(params.id))
      const ledgers = new Map(store.ledgers)

      ledgers.delete(card.id)
      store = { ...store, cards: store.cards.filter((each) => each.id !== card.id), ledgers }

      return new HttpResponse(null, { status: 204 })
    }),
  ),

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
   *
   * **결말이 셋이다** (D-220). 승인·거절 말고 **답 없음**(`UNRESOLVED`)이 있고,
   * {@link unresolveNextApproval} 이 그것을 만든다 — 서버의 `authorize` 가 거절이
   * 아닌 실패를 전부 그 상태로 보내므로(`landing`), 이 라우트가 그 몸통을 낼 수
   * 있다는 것 자체가 계약이다.
   */
  http.post(mockPaths.paymentAuthorize, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))

      if (row.payment.status !== 'READY') {
        throw new MockApiError(409, '이미 처리된 결제예요.')
      }

      // 카드 판단보다 **앞**이다. 닿지 못한 요청은 저쪽이 무엇을 볼지 알기 전에
      // 끊긴 것이라, 한도가 남았는지 여부와 상관없이 결말이 정해지지 않는다.
      if (unresolveNext) {
        unresolveNext = false

        return put({ ...row, payment: { ...row.payment, status: 'UNRESOLVED' } })
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

  /**
   * 토스 결제창이 돌아온 뒤의 승인 (TASK-0055 F1 · F2 · F4).
   *
   * **이 라우트가 재현하는 것은 우리 쪽 절반이다** (4.2). 토스 HTTP 는 여기에도
   * 없고, 있는 것은 서버가 저쪽을 부르기 **전에** 내리는 판단 셋 — 프로바이더가
   * 맞는가, 아직 `READY` 인가, 금액이 우리 DB 의 승인액과 같은가 — 이다.
   * `apps/api/src/payment/toss-rules.ts` 의 `confirmDecision` 이 같은 순서로
   * 같은 것을 보고, 순서가 곧 답의 우선순위다.
   *
   * **셋의 코드가 다른 이유는 사람이 할 일이 다르기 때문**이다. 금액이 어긋난
   * 것은 400 이고 저쪽에 아무 승인도 남지 않았지만, 이미 처리된 결제는 409 이고
   * **다시 결제하라고 말하면 안 된다** — 성공 주소를 새로고침한 사람이 정확히
   * 그 경우다.
   *
   * 거절은 여기서도 **200 이다** (TASK-0052 4.3). 카드사가 받아 주지 않은 것은
   * 정상적인 대답이고, {@link declineNextTossApproval} 이 그것을 만든다.
   *
   * **결말은 여기서도 셋이다** (D-220). 서버의 `confirmToss` 는 대조를 마친 뒤
   * `authorize` 를 그대로 지나므로, 이 라우트의 응답도 승인·거절·**답 없음**
   * (`UNRESOLVED`)으로 갈린다 — {@link unresolveNextApproval} 이 그것을 만든다.
   * 실제로 그 상태를 만드는 프로바이더가 토스뿐이라, 이 라우트가 그 손잡이의
   * **진짜 자리**다.
   */
  http.post(mockPaths.paymentTossConfirm, ({ params, request }) =>
    answering(async () => {
      const row = rowOf(String(params.id))
      const body = await readBody(request, confirmTossRequestSchema)

      if (row.payment.provider !== 'TOSS') {
        throw new MockApiError(400, '토스로 시작한 결제가 아니에요.', {
          code: 'PAYMENT_PROVIDER_MISMATCH',
          field: 'provider',
        })
      }

      // **「모른다」를 「이미 처리됐다」로 접지 않는다** (D-220). 둘 다 409 지만 사람이
      // 읽을 문장이 반대다 — 앞은 「확인 중이니 기다려 주세요」이고 뒤는 「이미
      // 끝났어요」다. `confirmDecision` 이 같은 이유로 이 갈래를 앞에 두므로 순서까지
      // 같게 둔다. 코드는 새 결제를 막을 때와 **같은 것**이다: 화면이 두 자리를 같은
      // 문장으로 답하게 하려는 것이 그 선택의 값이다.
      if (row.payment.status === 'UNRESOLVED') {
        throw new MockApiError(409, '앞선 결제의 결과를 확인하는 중이에요.', {
          code: 'PAYMENT_AWAITING_RESULT',
          field: 'status',
        })
      }

      if (row.payment.status !== 'READY') {
        throw new MockApiError(409, '이미 처리된 결제예요.', {
          code: 'PAYMENT_TRANSITION_REFUSED',
          field: 'status',
        })
      }

      if (row.payment.authorizedAmount !== body.amount) {
        throw new MockApiError(400, '결제 금액이 주문 금액과 달라요.', {
          code: 'PAYMENT_AMOUNT_MISMATCH',
          field: 'amount',
        })
      }

      if (declineNextToss) {
        declineNextToss = false

        return put({ ...row, payment: { ...row.payment, status: 'FAILED' } })
      }

      // 승인 라우트와 같은 손잡이를 본다. 서버에서 두 길이 같은 `authorize` 로
      // 합쳐지므로, 대역에서 손잡이를 둘로 나누면 대역만 아는 구분이 하나 생긴다.
      if (unresolveNext) {
        unresolveNext = false

        return put({ ...row, payment: { ...row.payment, status: 'UNRESOLVED' } })
      }

      return put({
        ...row,
        payment: {
          ...row.payment,
          status: 'AUTHORIZED',
          // 결제창이 돌려준 키가 이 승인을 되찾는 열쇠가 된다 — 서버는 그것을
          // `methodRef` 에 쓴다 (4.6).
          paymentKey: body.paymentKey,
          approvedAt: new Date().toISOString(),
        },
      })
    }),
  ),
]

/**
 * 이 목의 카드와 원장과 결제를 처음 상태로.
 *
 * 다른 카드로 시작하려면 픽스처를 넘긴다 — 카드가 없는 사람은 `noCards` 다.
 * 「정지된 카드밖에 없다」 같은 조합을 인자로 만들지 않는 이유는, 그것이 씨앗의
 * 문제가 아니라 **어느 카드를 고르느냐**의 문제이기 때문이다: 세 장이 한 화면에
 * 같이 있어야 고를 수 있는 것과 없는 것이 나란히 보인다.
 */
export function resetPaymentStore(seed: CardList = shopperCards): void {
  declineNextToss = false
  unresolveNext = false
  store = {
    cards: [...seed.cards],
    issued: 0,
    ledgers: seedLedgers(seed.cards),
    rows: new Map(),
    serial: 0,
  }
}

/**
 * 다음 토스 승인을 **거절로** 답한다. 한 번만.
 *
 * 거절이 `server.use(...)` 가 아니라 손잡이인 이유는 **그것이 오류가 아니기**
 * 때문이다 (TASK-0052 4.3). 카드사가 받아 주지 않은 것은 200 과 함께 `FAILED` 인
 * 결제로 오고, 그 몸통은 이 저장소의 다른 응답과 똑같이 `defineFixture` 를 지나야
 * 한다 — 스펙이 직접 만든 페이로드로 대신하면 계약 게이트(C2) 밖으로 새는 응답이
 * 하나 생기고, 그 스펙은 `msw` 를 직접 임포트하게 된다 (TASK-0107 F3).
 *
 * `failNextDefaultAssignment` 와 같은 모양이고 같은 이유다: 화면이 관찰할 수 있는
 * 결과를 만들되, 그 결과를 만드는 조건까지 흉내 내지는 않는다.
 */
export function declineNextTossApproval(): void {
  declineNextToss = true
}

/**
 * 다음 승인을 **결과를 모르는 것으로** 답한다 — `UNRESOLVED` 다. 한 번만 (D-220).
 *
 * {@link declineNextTossApproval} 과 같은 모양이고 같은 이유다: 거절도 답 없음도
 * 오류가 아니라 **값**이라 200 과 함께 결제 몸통으로 오고, 그 몸통은 다른 응답과
 * 똑같이 `defineFixture` 를 지나야 한다 (게이트 C2).
 *
 * **승인 라우트와 토스 승인 라우트 둘 다에 걸린다.** 서버에서 그 둘이 같은
 * `authorize` 로 합쳐지기 때문이고(`confirmToss` 가 대조를 마친 뒤 그것을 부른다),
 * 손잡이를 둘로 나누면 대역만 아는 구분이 하나 생긴다.
 *
 * **실제로 이 결말을 내는 것은 토스뿐이다.** `virtual-card.provider.ts` 가 `unknown`
 * 을 내지 않아서인데 — 우리 프로세스 안에서 끝나므로 「승인됐는지 모른다」가 성립하지
 * 않는다 — 그래도 가상 카드 쪽 승인 라우트에도 걸어 두는 이유는, 재는 것이
 * **프로바이더의 사정이 아니라 화면의 가정**이기 때문이다: 「`FAILED` 가 아니면
 * 승인됐다」로 읽는 화면은 그 상태가 오는 날 매입을 걸고, 그 매입은 409 로 거절되어
 * 「잠시 후 다시 결제해 주세요」가 된다. 그 가정을 재려면 그 몸통이 있어야 한다.
 */
export function unresolveNextApproval(): void {
  unresolveNext = true
}
