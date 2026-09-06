import type { Coupon, DomainErrorCode, UserCoupon, UserCouponStatus } from '@shopping/shared'
import { COUPON_CODE_PATTERN } from '@shopping/shared'

import { sessionBuyer } from '../fixtures/session'

/**
 * 쿠폰함 대역의 씨앗과 조립기 (TASK-0077).
 *
 * **`fixtures/` 밖에 있는 이유는 픽스처가 아니기 때문이다.** 그 디렉터리는 C2
 * 레지스트리이고 `registry.spec.ts` 가 그 안의 모든 내보내기를 `defineFixture` 로
 * 만든 **응답 하나**여야 한다고 강제한다. 여기 있는 것은 씨앗과 순수 함수라 그 규칙을
 * 지날 수 없는데, 픽스처와 핸들러가 **함께** 읽어야 한다 — `seller-coupon-contract.ts`
 * 가 같은 자리에서 같은 이유를 적어 두었다.
 *
 * 주인을 다시 적지 않고 `sessionBuyer` 에서 가져온다. 쿠폰함은 사람마다 다른 목록이라
 * 세션과 어긋나면 증상이 **소유권 오류**로 나타나고, 그것은 대역의 결함인데 화면의
 * 결함처럼 보인다.
 */

/** 이 쿠폰함의 주인. */
export const MOCK_COUPON_BOX_USER_ID = sessionBuyer.user.id

/**
 * 이 대역의 「지금」.
 *
 * 시계에서 읽지 않는다. 픽스처는 모듈 로드 시점에 한 번 파싱되고 얼어붙으므로 계산된
 * 「지금」은 느린 스펙 파일이 읽을 때 이미 몇 분 전이고, **이 화면이 재는 것 하나가
 * 시간의 함수**다 — 만료 임박(F2)은 `expiresAt` 과 지금 사이가 7일 안인지이므로, 그
 * 몇 분이 경계에 앉은 장의 강조를 뒤집을 수 있다.
 */
export const MOCK_COUPON_BOX_NOW = '2026-09-07T00:00:00.000Z'

/**
 * 한 쪽에 담기는 장수.
 *
 * 실제 기본값(`USER_COUPON_LIST_DEFAULT_LIMIT` 20)보다 작다. 씨앗이 다섯 장이라
 * 20으로 자르면 한 장에 다 들어가고, 그러면 커서가 아무 일도 하지 않는데 검사가
 * 초록이다 — `MOCK_ORDER_PAGE_SIZE` 가 같은 이유로 같은 크기다.
 */
export const MOCK_COUPON_BOX_PAGE_SIZE = 2

/** 결정적 uuid — 앞은 무엇인지, 뒤는 몇 번째인지. */
function userCouponId(suffix: string): string {
  return `019596d0-1f1c-7c2e-9a0e-7a${suffix.padStart(10, '0')}`
}

function couponId(suffix: string): string {
  return `019596d0-1f1c-7c2e-9a0e-7b${suffix.padStart(10, '0')}`
}

/** 주문 하나 — 쓴 장이 가리키는 곳. */
const SPENT_ORDER_ID = '019596d0-1f1c-7c2e-9a0e-7c0000000001'

interface SeedInput {
  /** id 의 꼬리. **내림차순이 곧 최신순**이므로 클수록 최근에 받은 장이다. */
  readonly suffix: string
  readonly name: string
  readonly sellerId?: string | null
  readonly code?: string | null
  readonly discountType: Coupon['discountType']
  readonly discountValue: number
  readonly maxDiscountAmount?: number | null
  readonly minOrderAmount?: number
  readonly scopeType?: Coupon['scopeType']
  readonly status?: UserCouponStatus
  readonly issuedAt: string
  readonly expiresAt: string
  readonly validFrom?: string
  readonly usedAt?: string | null
  readonly orderId?: string | null
  readonly issueLimit?: number | null
  readonly issuedCount?: number
  readonly suspendedAt?: string | null
  readonly audience?: Coupon['audience']
}

