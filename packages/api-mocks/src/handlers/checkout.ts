import type {
  ApplicableCoupon,
  AppliedCoupon,
  Checkout,
  CheckoutCouponsResponse,
  CheckoutResponse,
} from '@shopping/shared'
import {
  checkoutCouponsResponseSchema,
  checkoutDraftResponseSchema,
  checkoutDraftSchema,
  checkoutOrderResponseSchema,
  checkoutResponseSchema,
  createCheckoutRequestSchema,
  createOrderRequestSchema,
  orderResponseSchema,
  selectedUserCouponIdsQuerySchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'

import { defineFixture } from '../define'
import { shopperCheckout, shopperOrder } from '../fixtures/checkout'
import { shopperCheckoutCoupons } from '../fixtures/checkout-coupons'
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
  /** 이 주문서에 쓸 수 있(었)는 쿠폰. `GET /checkouts/:id/coupons` 가 답하는 것. */
  readonly coupons: CheckoutCouponsResponse
  /** 예약이 아직 살아 있는가. 푼 뒤에는 `false` 이고, 다시 열면 `true` 가 된다. */
  readonly held: boolean
  /**
   * 목록을 읽은 **뒤에** 다른 주문이 태워 버린 쿠폰들 (TASK-0075 의 경합).
   *
   * 화면이 이 상태에 닿는 길이 둘이고 둘 다 사람이 아무것도 잘못하지 않은 길이다 —
   * 고른 순간의 400 과, 주문하는 순간의 409. 목이 그 둘을 **같은 사실**에서
   * 만들어 내야 화면의 두 문장이 실제로 같은 사건을 말하는지 검사가 확인할 수 있다.
   */
  readonly spent: readonly string[]
}

const EMPTY_CHECKOUT_STORE: CheckoutStore = {
  coupons: shopperCheckoutCoupons,
  held: true,
  seed: shopperCheckout,
  spent: [],
}

let draft = checkoutDraftSchema.parse({})
let store: CheckoutStore = EMPTY_CHECKOUT_STORE

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

// ---------------------------------------------------------------------------
// 쿠폰 적용 (TASK-0075)
//
// **여기 있는 것은 조회지 계산이 아니다.** 목이 하는 일은 「고른 id 가 목록의 어느
// 장인가」를 찾아 그 장이 이미 말해 둔 `discountAmount` 를 더하는 것뿐이고, 두 장이
// 같은 항목을 겹쳐 덮어 잘리는 일은 **재현하지 않는다** — 그 답은 계산 엔진의 것이고
// 여기서 흉내 내면 QUALITY-GATES 6장 이 금지하는 「더 약한 두 번째 구현」이 된다.
// 화면이 이 대역에 물어보는 것도 계산이 아니다: 고른 것이 쿼리에 실려 나가는가,
// 답의 `appliedCoupons` 를 합계 옆에 그리는가, 거절당했을 때 무엇을 하는가.
//
// **판매자별 안분도 하지 않는다.** `sellerOrders[].couponDiscountAmount` 는 0 인 채
// 두고 주문 단위 합계만 깎는다. 안분 규칙은 `docs/design/pricing.md` 의 것이고,
// 화면은 그 숫자를 그리지 않는다.
// ---------------------------------------------------------------------------

