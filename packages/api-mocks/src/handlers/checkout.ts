import type { Checkout, CheckoutResponse } from '@shopping/shared'
import {
  checkoutResponseSchema,
  createCheckoutRequestSchema,
  createOrderRequestSchema,
  orderResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'

import { defineFixture } from '../define'
import { shopperCheckout, shopperOrder } from '../fixtures/checkout'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 주문서 (TASK-0050 4.1 의 라우트, 그 화면이 읽는다).
 *
 * **상태를 갖는다** — `handlers/cart.ts` 와 같은 이유다. 이 화면이 묻는 것은 「API 가
 * 무엇을 주느냐」가 아니라 「요청에 무엇을 하느냐」다: 이탈해서 예약을 풀면 그 다음
 * 조회가 없는 것으로 답하는가, 두 번 풀면 실패가 아니라 0으로 답하는가, 주문을 만든
 * 뒤에도 주문서는 살아 있는가. 얼어붙은 픽스처는 그중 어느 것에도 답하지 못한다.
 *
 * **주문서는 열린 채로 시작한다.** 화면은 `/checkout/{id}` 로 진입해 **이미 열린
 * 것을 id 로 읽으므로**(4.1 — 여는 것은 장바구니의 「주문하기」다), 대역이 닫힌 채로
 * 시작하면 화면을 그리는 검사마다 장바구니를 먼저 흉내 내야 한다. 만료된 상태에는
 * 그래도 두 갈래로 닿는다: 모르는 id 로 읽거나, `DELETE` 로 풀고 다시 읽거나.
 *
 * **재현하지 않는 것.** 재고를 실제로 잠그는 일, 만료 시각이 지나면 저절로 풀리는
 * 일, 남의 주문서를 읽었을 때의 403 은 여기 없다. 그것은 실 PostgreSQL 에 대고 도는
 * `apps/api` 의 검사가 이미 증명하는 것이고, 여기서 흉내 내면 더 약한 두 번째
 * 구현이 된다 (QUALITY-GATES 6장). 브라우저가 관찰할 수 있는 것은 **없어졌다는
 * 404** 하나이고, 그것은 여기 있다.
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

/**
 * `DELETE /checkouts/:id` 의 응답.
 *
 * `@shopping/shared` 에 이 몸통의 스키마가 없다 — 컨트롤러가
 * `Promise<{ released: number }>` 를 그대로 답하고 zod 를 거치지 않는 유일한 자리다.
 * 그래서 가장 작은 것을 여기서 선언한다. 이 하나만 `defineFixture` 를 지나지 않으면
 * C2 에 구멍이 생기고, 새는 곳은 늘 그런 자리다.
 */
const releaseResponseSchema = z.object({ released: z.int().min(0) })

interface CheckoutStore {
  /** 이 목이 열 수 있는 주문서. `resetCheckoutStore` 가 갈아 끼운다. */
  readonly seed: CheckoutResponse
  /** 예약이 아직 살아 있는가. 푼 뒤에는 `false` 이고, 다시 열면 `true` 가 된다. */
  readonly held: boolean
}

let store: CheckoutStore = { held: true, seed: shopperCheckout }

/**
 * 열려 있는 주문서 하나. 아니면 404 다.
 *
 * 만료와 「원래 없다」를 가르지 않는 것은 실제 API 가 그렇기 때문이다 — 예약이 풀린
 * 주문서는 조회할 행 자체가 남지 않으므로 `CheckoutService.linesOf` 가 `NotFound` 를
 * 던진다. 화면이 만료를 아는 방법이 이 404 다.
 */
function heldCheckout(checkoutId: string): Checkout {
  if (!store.held || checkoutId !== store.seed.checkout.id) {
    throw new MockApiError(404, '주문서를 찾을 수 없어요.')
  }

  return store.seed.checkout
}

function answer(checkout: Checkout): Response {
  return HttpResponse.json(defineFixture(checkoutResponseSchema, { checkout }))
}

/** 예약은 줄마다 하나다. 그래서 푼 개수는 곧 주문서의 줄 수다. */
function lineCount(checkout: Checkout): number {
  return checkout.sellerOrders.reduce((count, sellerOrder) => count + sellerOrder.items.length, 0)
}

export const checkoutHandlers: readonly RequestHandler[] = [
  /**
   * 주문서를 연다 — 즉 재고를 잡는다.
   *
   * 고른 줄에 따라 다른 주문서를 만들지 않는다. 부분집합의 금액을 다시 내려면 계산
   * 엔진을 대역 안에 한 벌 더 두어야 하고(배송비 무료 기준이 그룹마다 다르다), 그것이
   * QUALITY-GATES 6장 이 금지하는 「더 약한 두 번째 구현」이다. 몸통은 그래도
   * 검사한다 — 화면이 보낸 것이 계약에 맞는지는 여기서 갈린다 (게이트 C1).
   *
   * 같은 id 를 다시 내는 것은 덤이 아니라 쓸모다. 화면이 갈 곳이
   * `/checkout/{shopperCheckout.checkout.id}` 로 정해지므로, 라우팅을 검사하는 쪽이
   * 응답을 먼저 읽지 않고도 목적지를 안다.
   */
  http.post(mockPaths.checkouts, ({ request }) =>
    answering(async () => {
      await readBody(request, createCheckoutRequestSchema)
      store = { ...store, held: true }

      return answer(store.seed.checkout)
    }),
  ),

  /** 새로고침이 하는 일. 같은 주문서를 다시 읽을 뿐 새로 잡지 않는다 (4.1). */
  http.get(mockPaths.checkout, ({ params }) =>
    answering(() => answer(heldCheckout(String(params.id)))),
  ),

  /**
   * 이탈. 이 주문서의 예약을 전부 푼다.
   *
   * **두 번 불러도 성공이다.** 부르는 쪽은 페이지를 떠나는 중이고 「이미 풀렸다」에
   * 대해 할 수 있는 일이 없다 — 그래서 두 번째는 거절이 아니라 `released: 0` 이다.
   * `sendBeacon` 은 응답을 읽지도 못하므로(4.4) 여기서의 거절은 아무에게도 닿지
   * 않는다.
   *
   * 모르는 id 는 404 다. 이미 푼 주문서(행이 남아 있다)와 애초에 없던 주문서를
   * 실제 API 도 그렇게 가른다.
   */
  http.delete(mockPaths.checkout, ({ params }) =>
    answering(() => {
      const { checkout } = store.seed

      if (String(params.id) !== checkout.id) {
        throw new MockApiError(404, '주문서를 찾을 수 없어요.')
      }

      const released = store.held ? lineCount(checkout) : 0
      store = { ...store, held: false }

      return HttpResponse.json(defineFixture(releaseResponseSchema, { released }))
    }),
  ),

  /**
   * 주문 생성.
   *
   * **주문서는 열린 채로 남는다.** 주문이 생겨도 재고는 줄지 않고 예약은 `HELD` 로
   * 있는다 (TASK-0049 4.4) — 확정은 결제 승인(M08)의 일이다. 화면은 이 응답을 받고
   * 결제로 떠나므로 주문서를 다시 읽지 않지만, 여기서 닫아 버리면 대역이 계약에 없는
   * 규칙을 하나 갖게 된다.
   *
   * 만료된 주문서로 주문하면 404 다. 타이머가 다 돌기 전에 「주문하기」를 누른
   * 사람이 만나는 것이 이것이고, 화면은 그때 재시도를 안내한다 (F3).
   *
   * `itemIds` 로 부르는 길도 계약에 남아 있다 (4.3). 주문서 화면은 그 길을 쓰지
   * 않으므로 갈래를 나누지 않는다 — 어느 문으로 들어와도 답은 씨앗의 주문 하나다.
   * 「어느 줄로 주문했나」는 이 대역이 재현하는 것이 아니다.
   */
  http.post(mockPaths.orders, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, createOrderRequestSchema)

      if (body.checkoutId !== undefined) heldCheckout(body.checkoutId)

      return HttpResponse.json(defineFixture(orderResponseSchema, shopperOrder))
    }),
  ),
]

/**
 * 이 목의 주문서를 처음 상태로 — 열려 있고, 아직 아무것도 풀리지 않은 상태.
 *
 * 다른 주문서로 시작하려면 `defineFixture(checkoutResponseSchema, ...)` 를 지난 값을
 * 넘긴다. 「닫힌 채로 시작」은 인자가 아니라 `DELETE` 로 만든다 — 그것이 화면이
 * 실제로 그 상태에 닿는 방법이기 때문이다.
 */
export function resetCheckoutStore(seed: CheckoutResponse = shopperCheckout): void {
  store = { held: true, seed }
}