/**
 * 발급된 장 하나 — 정책을 **자기 안에** 들고.
 *
 * 계약이 정책을 인라인으로 싣는 이유가 그대로 여기 있다: 쿠폰함의 한 줄은 「가을 쿠폰 ·
 * 3,000원 할인 · 9월 30일까지」이고 앞의 둘이 정책에 있다. 조립기가 둘을 함께 만들지
 * 않으면 대역이 정책 없는 장을 만들 수 있게 되고, 그 장을 그리는 화면은 실제 서버가
 * 절대 보내지 않는 모양에 대비하는 코드를 갖게 된다.
 *
 * **`expiresAt` 이 발급 시점의 `validUntil` 을 베낀 값**이라는 계약도 지킨다. 둘을
 * 따로 받게 두면 목이 「정책은 10월까지인데 이 장은 9월까지」인 행을 아무렇지 않게
 * 만들 수 있고, 그런 장이 있어야 통과하는 화면 코드가 생긴다.
 */
function seed(input: SeedInput): UserCoupon {
  const sellerId = input.sellerId ?? null

  return {
    id: userCouponId(input.suffix),
    couponId: couponId(input.suffix),
    userId: MOCK_COUPON_BOX_USER_ID,
    status: input.status ?? 'ISSUED',
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt,
    usedAt: input.usedAt ?? null,
    orderId: input.orderId ?? null,
    coupon: {
      id: couponId(input.suffix),
      issuerType: sellerId === null ? 'PLATFORM' : 'SELLER',
      sellerId,
      name: input.name,
      code: input.code ?? null,
      discountType: input.discountType,
      discountValue: input.discountValue,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      minOrderAmount: input.minOrderAmount ?? 0,
      scopeType: input.scopeType ?? 'ALL',
      scopeIds: [],
      validFrom: input.validFrom ?? '2026-08-01T00:00:00.000Z',
      validUntil: input.expiresAt,
      issueLimit: input.issueLimit ?? null,
      audience: input.audience ?? 'ALL',
      suspendedAt: input.suspendedAt ?? null,
      issuedCount: input.issuedCount ?? 1,
    },
  }
}

/** `fixtures/checkout-coupons.ts` 의 판매자 하나. 같은 가게를 가리켜야 앞뒤가 맞는다. */
const SELLER_A = '019596d0-1f1c-7c2e-9a0e-5a0000000001'

/**
 * 쿠폰함 다섯 장 — **세 탭이 전부 비지 않도록**.
 *
 * 탭이 셋이고 각 탭에 자기 빈 상태가 있는데, 씨앗이 한 상태에만 있으면 나머지 둘은
 * 언제나 빈 화면이라 「사용함 탭이 쓴 장을 그리는가」를 물어볼 자리가 없다. 그래서
 * `ISSUED` 셋 · `USED` 하나 · `EXPIRED` 하나다.
 *
 * `ISSUED` 가 **셋**인 것은 두 가지를 동시에 만족시키기 위해서다. 하나는 만료 임박
 * (F2) — 7일 안에 사라지는 장과 그렇지 않은 장이 같은 탭에 나란히 있어야 강조가
 * 무엇을 구분하는지 확인할 수 있다. 다른 하나는 커서 — 한 쪽이 두 장이므로
 * (`MOCK_COUPON_BOX_PAGE_SIZE`) 그 탭만 두 쪽이 되고, 「더 보기」가 앞 장을 지우지
 * 않는지를 물을 수 있다.
 */
