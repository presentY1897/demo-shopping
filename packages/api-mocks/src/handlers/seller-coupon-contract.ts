import type { Coupon, CouponLifecycle, CouponListEntry, CouponStats } from '@shopping/shared'
import { couponListEntrySchema, couponSchema, couponStatsSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import { sessionSellerOwner } from '../fixtures/session'
import { productId, sellerProductCatalogue } from './seller-console-catalogue'

/**
 * 판매자 쿠폰 대역의 씨앗과 조립기 (TASK-0074).
 *
 * **`fixtures/` 밖에 있는 이유는 픽스처가 아니기 때문이다.** 그 디렉터리는 C2
 * 레지스트리이고 `registry.spec.ts` 가 그 안의 모든 내보내기를 `defineFixture` 로
 * 만든 **응답 하나**여야 한다고 강제한다. 여기 있는 것은 씨앗과 순수 함수라 그
 * 규칙을 지날 수 없고, 그런데도 픽스처와 핸들러가 **함께** 읽어야 한다 —
 * `seller-claim-contract.ts` 가 같은 자리에서 같은 이유를 적어 두었다.
 *
 * 스토어 id 를 다시 적지 않고 `sessionSellerOwner` 에서 가져온다. 화면이 목록을
 * 부를 때 싣는 `sellerId` 는 세션의 것이고, 여기에 두 번째 상수를 두면 어긋난
 * 순간의 증상이 **소유권 오류(403)** 로 나타난다 — 대역의 결함인데 화면의 결함처럼
 * 보이는 종류다.
 */

/** 이 대역이 답하는 스토어. 없으면 이 모듈의 로드가 실패한다. */
export const MOCK_COUPON_SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

/** 남의 스토어. 소유권 거절(F6)을 재현할 때만 쓴다. */
export const MOCK_OTHER_SELLER_ID = '9f2b0000-0000-4000-8000-000000000099'

/**
 * 이 대역의 「지금」.
 *
 * 시계에서 읽지 않는다. 픽스처는 모듈 로드 시점에 한 번 파싱되고 얼어붙으므로,
 * 계산된 「지금」은 느린 스펙 파일이 읽을 때 이미 몇 분 전이다 — 그리고 이 대역이
 * 답하는 다섯 상태 중 셋이 **시간의 함수**라(`couponLifecycles`), 그 몇 분이
 * 「기간이 끝났다」를 뒤집을 수 있다.
 */
export const MOCK_SELLER_COUPON_NOW = '2026-09-06T03:00:00.000Z'

/** 결정적 uuid — 앞은 무엇인지, 뒤는 몇 번째인지. */
function couponId(index: number): string {
  return `3c0a0000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

/**
 * 지금 어떤 상태인가 — **서버와 같은 순서로** 판정한다.
 *
 * 위엣것이 아래를 가린다는 규칙이 계약(`couponLifecycles`)에 적혀 있고, 여기서
 * 어기면 화면 검사만 통과한다: 중단해 둔 쿠폰이 기간까지 지났을 때 실제 서버는
 * 「종료」라고 답하는데 대역만 「중단」이라고 답하면, 그 차이는 브라우저를 열기
 * 전까지 아무 검사도 잡지 못한다.
 *
 * 시각 비교가 문자열 비교인 것은 씨앗이 전부 같은 모양의 UTC ISO(`…000Z`)이기
 * 때문이다. 형식이 섞이면 성립하지 않으므로 씨앗을 그렇게 고정해 둔다.
 */
export function couponLifecycleOf(
  coupon: Coupon,
  now: string = MOCK_SELLER_COUPON_NOW,
): CouponLifecycle {
  if (coupon.validUntil <= now) return 'ENDED'
  if (coupon.suspendedAt !== null) return 'SUSPENDED'
  if (coupon.validFrom > now) return 'SCHEDULED'
  if (coupon.issueLimit !== null && coupon.issuedCount >= coupon.issueLimit) return 'EXHAUSTED'

  return 'ACTIVE'
}

/** 씨앗 하나 — 정책과, 그 쿠폰이 지금까지 만든 것. */
export interface MockSellerCouponSeed {
  readonly coupon: Coupon
  readonly stats: CouponStats
}

/**
 * 한 줄을 만든다. `lifecycle` 은 **적지 않고 계산한다.**
 *
 * 손으로 적어 두면 중단 버튼을 눌러 `suspendedAt` 이 바뀌어도 줄의 상태가 그대로다.
 * 그 대역으로 검사한 화면은 「눌렀는데 아무 일도 안 일어난다」를 정상으로 배운다.
 */
export function sellerCouponEntryOf(seed: MockSellerCouponSeed): CouponListEntry {
  return defineFixture(couponListEntrySchema, {
    coupon: seed.coupon,
    lifecycle: couponLifecycleOf(seed.coupon),
    stats: seed.stats,
  })
}

interface SeedInput {
  readonly index: number
  readonly name: string
  readonly discountType: Coupon['discountType']
  readonly discountValue: number
  readonly maxDiscountAmount?: number | null
  readonly minOrderAmount?: number
  readonly scopeType: Coupon['scopeType']
  readonly scopeIds?: readonly string[]
  readonly code?: string | null
  readonly validFrom: string
  readonly validUntil: string
  readonly issueLimit: number | null
  readonly issuedCount: number
  readonly suspendedAt?: string | null
  readonly usedCount: number
  readonly discountTotal: number
}

function seed(input: SeedInput): MockSellerCouponSeed {
  return {
    coupon: defineFixture(couponSchema, {
      id: couponId(input.index),
      issuerType: 'SELLER',
      sellerId: MOCK_COUPON_SELLER_ID,
      name: input.name,
      code: input.code ?? null,
      discountType: input.discountType,
      discountValue: input.discountValue,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      minOrderAmount: input.minOrderAmount ?? 0,
      scopeType: input.scopeType,
      scopeIds: [...(input.scopeIds ?? [])],
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      issueLimit: input.issueLimit,
      audience: 'ALL',
      suspendedAt: input.suspendedAt ?? null,
      issuedCount: input.issuedCount,
    }),
    stats: defineFixture(couponStatsSchema, {
      usedCount: input.usedCount,
      discountTotal: input.discountTotal,
    }),
  }
}

/**
 * 여섯 줄, **다섯 상태를 전부 채운다.**
 *
 * 상태마다 하나씩인 것은 화면이 상태별 문장과 배지를 `Record<CouponLifecycle, …>`
 * 로 들고 있기 때문이다 — 하나가 비면 그 상태의 줄은 아무 검사도 지나지 않는다.
 * `ACTIVE` 만 둘인 이유는 **부담 누계의 합**이 한 줄짜리 합이 되지 않게 하기
 * 위해서다(F5): 한 줄이면 「합계」와 「그 줄」을 구분할 수 없다.
 *
 * 금액도 고른 값이다. 정률 쿠폰 하나는 상한이 있고(예상 부담이 계산된다) 하나는
 * 수량이 무제한이라 **상한 없는 쿠폰**이 목록에도 존재한다 — F3 의 「경계가 없는
 * 경우」가 발행 폼에만 있는 개념이 아니라는 것을 목록이 함께 말한다.
 */
export const mockSellerCouponSeeds: readonly MockSellerCouponSeed[] = [
  seed({
    index: 1,
    name: '가을 첫 구매 5,000원',
    discountType: 'FIXED',
    discountValue: 5_000,
    minOrderAmount: 30_000,
    scopeType: 'SELLER',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T14:59:59.000Z',
    issueLimit: 100,
    issuedCount: 37,
    usedCount: 12,
    discountTotal: 58_000,
  }),
  seed({
    index: 2,
    name: '코튼 티셔츠 10%',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 3_000,
    scopeType: 'PRODUCT',
    scopeIds: [productId(0), productId(1)],
    code: 'K7M2QX9RTV',
    validFrom: '2026-09-03T00:00:00.000Z',
    validUntil: '2026-10-31T14:59:59.000Z',
    // 수량 무제한. 목록에도 「상한 없음」인 쿠폰이 하나 있어야 한다 (F3).
    issueLimit: null,
    issuedCount: 5,
    usedCount: 2,
    discountTotal: 4_500,
  }),
  seed({
    index: 3,
    name: '추석 스토어 3,000원',
    discountType: 'FIXED',
    discountValue: 3_000,
    scopeType: 'SELLER',
    validFrom: '2026-09-20T00:00:00.000Z',
    validUntil: '2026-10-10T14:59:59.000Z',
    issueLimit: 300,
    issuedCount: 0,
    usedCount: 0,
    discountTotal: 0,
  }),
  seed({
    index: 4,
    name: '한정 수량 10,000원',
    discountType: 'FIXED',
    discountValue: 10_000,
    minOrderAmount: 50_000,
    scopeType: 'SELLER',
    validFrom: '2026-08-20T00:00:00.000Z',
    validUntil: '2026-09-25T14:59:59.000Z',
    issueLimit: 50,
    issuedCount: 50,
    usedCount: 44,
    discountTotal: 132_000,
  }),
  seed({
    index: 5,
    name: '주말 한정 2,000원',
    discountType: 'FIXED',
    discountValue: 2_000,
    scopeType: 'SELLER',
    validFrom: '2026-09-02T00:00:00.000Z',
    validUntil: '2026-09-28T14:59:59.000Z',
    issueLimit: 200,
    issuedCount: 18,
    suspendedAt: '2026-09-05T06:30:00.000Z',
    usedCount: 9,
    discountTotal: 27_000,
  }),
  seed({
    index: 6,
    name: '여름 마감 15%',
    discountType: 'PERCENT',
    discountValue: 15,
    maxDiscountAmount: 8_000,
    scopeType: 'SELLER',
    validFrom: '2026-08-01T00:00:00.000Z',
    validUntil: '2026-08-31T14:59:59.000Z',
    issueLimit: 500,
    issuedCount: 80,
    usedCount: 61,
    discountTotal: 305_000,
  }),
]

/**
 * 씨앗 하나를, **없으면 터지면서** 꺼낸다.
 *
 * `seeds[0]?.coupon ?? null` 로 적으면 씨앗을 지운 날 픽스처가 `null` 을 스키마에
 * 넣어 파싱에서 죽고, 실패 메시지는 「쿠폰이 null 이다」가 된다 — 진짜 이유인 「그
 * 자리에 씨앗이 없다」가 어디에도 적히지 않는다.
 */
export function mockSellerCouponSeedAt(index: number): MockSellerCouponSeed {
  const seed = mockSellerCouponSeeds[index]

  if (seed === undefined) throw new Error(`쿠폰 씨앗 ${String(index)} 번이 없습니다.`)

  return seed
}

/**
 * 씨앗을 목록의 순서로 — **최신순** (id 내림차순).
 *
 * 계약이 정렬을 말하지 않던 동안 이 대역은 오름차순을 골랐고 서버는 내림차순이었다.
 * 두 검사 모두 초록인 채로 갈려 있었다 — **계약이 말하지 않은 것은 대역이 정하게
 * 된다.** 지금은 `couponListResponseSchema` 가 최신순이라고 적고 있고, 축이 id 인
 * 것은 그것이 UUIDv7 이라 시간순이기 때문이다.
 */
export function sortSellerCoupons(entries: readonly CouponListEntry[]): readonly CouponListEntry[] {
  return [...entries].sort((left, right) => right.coupon.id.localeCompare(left.coupon.id))
}

/**
 * 이 스토어의 쿠폰이 지금까지 만든 것 — **페이지가 아니라 전부**.
 *
 * 필터로 좁혀도, 다음 장으로 넘겨도 같은 수여야 한다. 서버가 페이지와 무관한 집계로
 * 답하므로(`CouponConsoleService.totalsOf`) 대역도 전부를 센다.
 */
export function sellerCouponTotals(entries: readonly CouponListEntry[]): CouponStats {
  return entries.reduce(
    (sum, entry) => ({
      usedCount: sum.usedCount + entry.stats.usedCount,
      discountTotal: sum.discountTotal + entry.stats.discountTotal,
    }),
    { usedCount: 0, discountTotal: 0 },
  )
}

/**
 * 이 스토어가 실제로 가진 상품인가. 범위 거절(F1)의 판정이 이것 하나다.
 *
 * 카탈로그를 그대로 본다. 개수를 손으로 적으면 `SELLER_PRODUCT_COUNT` 가 늘어난 날
 * **실재하는 상품이 남의 것으로 거절된다** — 그리고 그 증상은 화면 쪽 버그로 읽힌다.
 */
export function isOwnProductId(value: string): boolean {
  return sellerProductCatalogue.some((product) => product.id === value)
}
