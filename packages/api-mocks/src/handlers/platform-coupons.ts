import type {
  BulkIssueTarget,
  Coupon,
  CouponLifecycle,
  CouponListEntry,
  CouponStats,
  Role,
} from '@shopping/shared'
import {
  BULK_ISSUE_MAX_RECIPIENTS,
  bulkIssueRequestSchema,
  bulkIssueResponseSchema,
  bulkIssueTargets,
  COUPON_LIST_DEFAULT_LIMIT,
  couponListQueryParamsSchema,
  couponListResponseSchema,
  couponResponseSchema,
  createCouponRequestSchema,
  grantedScopes,
  scopeAdmits,
  updateCouponRequestSchema,
} from '@shopping/shared'
import type { PathParams, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import { errorResponse, MockApiError, readBody } from './refusal'
import { mockSession } from './session'

/**
 * 플랫폼 부담 쿠폰의 발행자 콘솔 (TASK-0073), 화면이 관찰할 수 있는 만큼.
 *
 * **상태를 갖는다.** 이 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다 — 발행을
 * 멈추면 그 줄이 「중단」으로 바뀌는가, 다시 열면 되돌아오는가, 한꺼번에 지급하면
 * 발급 수가 늘고 남은 수량이 줄어드는가, 두 번 눌러도 같은 사람에게 두 장이 가지
 * 않는가. 얼어붙은 픽스처는 그중 무엇에도 답하지 못하고, 그것으로 검사한 화면은 틀린
 * 일을 하면서 통과한다.
 *
 * 재현하는 것은 **실 API 가 지키는 성질**뿐이다.
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | 상태는 저장되지 않고 계산된다 | `couponLifecycleOf` — 다섯 갈래의 순서까지 같다 |
 * | 중단은 「더 나가지 않게」다 | `suspendedAt` 만 움직이고 발급된 장은 건드리지 않는다 |
 * | 일괄 지급은 상한에서 멈춘다 | `take: BULK_ISSUE_MAX_RECIPIENTS + 1` 로 「남았는가」를 읽는다 |
 * | 이미 가진 사람은 대상이 아니다 | 대상 조회의 `userCoupons: { none: … }` |
 * | 끝난 쿠폰에는 지급하지 않는다 | `bulkIssue` 의 첫 줄, 403 `COUPON_ENDED` |
 * | 남의 쿠폰은 만지지 못한다 | `assertResourceAccess(principal, 'coupon.platform', …)` |
 *
 * **`sellerId` 가 실린 요청에는 답하지 않는다.** 같은 라우트가 판매자 쿠폰
 * 콘솔(TASK-0074)의 문이기도 하고, 어느 목록인지를 정하는 것은 그 값 하나다. 여기서
 * 빈 목록으로 답해 버리면 판매자 대역이 등록 순서에 따라 조용히 가려지므로,
 * **아무것도 반환하지 않아** msw 가 다음 핸들러로 넘기게 둔다.
 *
 * **모든 응답이 `defineFixture` 를 지난다** — 계약과 어긋난 본문은 그것을 잘못 그릴
 * 화면이 아니라 여기서 실패한다 (C2).
 */

/**
 * 대역이 말하는 「지금」. 2026-09-06 정오(한국 시간)다.
 *
 * 고정값인 이유는 상태 다섯 가지가 **전부 시간의 함수**이기 때문이다. `Date.now()` 로
 * 씨앗을 지으면 「아직 시작 전」인 쿠폰이 내일이면 「진행 중」이 되고, 그날 검사가
 * 깨진다. 씨앗의 기간이 이 값을 기준으로 앞뒤에 놓인다.
 */
export const MOCK_PLATFORM_COUPON_NOW = '2026-09-06T03:00:00.000Z'

/**
 * 씨앗의 id — 목록이 **내림차순**이므로 뒤 글자가 큰 것이 앞에 온다.
 *
 * 검사가 「어떤 줄」을 가리킬 때 쓰는 이름이다. 이름으로 찾으면 문구가 바뀔 때마다
 * 검사가 함께 깨지고, 그 문구는 이 파일의 것이 아니다.
 */
export const MOCK_PLATFORM_COUPON_IDS = {
  /** 진행 중인 정률 쿠폰. 상한이 있어 예상 비용이 계산되는 쪽이다. */
  active: '019598a0-0001-7000-8000-00000000000f',
  /** 진행 중인 정액 쿠폰. 수량이 무제한이라 일괄 지급이 상한에서 멈춘다. */
  unlimited: '019598a0-0001-7000-8000-00000000000e',
  /** 아직 시작 전. 기다리면 되는 상태다. */
  scheduled: '019598a0-0001-7000-8000-00000000000d',
  /** 발행자가 멈춘 쿠폰. 다시 열 수 있다. */
  suspended: '019598a0-0001-7000-8000-00000000000c',
  /** 준비된 수량이 다 나갔다. */
  exhausted: '019598a0-0001-7000-8000-00000000000b',
  /** 기간이 끝났다. 무엇을 해도 되돌릴 수 없다. */
  ended: '019598a0-0001-7000-8000-00000000000a',
  /** 방문자의 관리자가 낸 체험용 쿠폰. 실계정 관리자의 목록에도 보인다. */
  demo: '019598a0-0001-7000-8000-000000000009',
} as const

/** 실계정 관리자가 낸 쿠폰의 주인. 아무도 로그인하지 않았을 때의 발행자이기도 하다. */
const MOCK_ISSUER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0003'

/** 방문자의 관리자가 낸 쿠폰의 주인. 실계정 관리자가 닿을 수 없는 행을 만든다. */
const MOCK_DEMO_ISSUER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0009'

/**
 * 한 줄이 들고 있는 것 — 계약의 쿠폰과 현황, 그리고 **계약에 없는 두 가지**.
 *
 * `ownerIsDemo` 는 인가 판정이 읽는 값이고 응답에는 실리지 않는다(`audience` 가
 * 화면이 보는 그림자다). `pool` 은 「아직 이 쿠폰을 갖지 않은 회원 수」로, 실 서버가
 * 회원 표를 조회해 얻는 것을 대역이 세어 두는 자리다.
 */
interface CouponRecord {
  coupon: Coupon
  stats: CouponStats
  readonly ownerUserId: string
  readonly ownerIsDemo: boolean
  pool: Record<BulkIssueTarget, number>
  /**
   * 조건에는 맞지만 **이미 이 쿠폰을 가진** 사람 수 — 실 서버가 세는 `skipped` 다.
   *
   * 대역은 씨앗의 발급분이 누구에게 갔는지 모르므로 **이 대역 안에서 나간 사람만**
   * 센다. 세 조건이 함께 늘어나는 것은 근사다: 전체에게 지급하면 그중 일부는
   * 「주문한 적 있는」 사람이기도 하다. 정확한 교집합을 흉내 내려면 대역이 회원
   * 표를 갖게 되고, 그러면 이것은 대역이 아니라 **두 번째 구현**이 된다.
   */
  held: Record<BulkIssueTarget, number>
}

interface Seed {
  readonly id: string
  readonly name: string
  readonly code: string | null
  readonly discountType: Coupon['discountType']
  readonly discountValue: number
  readonly maxDiscountAmount: number | null
  readonly minOrderAmount: number
  readonly scopeType: Coupon['scopeType']
  readonly scopeIds: readonly string[]
  readonly validFrom: string
  readonly validUntil: string
  readonly issueLimit: number | null
  readonly issuedCount: number
  readonly suspendedAt: string | null
  readonly audience: Coupon['audience']
  readonly usedCount: number
  readonly discountTotal: number
  readonly pool: Record<BulkIssueTarget, number>
}

/**
 * 일곱 줄 — **상태 다섯 가지가 전부 한 번씩 나온다.**
 *
 * 필터가 무엇을 걸러 내는지 검사하려면 걸릴 것이 있어야 하고, 「체험용」 뱃지를
 * 검사하려면 실계정이 낸 줄과 방문자가 낸 줄이 **한 목록에 섞여** 있어야 한다.
 */
const SEEDS: readonly Seed[] = [
  {
    id: MOCK_PLATFORM_COUPON_IDS.active,
    name: '가을맞이 10% 할인',
    code: 'H4ZK92MNPQ',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 5000,
    minOrderAmount: 30_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    issueLimit: 1000,
    issuedCount: 240,
    suspendedAt: null,
    audience: 'ALL',
    usedCount: 120,
    discountTotal: 480_000,
    pool: { ALL: 760, HAS_ORDERED: 300, NEVER_ORDERED: 460 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.unlimited,
    name: '첫 구매 3,000원',
    code: null,
    discountType: 'FIXED',
    discountValue: 3000,
    maxDiscountAmount: null,
    minOrderAmount: 20_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-08-01T00:00:00.000Z',
    validUntil: '2026-12-31T00:00:00.000Z',
    // 무제한. 일괄 지급이 **수량이 아니라 한 번의 상한**에서 멈추는 쪽이다.
    issueLimit: null,
    issuedCount: 12_400,
    suspendedAt: null,
    audience: 'ALL',
    usedCount: 8000,
    discountTotal: 24_000_000,
    pool: { ALL: 1200, HAS_ORDERED: 400, NEVER_ORDERED: 800 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.scheduled,
    name: '추석 감사 5,000원',
    code: 'K3M7QRSTVW',
    discountType: 'FIXED',
    discountValue: 5000,
    maxDiscountAmount: null,
    minOrderAmount: 50_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-09-20T00:00:00.000Z',
    validUntil: '2026-10-05T00:00:00.000Z',
    issueLimit: 500,
    issuedCount: 0,
    suspendedAt: null,
    audience: 'ALL',
    usedCount: 0,
    discountTotal: 0,
    pool: { ALL: 500, HAS_ORDERED: 200, NEVER_ORDERED: 300 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.suspended,
    name: '주말 특가 15%',
    code: null,
    discountType: 'PERCENT',
    discountValue: 15,
    maxDiscountAmount: 10_000,
    minOrderAmount: 0,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    issueLimit: 2000,
    issuedCount: 640,
    suspendedAt: '2026-09-05T02:00:00.000Z',
    audience: 'ALL',
    usedCount: 300,
    discountTotal: 2_100_000,
    pool: { ALL: 900, HAS_ORDERED: 400, NEVER_ORDERED: 500 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.exhausted,
    name: '선착순 2,000원',
    code: 'N8PQ4RSTVW',
    discountType: 'FIXED',
    discountValue: 2000,
    maxDiscountAmount: null,
    minOrderAmount: 10_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    issueLimit: 500,
    issuedCount: 500,
    suspendedAt: null,
    audience: 'ALL',
    usedCount: 410,
    discountTotal: 820_000,
    pool: { ALL: 700, HAS_ORDERED: 300, NEVER_ORDERED: 400 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.ended,
    name: '여름 정리 20%',
    code: null,
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscountAmount: 20_000,
    minOrderAmount: 40_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-07-01T00:00:00.000Z',
    validUntil: '2026-08-31T00:00:00.000Z',
    issueLimit: 3000,
    issuedCount: 2800,
    suspendedAt: null,
    audience: 'ALL',
    usedCount: 1900,
    discountTotal: 18_000_000,
    pool: { ALL: 400, HAS_ORDERED: 200, NEVER_ORDERED: 200 },
  },
  {
    id: MOCK_PLATFORM_COUPON_IDS.demo,
    name: '체험 계정 환영 1,000원',
    code: null,
    discountType: 'FIXED',
    discountValue: 1000,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    issueLimit: 100,
    issuedCount: 12,
    suspendedAt: null,
    // 방문자의 관리자가 낸 쿠폰. 체험 계정에게만 발급된다 (D-224).
    audience: 'DEMO',
    usedCount: 4,
    discountTotal: 4000,
    // 「주문한 적 있는 회원」이 0이다. 체험 계정은 대개 둘러보다 사라지고, 그 0이
    // **아무도 대상이 아닌 경우**를 만들어 낸다 — 「모두 이미 갖고 있다」와 다른
    // 사건이라 화면이 두 문장을 갖는다.
    pool: { ALL: 30, HAS_ORDERED: 0, NEVER_ORDERED: 30 },
  },
]

function recordOf(seed: Seed): CouponRecord {
  const demo = seed.audience === 'DEMO'

  return {
    coupon: {
      id: seed.id,
      issuerType: 'PLATFORM',
      // 플랫폼 쿠폰에는 소유하는 스토어가 없다. 그것이 곧 `issuerType` 이다.
      sellerId: null,
      name: seed.name,
      code: seed.code,
      discountType: seed.discountType,
      discountValue: seed.discountValue,
      maxDiscountAmount: seed.maxDiscountAmount,
      minOrderAmount: seed.minOrderAmount,
      scopeType: seed.scopeType,
      scopeIds: [...seed.scopeIds],
      validFrom: seed.validFrom,
      validUntil: seed.validUntil,
      issueLimit: seed.issueLimit,
      audience: seed.audience,
      suspendedAt: seed.suspendedAt,
      issuedCount: seed.issuedCount,
    },
    stats: { usedCount: seed.usedCount, discountTotal: seed.discountTotal },
    ownerUserId: demo ? MOCK_DEMO_ISSUER_ID : MOCK_ISSUER_ID,
    ownerIsDemo: demo,
    pool: { ...seed.pool },
    held: { ALL: 0, HAS_ORDERED: 0, NEVER_ORDERED: 0 },
  }
}

let store: CouponRecord[] = SEEDS.map(recordOf)

/** 다음 쓰기 하나를 실패시킨다 (발행·중단·일괄 지급 중 먼저 오는 것). */
let nextFailure: MockApiError | null = null

export function failNextPlatformCoupon(error?: MockApiError): void {
  nextFailure = error ?? new MockApiError(500, '쿠폰을 처리하지 못했습니다.')
}

export function resetPlatformCouponStore(): void {
  store = SEEDS.map(recordOf)
  nextFailure = null
}

/**
 * 아무 쿠폰도 발행되지 않은 세상.
 *
 * 「아직 발행한 쿠폰이 없어요」는 씨앗을 지우지 않고서는 만들 수 없는 상태다 — 씨앗
 * 일곱 줄이 다섯 상태를 덮고 있어 어떤 필터로도 목록이 비지 않는다. 빈 상태를 그리는
 * 코드가 아무 검사도 지나지 않는 것보다, 그것을 만들 수 있는 문 하나가 낫다
 * (게이트 P5 · U1).
 */
export function emptyPlatformCouponStore(): void {
  store = []
  nextFailure = null
}

/** 심어 둔 줄을 목록의 순서 그대로. 검사가 「무엇이 있어야 하나」를 물을 때 쓴다. */
export function platformCouponSnapshot(): readonly CouponListEntry[] {
  return sorted().map(entryOf)
}

function consumeFailure(): void {
  const failure = nextFailure

  nextFailure = null

  if (failure !== null) throw failure
}

/**
 * `answering` 과 같은 일을 하되, **답하지 않는 것**을 허락한다.
 *
 * `handlers/refusal.ts` 의 것은 언제나 `Response` 를 돌려주는데, 이 대역에는 답을
 * 내지 않고 다음 핸들러로 넘겨야 하는 갈래가 둘 있다(판매자 쿠폰). msw 는
 * `undefined` 를 「이 핸들러가 처리하지 않았다」로 읽으므로, 그 값이 지나갈 수 있는
 * 통로가 필요하다 — 거절을 봉투로 바꾸는 규약은 그대로다.
 */
function answering(work: () => Promise<Response | undefined>): Promise<Response | undefined> {
  return work().catch((error: unknown) => {
    if (error instanceof MockApiError) return errorResponse(error)
    throw error
  })
}

/**
 * 최신순 — id 하나가 정렬이자 커서다.
 *
 * uuidv7 이 시간순이라 「최신순」과 「id 내림차순」이 같은 말이고, 그래서 커서가 한
 * 칸이면 된다 (`AdminClaimService` 의 목록과 같은 규약).
 */
function sorted(): readonly CouponRecord[] {
  return [...store].sort((a, b) => (a.coupon.id < b.coupon.id ? 1 : -1))
}

const NOW = new Date(MOCK_PLATFORM_COUPON_NOW)

/**
 * 이 쿠폰이 지금 어떤 상태인가 — `coupon-console.ts` 의 `couponLifecycleOf` 그대로다.
 *
 * **순서까지 같아야 한다.** 끝난 쿠폰은 중단됐든 소진됐든 끝난 것이고, 대역이 그
 * 순서를 다르게 두면 화면은 실 서버가 절대 보내지 않는 조합을 그리면서 통과한다.
 */
function lifecycleOf(coupon: Coupon): CouponLifecycle {
  if (NOW.getTime() >= new Date(coupon.validUntil).getTime()) return 'ENDED'
  if (coupon.suspendedAt !== null) return 'SUSPENDED'
  if (NOW.getTime() < new Date(coupon.validFrom).getTime()) return 'SCHEDULED'
  if (coupon.issueLimit !== null && coupon.issuedCount >= coupon.issueLimit) return 'EXHAUSTED'

  return 'ACTIVE'
}

/** 한 순간이 경계 안에 있는가. 양쪽 다 **포함**이다 — 서버의 `gte`·`lte` 와 같다. */
function within(instant: string, from: string | undefined, to: string | undefined): boolean {
  const at = new Date(instant).getTime()

  if (from !== undefined && at < new Date(from).getTime()) return false

  return to === undefined || at <= new Date(to).getTime()
}

function entryOf(record: CouponRecord): CouponListEntry {
  return {
    coupon: record.coupon,
    lifecycle: lifecycleOf(record.coupon),
    stats: record.stats,
  }
}

/**
 * 부르는 사람 — 로그인한 계정, 아무도 없으면 실계정 관리자.
 *
 * **역할에서 「체험 계정인가」를 읽는다.** 세션에는 그 칸이 없고(`AuthorizationSubject`
 * 가 일부러 갖지 않는 값이다) 실 서버는 계정 행에서 읽는데, 대역에는 계정 표가 없다.
 * `DEMO_ADMIN` 을 가진 세션이 곧 방문자의 관리자라는 사실이 그 자리를 메운다.
 */
function principal(): { userId: string; roles: readonly Role[]; isDemo: boolean } {
  const session = mockSession()

  if (session === null) return { userId: MOCK_ISSUER_ID, roles: ['ADMIN_SUPER'], isDemo: false }

  return {
    userId: session.user.id,
    roles: session.user.roles,
    isDemo: session.user.roles.includes('DEMO_ADMIN'),
  }
}

/**
 * 이 사람이 이 소유권에 대해 플랫폼 쿠폰을 다룰 수 있는가.
 *
 * **판정 함수가 실 서버의 것과 같다** (`assertResourceAccess` 가 부르는 것과 같은
 * `grantedScopes`·`scopeAdmits`). 여기에 역할 이름으로 쓴 `if` 를 두면 대역이 자기
 * 나름의 권한 표를 갖게 되고, 그것이 실제 표와 갈리는 날 화면은 대역 위에서만
 * 동작한다.
 */
function assertMayManage(owner: { ownerUserId: string; ownerIsDemo: boolean }): void {
  const caller = principal()
  const subject = { userId: caller.userId, roles: caller.roles, sellerId: null }
  const resource = {
    ownerUserId: owner.ownerUserId,
    ownerSellerId: null,
    ownerIsDemo: owner.ownerIsDemo,
  }
  const scopes = grantedScopes(subject, 'coupon.platform')

  if (scopes.length === 0) {
    throw new MockApiError(403, '플랫폼 부담 쿠폰을 발행할 권한이 없어요.')
  }

  if (!scopes.some((scope) => scopeAdmits(scope, subject, resource))) {
    throw new MockApiError(403, '이 쿠폰을 다룰 수 있는 권한이 없어요.')
  }
}

function pathIdOf(params: PathParams): string {
  const raw = params.id

  return String(Array.isArray(raw) ? raw[0] : raw)
}

function recordOr404(couponId: string): CouponRecord {
  const record = store.find((entry) => entry.coupon.id === couponId)

  if (record === undefined) throw new MockApiError(404, '쿠폰을 찾을 수 없어요.')

  return record
}

/**
 * 발행된 쿠폰의 코드. 실 서버와 같이 **서버가 만든다** — 발행자는 고르지 않는다.
 *
 * 글자가 `M0CK` 인 것은 농담이 아니라 제약이다. 코드는 Crockford base32 라
 * `I` · `L` · `O` · `U` 가 없고(`COUPON_CODE_ALPHABET`), `MOCK` 은 그 규칙을 어겨
 * `couponCodeSchema` 에서 거절된다 — 대역이 계약을 지나지 못하는 값을 만들면 그것을
 * 잘못 그릴 화면이 아니라 여기서 실패한다 (C2).
 */
function generatedCode(index: number): string {
  return `M0CK${String(index).padStart(6, '0')}`
}

export const platformCouponHandlers: readonly RequestHandler[] = [
  /**
   * 일괄 지급. **`coupon` 보다 먼저 등록한다.**
   *
   * msw 는 먼저 맞는 것을 쓰고 `:id` 는 `/` 를 넘지 못하므로 지금은 순서가 답을 바꾸지
   * 않지만, 이 저장소의 모든 라우트 목록이 좁은 것을 앞에 둔다.
   */
  http.post(mockPaths.couponBulkIssues, ({ params, request }) =>
    answering(async () => {
      const record = recordOr404(pathIdOf(params))
      const body = await readBody(request, bulkIssueRequestSchema)

      consumeFailure()
      assertMayManage(record)

      const lifecycle = lifecycleOf(record.coupon)

      // 순서가 실 서버와 같아야 한다 (`CouponConsoleService.bulkIssue`). 끝난 쿠폰이
      // 중단되어 있어도 그것은 **끝난** 것이고, 두 거절에 발행자가 할 일이 다르다 —
      // 앞은 새로 내는 일이고 뒤는 재개하면 되는 일이다.
      if (lifecycle === 'ENDED') {
        throw new MockApiError(403, '기간이 끝난 쿠폰은 지급할 수 없어요.', {
          code: 'COUPON_ENDED',
        })
      }

      // 멈춘 쿠폰은 한꺼번에도 나가지 않는다. 중단의 뜻이 「더 나가지 않게」이므로
      // 한 장씩 막고 한꺼번에는 열어 두면 그 뜻이 문마다 달라진다.
      if (lifecycle === 'SUSPENDED') {
        throw new MockApiError(403, '발행이 중단된 쿠폰은 지급할 수 없어요.', {
          code: 'COUPON_SUSPENDED',
        })
      }

      // 상한보다 한 명 더 읽어 「남았는가」에 답한다 (`recipientsOf` 의 `take`).
      const recipients = Math.min(record.pool[body.target], BULK_ISSUE_MAX_RECIPIENTS + 1)
      const room =
        record.coupon.issueLimit === null
          ? recipients
          : Math.max(0, record.coupon.issueLimit - record.coupon.issuedCount)
      const issued = Math.min(room, recipients, BULK_ISSUE_MAX_RECIPIENTS)

      // 「이미 가진 사람」은 **대상에서 빠지지만 세기는 한다.** 나간 사람은 어느
      // 조건으로 세든 이제 그쪽이므로, 세 칸이 함께 줄고 함께 는다 — 그것이 두 번
      // 눌러도 두 장이 되지 않는 이유이자, 두 번째 누름이 「모두 이미 갖고 있다」로
      // 답하는 이유다.
      const skipped = record.held[body.target]

      record.coupon = { ...record.coupon, issuedCount: record.coupon.issuedCount + issued }

      for (const target of bulkIssueTargets) {
        record.pool[target] = Math.max(0, record.pool[target] - issued)
        record.held[target] += issued
      }

      return HttpResponse.json(
        defineFixture(bulkIssueResponseSchema, { issued, skipped, remaining: recipients - issued }),
      )
    }),
  ),

  /** 발행 중단과 재개. 바꿀 수 있는 것이 이것 하나뿐이다. */
  http.patch(mockPaths.coupon, ({ params, request }) =>
    answering(async () => {
      const record = recordOr404(pathIdOf(params))
      const body = await readBody(request, updateCouponRequestSchema)

      consumeFailure()
      assertMayManage(record)

      record.coupon = {
        ...record.coupon,
        // 발급된 장에는 아무 일도 일어나지 않는다 — `issuedCount` 도 현황도 그대로다.
        suspendedAt: body.suspended ? MOCK_PLATFORM_COUPON_NOW : null,
      }

      return HttpResponse.json(defineFixture(couponResponseSchema, { coupon: record.coupon }))
    }),
  ),

  http.post(mockPaths.coupons, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, createCouponRequestSchema)

      // 판매자 쿠폰은 이 대역의 것이 아니다. 답하지 않으면 msw 가 다음 핸들러를 찾는다.
      if (body.sellerId !== null) return undefined

      consumeFailure()

      const caller = principal()

      assertMayManage({ ownerUserId: caller.userId, ownerIsDemo: caller.isDemo })

      const coupon: Coupon = {
        id: `019598a0-0002-7000-8000-${String(store.length).padStart(12, '0')}`,
        issuerType: 'PLATFORM',
        sellerId: null,
        name: body.name,
        code: body.withCode ? generatedCode(store.length) : null,
        discountType: body.discountType,
        discountValue: body.discountValue,
        maxDiscountAmount: body.maxDiscountAmount,
        minOrderAmount: body.minOrderAmount,
        scopeType: body.scopeType,
        scopeIds: [...body.scopeIds],
        validFrom: body.validFrom,
        validUntil: body.validUntil,
        issueLimit: body.issueLimit,
        // 만든 사람이 체험 계정이면 체험 그룹의 쿠폰이다. 발행 시점에 정해지고 그 뒤로
        // 바뀌지 않는다 (D-224).
        audience: caller.isDemo ? 'DEMO' : 'ALL',
        suspendedAt: null,
        issuedCount: 0,
      }

      store = [
        {
          coupon,
          stats: { usedCount: 0, discountTotal: 0 },
          ownerUserId: caller.userId,
          ownerIsDemo: caller.isDemo,
          pool: { ALL: 1000, HAS_ORDERED: 400, NEVER_ORDERED: 600 },
          held: { ALL: 0, HAS_ORDERED: 0, NEVER_ORDERED: 0 },
        },
        ...store,
      ]

      return HttpResponse.json(defineFixture(couponResponseSchema, { coupon }), { status: 201 })
    }),
  ),

  http.get(mockPaths.coupons, ({ request }) =>
    answering(async () => {
      await Promise.resolve()

      const url = new URL(request.url)
      const parsed = couponListQueryParamsSchema.safeParse(
        Object.fromEntries(url.searchParams.entries()),
      )

      if (!parsed.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

      const query = parsed.data

      // 스토어의 목록은 판매자 콘솔의 것이다 — 위 `POST` 와 같은 이유로 넘긴다.
      if (query.sellerId !== undefined) return undefined

      const limit = query.limit ?? COUPON_LIST_DEFAULT_LIMIT
      const matched = sorted()
        .map(entryOf)
        .filter((entry) => {
          if (query.lifecycle !== undefined && !query.lifecycle.includes(entry.lifecycle)) {
            return false
          }
          // 유효기간이 **겹치는가** — 시작일이 그 사이인가가 아니다. 8월에 시작해
          // 9월까지 가는 쿠폰은 「9월」을 찾는 사람이 찾는 그 쿠폰이고, 시작일로
          // 거르면 목록에서 사라진다 (`periodFilter` 와 같은 판정, 경계 포함).
          if (query.to !== undefined && !within(entry.coupon.validFrom, undefined, query.to)) {
            return false
          }
          if (query.from !== undefined && !within(entry.coupon.validUntil, query.from, undefined)) {
            return false
          }
          // 커서는 **자리**이지 행이 아니다. 최신순이므로 「본 것보다 작은 id」가 다음이다.
          if (query.cursor !== undefined && entry.coupon.id >= query.cursor) return false

          return true
        })
      const page = matched.slice(0, limit)

      return HttpResponse.json(
        defineFixture(couponListResponseSchema, {
          coupons: page,
          // 누계는 **페이지가 아니라 전부**다. 서버가 페이지와 무관한 집계로 답하므로
          // (`CouponConsoleService.totalsOf`) 대역도 걸러 낸 줄까지 함께 센다.
          totals: sorted()
            .map(entryOf)
            .reduce(
              (sum, entry) => ({
                usedCount: sum.usedCount + entry.stats.usedCount,
                discountTotal: sum.discountTotal + entry.stats.discountTotal,
              }),
              { usedCount: 0, discountTotal: 0 },
            ),
          nextCursor: matched.length > limit ? (page.at(-1)?.coupon.id ?? null) : null,
        }),
      )
    }),
  ),
]