export const mockCouponBoxSeeds: readonly UserCoupon[] = [
  seed({
    suffix: '5',
    name: '9월 마감 3,000원',
    code: 'Y3TQ8M2K4N',
    discountType: 'FIXED',
    discountValue: 3_000,
    minOrderAmount: 20_000,
    issuedAt: '2026-09-05T02:00:00.000Z',
    // 지금(9월 7일)에서 사흘 뒤. **만료 임박**의 유일한 장이다.
    expiresAt: '2026-09-10T14:59:59.000Z',
  }),
  seed({
    suffix: '4',
    name: '루미에르 10%',
    sellerId: SELLER_A,
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 30_000,
    minOrderAmount: 50_000,
    scopeType: 'SELLER',
    issuedAt: '2026-09-03T05:00:00.000Z',
    expiresAt: '2026-10-31T14:59:59.000Z',
  }),
  seed({
    suffix: '3',
    name: '첫 구매 5,000원',
    code: 'WE1C0MEB2X',
    discountType: 'FIXED',
    discountValue: 5_000,
    minOrderAmount: 30_000,
    issuedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-30T14:59:59.000Z',
    issueLimit: 1_000,
    issuedCount: 421,
  }),
  seed({
    suffix: '2',
    name: '여름 마감 2,000원',
    discountType: 'FIXED',
    discountValue: 2_000,
    status: 'USED',
    issuedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-09-15T14:59:59.000Z',
    usedAt: '2026-08-28T07:12:00.000Z',
    orderId: SPENT_ORDER_ID,
  }),
  seed({
    suffix: '1',
    name: '8월 한정 1,000원',
    discountType: 'FIXED',
    discountValue: 1_000,
    status: 'EXPIRED',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-31T14:59:59.000Z',
  }),
]

/**
 * 씨앗 하나를, **없으면 터지면서** 꺼낸다.
 *
 * `seeds[0] ?? null` 로 적으면 씨앗을 지운 날 검사가 「쿠폰이 null 이다」로 죽고, 진짜
 * 이유인 「그 자리에 씨앗이 없다」가 어디에도 적히지 않는다.
 */
export function mockCouponBoxSeedAt(index: number): UserCoupon {
  const found = mockCouponBoxSeeds[index]

  if (found === undefined) throw new Error(`쿠폰함 씨앗 ${String(index)} 번이 없습니다.`)

  return found
}

/** 최신순 — id 내림차순. 서버가 UUIDv7 을 그렇게 쓴다(`CouponBoxService.list`). */
export function sortUserCoupons(coupons: readonly UserCoupon[]): readonly UserCoupon[] {
  return [...coupons].sort((left, right) => right.id.localeCompare(left.id))
}

/**
 * 상태별 장수 — **`status` 로 좁혀도 달라지지 않는다.**
 *
 * 세 상태가 전부 나가고, 0이어도 키가 있다. 없는 키를 화면이 `?? 0` 으로 메우게 하면
 * 그 `?? 0` 은 「아직 안 왔다」와 「없다」를 같은 것으로 만든다 — 서버가 같은 이유로
 * 같은 모양을 만든다(`CouponBoxService.list`).
 */
export function userCouponCounts(coupons: readonly UserCoupon[]): Record<UserCouponStatus, number> {
  return coupons.reduce<Record<UserCouponStatus, number>>(
    (all, entry) => ({ ...all, [entry.status]: all[entry.status] + 1 }),
    { ISSUED: 0, USED: 0, EXPIRED: 0 },
  )
}

/**
 * 사람이 친 코드를 저장된 모양으로 되돌린다 — `apps/api` 의 `normalizeCouponCode` 와
 * **같은 규칙**이다.
 *
 * 대역이 이것을 흉내 내는 이유는 F3 이 재는 것의 절반이 여기 있기 때문이다: 화면이
 * 「입력이 너그럽다」에 기대어 하이픈과 소문자를 그대로 보내는지를 확인하려면, 목도
 * 그것을 받아 줘야 한다. 목이 대문자 열 글자만 받으면 화면은 스스로 정규화하게 되고,
 * 그 코드는 서버가 이미 하는 일을 두 번째로 하는 규칙이 된다.
 *
 * 구분자 둘만 버린다. 알파벳 밖 글자를 전부 버리면 `WELCOME!!` 같은 입력이 우연히 열
 * 글자가 되어 남의 코드를 가리킬 수 있다.
 */