/** 쿼리스트링에 실려 온 선택. 없으면 빈 배열이다. */
function selectionOf(url: string): readonly string[] {
  const raw = new URL(url).searchParams.get('userCouponIds')

  if (raw === null) return []

  const parsed = selectedUserCouponIdsQuerySchema.safeParse(raw)

  // 계약을 벗어난 쿼리는 400 이다. 실제 컨트롤러가 `checkoutQueryParamsSchema` 로
  // 같은 자리에서 막으므로, 여기서 통과시키면 화면이 목에서만 되는 문자열을 보낸다.
  if (!parsed.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

  return parsed.data
}

/** 목록에서 이 장을 찾는다. 모르는 id 는 `undefined` 다. */
function couponOf(userCouponId: string): ApplicableCoupon | undefined {
  return store.coupons.coupons.find((entry) => entry.userCoupon.id === userCouponId)
}

/**
 * 지금 이 선택이 통하는가.
 *
 * 통하지 않는 이유가 셋이다 — 모르는 장, 애초에 못 쓰는 장, 그리고 **목록을 읽은
 * 뒤에 다른 주문이 태워 버린 장**. 앞의 둘은 화면의 버그이고 마지막 하나는 아무도
 * 잘못하지 않은 경합이지만, 서버가 답하는 것은 셋 다 같은 400 이다 — 사는 사람이
 * 할 일이 같기 때문이다: 그 장을 빼고 다시 고른다.
 */
function unusable(chosen: readonly string[]): boolean {
  return chosen.some((id) => {
    const entry = couponOf(id)

    // 모르는 장은 `undefined?.fault` 가 `undefined` 라 이 비교에서 함께 걸린다 —
    // 셋을 한 줄로 접은 것이지 하나를 빠뜨린 것이 아니다.
    return entry?.fault !== null || store.spent.includes(id)
  })
}

/** 고른 장들이 실제로 깎은 금액 — 목록이 이미 말해 둔 값 그대로다. */
function appliedOf(chosen: readonly string[]): readonly AppliedCoupon[] {
  return chosen.flatMap((id) => {
    const entry = couponOf(id)

    if (entry === undefined) return []

    return [
      {
        userCouponId: entry.userCoupon.id,
        couponId: entry.userCoupon.couponId,
        name: entry.userCoupon.coupon.name,
        issuerType: entry.userCoupon.coupon.issuerType,
        discountAmount: entry.discountAmount,
      },
    ]
  })
}

/** 고른 쿠폰이 반영된 주문서. 아무것도 안 골랐으면 씨앗 그대로다. */
function repriced(checkout: Checkout, chosen: readonly string[]): Checkout {
  const applied = appliedOf(chosen)
  const total = applied.reduce((sum, entry) => sum + entry.discountAmount, 0)

  return {
    ...checkout,
    appliedCoupons: [...applied],
    totalCouponDiscountAmount: total,
    paidAmount: checkout.paidAmount - total,
  }
}

/**
 * 목록 — 다만 그 사이에 태워진 장은 **이미 사용한 쿠폰**으로 표시해서.
 *
 * 400 을 만난 화면이 목록을 다시 읽는 이유가 이것이다. 거절당한 사람에게 남는 일이
 * 「그 장을 빼고 다시 고르기」인데, 다시 읽은 목록이 여전히 그 장을 쓸 수 있다고
 * 말하면 그 사람은 같은 거절을 한 번 더 받는다.
 */
function couponList(): CheckoutCouponsResponse {
  if (store.spent.length === 0) return store.coupons

  return defineFixture(checkoutCouponsResponseSchema, {
    coupons: store.coupons.coupons.map((entry) =>
      store.spent.includes(entry.userCoupon.id)
        ? { ...entry, discountAmount: 0, fault: 'already_used' as const }
        : entry,
    ),
    recommendation: {
      ...store.coupons.recommendation,
      userCouponIds: store.coupons.recommendation.userCouponIds.filter(
        (id) => !store.spent.includes(id),
      ),
    },
  })
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

  /**
   * 이 주문서에 쓸 수 있는 쿠폰과 추천 조합 (TASK-0075).
   *
   * **못 쓰는 것까지 답한다** (F2). 목록에서 빼면 「분명히 쿠폰이 있었는데
   * 없어졌다」가 되고, 그 사람이 다음에 할 일을 화면이 말해 줄 수 없다.
   *
   * `/checkouts/:id` 보다 **먼저** 등록한다 — msw 는 먼저 맞는 것을 쓰고, 옆의
   * `cartItemsRemove`·`cartItems` 도 같은 순서로 서 있다.
   */
  http.get(mockPaths.checkoutCoupons, ({ params }) =>
    answering(() => {
      heldCheckout(String(params.id))

      return HttpResponse.json(couponList())
    }),
  ),

  /**
   * 새로고침이 하는 일. 같은 주문서를 다시 읽을 뿐 새로 잡지 않는다 (4.1).
   *
   * **고른 쿠폰은 쿼리로 온다** (TASK-0075). 주문서에 저장하지 않는 것이 계약이라
   * 이 대역도 저장하지 않는다 — 저장하면 「고르기」가 상태를 바꾸는 요청이 되고,
   * 그때부터 두 번째 탭이 첫 번째 탭의 선택으로 주문하게 된다.
   */
  http.get(mockPaths.checkoutDraft, () =>
    HttpResponse.json(defineFixture(checkoutDraftResponseSchema, { draft })),
  ),
  http.patch(mockPaths.checkoutDraft, ({ request }) =>
    answering(async () => {
      draft = await readBody(request, checkoutDraftSchema)
      return HttpResponse.json(defineFixture(checkoutDraftResponseSchema, { draft }))
    }),
  ),
  http.get(mockPaths.checkoutOrder, () =>
    HttpResponse.json(defineFixture(checkoutOrderResponseSchema, { order: null })),
  ),
  http.get(mockPaths.checkout, ({ params, request }) =>
    answering(() => {
      const checkout = heldCheckout(String(params.id))
      const chosen = selectionOf(request.url)

      if (unusable(chosen)) {
        // `details[0].field` 가 `userCouponIds` 다 (계약). 화면이 「어느 입력이
        // 문제였나」를 그것으로 가르므로, 코드만 맞고 필드가 비면 같은 400 이
        // 쿼리 오류와 구분되지 않는다.
        throw new MockApiError(400, '지금은 쓸 수 없는 쿠폰이에요.', {
          code: 'COUPON_NOT_APPLICABLE',
          field: 'userCouponIds',
        })
      }

      return answer(repriced(checkout, chosen))
    }),
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

      // 고른 것과 주문에 실린 것이 **같은 선택**이어야 한다 (계약). 그 사이에 다른
      // 주문이 한 장을 태웠다면 여기서 지는 쪽이 생기고, 그것은 400 이 아니라
      // 409 다 — 요청이 틀린 것이 아니라 세상이 바뀐 것이기 때문이다.
      if (body.userCouponIds.some((id) => store.spent.includes(id))) {
        throw new MockApiError(409, '이미 사용된 쿠폰이에요.', {
          code: 'COUPON_ALREADY_USED',
          field: 'userCouponIds',
        })
      }

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
  draft = checkoutDraftSchema.parse({})
  store = { ...EMPTY_CHECKOUT_STORE, seed }
}

/**
 * 이 목의 쿠폰함을 갈아 끼운다 (TASK-0075).
 *
 * 주문서와 **따로** 받는 이유는 둘이 서로 다른 것을 정하기 때문이다 — 주문서는
 * 「얼마짜리를 사는가」이고 쿠폰함은 「무엇을 갖고 있는가」다. 한 번에 받으면 쿠폰이
 * 한 장도 없는 화면을 보려는 검사가 주문서까지 다시 적어야 한다.
 */
export function seedCheckoutCoupons(coupons: CheckoutCouponsResponse): void {
  store = { ...store, coupons }
}

/**
 * 목록을 읽은 뒤 다른 주문이 이 쿠폰을 태웠다고 친다.
 *
 * **화면이 경합에 닿는 유일한 문**이다. 사람이 화면에서 만들 수 있는 상태가
 * 아니므로(못 쓰는 쿠폰은 애초에 고를 수 없다) 검사가 밖에서 만들어 준다. 이
 * 한 번의 호출이 두 거절을 모두 켠다 — 고르는 순간의 400 과 주문하는 순간의 409 —
 * 그 둘이 **같은 사실의 앞뒤**라는 것이 이 목이 지키는 성질이다.
 */
export function spendCouponElsewhere(userCouponId: string): void {
  store = { ...store, spent: [...store.spent, userCouponId] }
}
