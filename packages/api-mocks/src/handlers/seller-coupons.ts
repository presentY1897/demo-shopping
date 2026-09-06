import type { Coupon, CouponListEntry } from '@shopping/shared'
import {
  COUPON_CODE_ALPHABET,
  COUPON_CODE_LENGTH,
  COUPON_LIST_DEFAULT_LIMIT,
  couponListQueryParamsSchema,
  couponListResponseSchema,
  couponResponseSchema,
  createCouponRequestSchema,
  updateCouponRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'
import type { MockSellerCouponSeed } from './seller-coupon-contract'
import {
  isOwnProductId,
  MOCK_COUPON_SELLER_ID,
  MOCK_SELLER_COUPON_NOW,
  mockSellerCouponSeeds,
  sellerCouponEntryOf,
  sellerCouponTotals,
  sortSellerCoupons,
} from './seller-coupon-contract'

/**
 * 판매자 콘솔의 쿠폰 (TASK-0074), 화면이 물어보는 것만큼.
 *
 * **상태를 갖는다.** 이 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다 —
 * 발행을 중단하면 그 줄이 「중단」으로 옮겨 가는가, 다시 열면 되돌아오는가, 방금
 * 발행한 쿠폰이 목록의 맨 뒤에 나타나는가. 얼어붙은 픽스처는 그중 무엇에도 답하지
 * 못하고, 그것으로 검사한 화면은 아무 일도 하지 않으면서 통과한다.
 *
 * 재현하는 것은 **화면이 HTTP 로 관찰할 수 있는 것**뿐이다.
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | 상태는 저장되지 않고 매번 계산된다 | `couponLifecycles` 의 가림 순서 |
 * | 목록이 누구 것인지는 `sellerId` 가 정한다 | 그 구분을 권한이 따라간다 |
 * | 판매자 쿠폰의 범위는 두 가지뿐 | `Coupon_seller_scope_check` + 서비스 |
 * | 중단은 발행만 멈춘다 | `suspendedAt` 하나만 움직인다 |
 * | 코드는 서버가 만든다 | 요청에 코드를 고르는 칸이 없다 |
 *
 * **`defaultHandlers` 에 넣지 않는다.** 같은 `/coupons` 라우트를 관리자 콘솔
 * (TASK-0073)도 쓰고, 기본 목록에서는 먼저 등록된 쪽이 이긴다 — 두 저장소가 한
 * 목록에 섞이면 검사의 실패가 「어느 목이 답했나」에 달리게 된다. 이 화면의 검사는
 * `server.use(...sellerCouponHandlers)` 로 자기 저장소를 앞에 세운다
 * (`seller-claims.ts` 의 첫 줄이 같은 이유를 적어 두었다).
 *
 * **모든 응답이 `defineFixture` 를 지난다** — 계약과 어긋난 본문은 그것을 잘못 그릴
 * 화면이 아니라 여기서 실패한다 (C2).
 *
 * 씨앗과 조립기는 `seller-coupon-contract.ts` 에 있다. 픽스처가 같은 것을 읽어야
 * 하고, 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없기 때문이다.
 */

let rows: CouponListEntry[] = []

/** 다음 쓰기 하나를 실패시킨다 (발행·중단 중 먼저 오는 것). */
let nextFailure: MockApiError | null = null

export function failNextSellerCoupon(error?: MockApiError): void {
  nextFailure = error ?? new MockApiError(409, '지금은 처리할 수 없는 쿠폰입니다.')
}

/** 씨앗에서 저장소를 다시 만든다. `setupTestServer` 의 리셋이 부른다. */
export function resetSellerCouponStore(): void {
  nextFailure = null
  rows = mockSellerCouponSeeds.map((seed: MockSellerCouponSeed) => sellerCouponEntryOf(seed))
}

resetSellerCouponStore()

/** 저장소가 지금 들고 있는 것 — 검사가 「무엇을 했나」를 단언할 수 있게. */
export function sellerCouponSnapshot(): readonly CouponListEntry[] {
  return sortSellerCoupons(rows)
}

/** 다음 쓰기를 실패시켜 두었으면 여기서 터진다. 한 번 쓰고 스스로 꺼진다. */
function refusingOnce(): void {
  if (nextFailure === null) return

  const failure = nextFailure

  nextFailure = null
  throw failure
}

/**
 * 남의 스토어를 들여다봤다 — 403 `FORBIDDEN`.
 *
 * 손으로 만들던 응답이었다. `refusal.ts` 의 상태 표에 403 줄이 없어 `MockApiError`
 * 로 던지면 봉투가 `BAD_REQUEST` 로 나갔고, 그러면 화면이 소유권 거절에 「입력하신
 * 값을 다시 확인해 주세요」라고 답한다 — F6 이 재려는 것과 정반대의 문장이다. 지금은
 * 그 표에 403 이 있으므로 **거절이 어떻게 생겼나에 답하는 자리가 다시 하나**다.
 *
 * 자세한 사정은 `details` 로 간다. 서버도 그렇게 한다(`access-denied.ts` — 봉투의
 * 403 문장은 일반적인 것으로 두고 이유를 `details` 한 줄로 싣는다).
 *
 * `COUPON_SCOPE_FORBIDDEN` 과 **다른 거절**이라는 점이 중요하다. 저것은 「쿠폰은
 * 낼 수 있는데 이 범위로는 안 된다」이고 이것은 「이 목록은 당신 것이 아니다」다.
 */
function forbidden(message: string): never {
  throw new MockApiError(403, message)
}

/* --------------------------------------------------------------------------
 * 커서 — **불투명 문자열**이고, 인코딩이 서버의 것과 같아야 한다
 * ----------------------------------------------------------------------- */

const CURSOR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * 자리를 커서로. base64url 로 감싸는 것은 **클라이언트가 해석하지 못하게** 하기
 * 위해서다 — 목이 날것의 id 를 내보내면 화면은 그것을 읽는 코드를 갖게 되고, 그
 * 코드는 실 서버 앞에서 한 번도 맞지 않는다.
 */
function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

/**
 * 커서가 없으면 `null`, 모양이 아니면 400.
 *
 * 조용히 첫 페이지로 되돌리지 않는다 — 그러면 커서가 깨진 화면이 「1페이지를 무한히
 * 반복」하고, 그 증상은 아무 오류도 내지 않는다.
 */
function cursorOf(value: string | undefined): string | null {
  if (value === undefined) return null

  const decoded = Buffer.from(value, 'base64url').toString('utf8')

  if (!CURSOR_PATTERN.test(decoded)) {
    throw new MockApiError(400, '목록을 이어서 불러올 수 없어요.', {
      code: 'INVALID',
      field: 'cursor',
    })
  }

  return decoded
}

/* --------------------------------------------------------------------------
 * 발행
 * ----------------------------------------------------------------------- */

/**
 * 발행되는 쿠폰의 id 와 코드.
 *
 * 저장소가 이미 들고 있는 줄 수에서 자란다. 무작위로 만들면 검사가 방금 만든 것을
 * 이름으로만 찾을 수 있고, 그러면 「같은 이름을 두 번 발행했을 때」를 영영 구분하지
 * 못한다.
 */
function nextIndex(): number {
  return rows.length + 1
}

function newCouponId(index: number): string {
  return `3c0a0000-0000-4000-8000-${String(900 + index).padStart(12, '0')}`
}

/**
 * 코드는 **서버가 만든다.** 요청에 코드를 고르는 칸이 없는 것이 계약이고
 * (`createCouponRequestSchema.withCode`), 목이 그것을 재현하지 않으면 화면은 있지도
 * 않은 입력을 그리게 된다.
 */
function newCouponCode(index: number): string {
  return Array.from(
    { length: COUPON_CODE_LENGTH },
    (_unused, position) =>
      COUPON_CODE_ALPHABET[(index * 7 + position * 3) % COUPON_CODE_ALPHABET.length] ?? '0',
  ).join('')
}

/**
 * 판매자가 낼 수 있는 범위인가 (TASK-0074 F1).
 *
 * `ALL` 은 남의 매출에까지 자기 부담을 넣는 일이고, `CATEGORY` 는 카테고리가 플랫폼
 * 공용이라 이름만 좁을 뿐 결과가 같다 — 「셔츠 10%」를 낸 판매자가 다른 가게의
 * 셔츠까지 물게 된다. 화면이 그 둘을 아예 내놓지 않는 것은 **친절**이고, 거절되는
 * 것이 **규칙**이다: 화면만 막으면 API 를 직접 부르는 길이 남는다.
 *
 * 가리키는 칸이 둘로 갈린다. 범위의 **종류**가 틀렸으면 `scopeType` 이고, 종류는
 * 맞는데 남의 상품을 골랐으면 `scopeIds` 다 — 발행 화면이 문장을 어느 칸에 붙일지가
 * 여기서 정해진다.
 */
function assertSellerScope(request: { scopeType: string; scopeIds: readonly string[] }): void {
  if (request.scopeType === 'ALL' || request.scopeType === 'CATEGORY') {
    throw new MockApiError(403, '판매자 쿠폰은 내 스토어의 상품에만 적용할 수 있어요.', {
      code: 'COUPON_SCOPE_FORBIDDEN',
      field: 'scopeType',
    })
  }

  if (request.scopeType !== 'PRODUCT') return

  if (request.scopeIds.length === 0 || !request.scopeIds.every(isOwnProductId)) {
    throw new MockApiError(403, '내 스토어의 상품만 지정할 수 있어요.', {
      code: 'COUPON_SCOPE_FORBIDDEN',
      field: 'scopeIds',
    })
  }
}

function couponOf(id: string): CouponListEntry {
  const row = rows.find((entry) => entry.coupon.id === id)

  if (row === undefined) throw new MockApiError(404, '쿠폰을 찾을 수 없어요.')

  return row
}

/**
 * 정책 하나를 갈아 끼운다.
 *
 * **상태는 다시 계산된다** — `sellerCouponEntryOf` 가 `lifecycle` 을 적지 않고
 * 세기 때문이다. 여기서 옛 값을 들고 오면 중단 버튼을 눌러도 줄은 「발행 중」인
 * 채로 남고, 화면은 자기가 아무 일도 하지 않았다고 배운다.
 *
 * 통계는 그대로 옮긴다. 중단은 발행을 멈추는 일이지 **나간 것을 무르는 일이
 * 아니므로**, 사용 장수도 부담 누계도 움직이지 않는다.
 */
function replace(previous: CouponListEntry, coupon: Coupon): CouponListEntry {
  const next = sellerCouponEntryOf({ coupon, stats: previous.stats })

  rows = rows.map((entry) => (entry.coupon.id === coupon.id ? next : entry))

  return next
}

export const sellerCouponHandlers: readonly RequestHandler[] = [
  /**
   * `GET /coupons?sellerId=…` — 이 스토어가 발행한 쿠폰 한 페이지.
   *
   * **`sellerId` 가 어느 목록인지를 정한다.** 이 대역이 아는 스토어는 하나뿐이라,
   * 다른 값이 오면 소유권 거절이고 값이 없으면 플랫폼 목록이라 역시 이 대역의 것이
   * 아니다 (그쪽은 TASK-0073 의 목이 답한다).
   */
  http.get(mockPaths.coupons, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = couponListQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )

      if (query.sellerId !== MOCK_COUPON_SELLER_ID) {
        return forbidden('다른 스토어의 쿠폰은 볼 수 없어요.')
      }

      const limit = query.limit ?? COUPON_LIST_DEFAULT_LIMIT
      const cursor = cursorOf(query.cursor)
      const matches = sortSellerCoupons(rows)
        .filter(
          (entry) => query.lifecycle === undefined || query.lifecycle.includes(entry.lifecycle),
        )
        // 커서는 **자리**다. 「마지막으로 본 줄」을 찾지 않으므로, 그 줄의 상태가 그
        // 사이에 바뀌어도 재개 지점이 함께 움직이지 않는다. 최신순이므로 「본 것보다
        // 작은 id」가 다음이다.
        .filter((entry) => cursor === null || entry.coupon.id < cursor)
      const page = matches.slice(0, limit)
      const last = page.at(-1)

      return HttpResponse.json(
        defineFixture(couponListResponseSchema, {
          coupons: [...page],
          // 누계는 **페이지가 아니라 전부**다. 필터로 좁혀도 같은 수여야 한다.
          totals: sellerCouponTotals(rows),
          nextCursor:
            matches.length > limit && last !== undefined ? encodeCursor(last.coupon.id) : null,
        }),
      )
    }),
  ),

  /**
   * `POST /coupons` — 쿠폰을 발행한다.
   *
   * **`issuerType` 을 받지 않는다.** `sellerId` 가 있으면 판매자 쿠폰이고 없으면
   * 플랫폼 쿠폰이다 — 부담 주체는 파생되는 값이지 고르는 값이 아니고, 계약이 그렇게
   * 생겼다.
   */
  http.post(mockPaths.coupons, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, createCouponRequestSchema)

      refusingOnce()

      if (body.sellerId !== MOCK_COUPON_SELLER_ID) {
        return forbidden('다른 스토어의 쿠폰은 발행할 수 없어요.')
      }

      assertSellerScope(body)

      const index = nextIndex()
      const coupon: Coupon = {
        id: newCouponId(index),
        issuerType: 'SELLER',
        sellerId: body.sellerId,
        name: body.name,
        code: body.withCode ? newCouponCode(index) : null,
        discountType: body.discountType,
        discountValue: body.discountValue,
        // 상한은 정률에만 뜻이 있다. 정액에 실려 오면 **버린다** — 계약이
        // 「정액에서는 언제나 `null`」이라고 못박고 있고, 그대로 저장하면 목록이
        // 계약이 존재할 수 없다고 말한 줄을 보여 준다.
        maxDiscountAmount: body.discountType === 'PERCENT' ? body.maxDiscountAmount : null,
        minOrderAmount: body.minOrderAmount,
        scopeType: body.scopeType,
        scopeIds: [...body.scopeIds],
        validFrom: body.validFrom,
        validUntil: body.validUntil,
        issueLimit: body.issueLimit,
        audience: 'ALL',
        suspendedAt: null,
        issuedCount: 0,
      }

      rows = [
        ...rows,
        sellerCouponEntryOf({
          coupon,
          stats: { usedCount: 0, discountTotal: 0 },
        }),
      ]

      return HttpResponse.json(defineFixture(couponResponseSchema, { coupon }))
    }),
  ),

  /**
   * `PATCH /coupons/:id` — 발행을 멈추거나 다시 연다.
   *
   * **`suspendedAt` 하나만 움직인다.** 이미 발급된 장에는 아무 일도 일어나지 않고
   * (`issuedCount` 도 통계도 그대로다), 그것이 화면이 「이미 받은 분은 그대로 쓸 수
   * 있어요」라고 말할 수 있는 근거다. 무르는 문은 계약에 없다.
   */
  http.patch(mockPaths.coupon, ({ params, request }) =>
    answering(async () => {
      const body = await readBody(request, updateCouponRequestSchema)
      const row = couponOf(String(params.id))

      refusingOnce()

      if (row.coupon.sellerId !== MOCK_COUPON_SELLER_ID) {
        return forbidden('다른 스토어의 쿠폰은 바꿀 수 없어요.')
      }

      const updated = replace(row, {
        ...row.coupon,
        suspendedAt: body.suspended ? MOCK_SELLER_COUPON_NOW : null,
      })

      return HttpResponse.json(defineFixture(couponResponseSchema, { coupon: updated.coupon }))
    }),
  ),
]