export function normalizeMockCouponCode(input: string): string | null {
  const confusables: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' }
  let normalized = ''

  for (const char of input.trim().toUpperCase()) {
    if (char === '-' || char === ' ') continue

    normalized += confusables[char] ?? char
  }

  return COUPON_CODE_PATTERN.test(normalized) ? normalized : null
}

/** 코드 하나가 부딪히는 벽. `null` 이면 벽이 없고 발급이 성공한다. */
export interface MockClaimOutcome {
  readonly status: number
  readonly code: DomainErrorCode
  readonly message: string
}

/**
 * 코드마다의 결말 — **일곱 가지 거절을 하나씩**.
 *
 * 거절을 전부 재현하는 이유는 F3 이 「오류 시 사유 표시」이기 때문이다. 화면은 이
 * 일곱에 서로 다른 문장을 붙이는데, 목이 그중 다섯만 만들 수 있으면 나머지 둘의
 * 문장은 아무 검사도 지나지 않은 채 배포된다 — `fixtures/checkout-coupons.ts` 가 여섯
 * 가지 거절 사유를 하나씩 넣어 둔 것과 같은 판단이다.
 *
 * 이 표에 없는 코드는 **모르는 코드**다. 형식이 틀린 것도 같은 답인데, 갈라 답하면
 * 코드를 찍어 보는 쪽에 「형식은 맞다」는 힌트가 되기 때문이다(계약).
 */
export const MOCK_CLAIM_OUTCOMES: Readonly<Record<string, MockClaimOutcome | null>> = {
  /** 받을 수 있는 코드. 이것 하나만 성공한다. */
  NEW9V2K4TR: null,
  /** 이미 쿠폰함에 있는 장의 코드 (`첫 구매 5,000원`). */
  WE1C0MEB2X: {
    status: 409,
    code: 'COUPON_ALREADY_ISSUED',
    message: '이미 받은 쿠폰이에요.',
  },
  S00N4K2M9P: {
    status: 409,
    code: 'COUPON_NOT_STARTED',
    message: '아직 발급 기간이 시작되지 않았어요.',
  },
  PAST5R3T7Q: { status: 409, code: 'COUPON_ENDED', message: '발급 기간이 끝났어요.' },
  G0NE8H4J2V: {
    status: 409,
    code: 'COUPON_ISSUE_EXHAUSTED',
    message: '준비된 수량이 모두 나갔어요.',
  },
  H0PD6N3P5W: { status: 409, code: 'COUPON_SUSPENDED', message: '발행이 중단된 쿠폰이에요.' },
  DEM0Y2K4M8: {
    status: 403,
    code: 'COUPON_DEMO_ONLY',
    message: '체험용 쿠폰이라 체험 계정만 받을 수 있어요.',
  },
}

/**
 * 발급에 성공하는 코드, **사람이 보는 모양으로**.
 *
 * 하이픈이 붙어 있는 것이 요점이다 — 배너에 적히는 모양이 이것이고
 * (`formatCouponCode`), 검사가 이 문자열을 그대로 칠 수 있어야 「입력이 너그럽다」가
 * 실제로 확인된다.
 */
export const MOCK_CLAIMABLE_COUPON_CODE = 'NEW9V-2K4TR'

/**
 * 그 코드가 만들어 주는 장.
 *
 * id 꼬리가 씨앗들보다 크므로 목록 맨 위에 앉는다 — 방금 받은 장이 맨 위라는 계약이
 * 대역에서도 참이어야, 화면이 「받았습니다」를 말한 뒤 그 장을 찾아보는 검사가
 * 성립한다.
 */
export function mockClaimedCoupon(): UserCoupon {
  return seed({
    suffix: 'f',
    name: '신규 가입 감사 10%',
    code: 'NEW9V2K4TR',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 20_000,
    minOrderAmount: 30_000,
    issuedAt: MOCK_COUPON_BOX_NOW,
    expiresAt: '2026-12-31T14:59:59.000Z',
    issueLimit: 5_000,
    issuedCount: 1_204,
  })
}
