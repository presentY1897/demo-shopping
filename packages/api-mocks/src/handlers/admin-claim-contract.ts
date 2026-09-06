import type {
  AdminClaimListItem,
  AdminFailedRefund,
  Claim,
  ClaimAppeal,
  ClaimableItem,
  ClaimableResponse,
  ClaimHandlingStage,
  ClaimStatus,
  ClaimType,
} from '@shopping/shared'

/**
 * 관리자 콘솔의 클레임 씨앗과 조립기 (TASK-0071).
 *
 * **픽스처 파일이 아니라 여기 있는 이유**는 `fixtures/*.ts` 가 `defineFixture` 를
 * 지난 값 말고는 아무것도 내보낼 수 없기 때문이다(`registry.spec.ts`). 픽스처와
 * 핸들러가 **같은 줄**을 읽어야 하므로, 그 줄을 만드는 코드는 둘 다 들여올 수 있는
 * 곳에 있어야 한다 — `seller-claim-contract.ts` 가 같은 이유로 같은 자리에 있다.
 *
 * ## 이 대역이 재현하는 것
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | 최신순 한 축 | `ORDER BY c."id" DESC`, 커서는 `id` 하나 |
 * | 지연은 **정렬이 아니라 표시** | 지연은 `now` 에 달린 값이라 커서를 흔든다 (`admin-claim.service.ts`) |
 * | 개입은 **새 클레임** | 원본은 거절된 채 남고 `overturnsClaimId` 가 둘을 잇는다 |
 * | 인용은 강제 처리 그 자체 | 개입과 **같은 트랜잭션**에서 이의가 닫힌다 |
 *
 * 값이 그럴듯한 것이 중요하다 — 화면은 「지연 3건 · 이의 2건」 같은 숫자로 배치를
 * 정하는데, 전부 0인 대역으로 만든 화면은 실제 데이터 앞에서 처음 무너진다.
 */

/** ids 가 UUIDv7 접두어를 나눠 쓰므로, 문자열 정렬이 곧 나이순이다. */
const CLAIM_ID_PREFIX = '019597a0-0001-7000-8000-00000000'
const SELLER_ID_PREFIX = '019597a0-0002-7000-8000-00000000'
const BUYER_ID_PREFIX = '019597a0-0003-7000-8000-00000000'
const ORDER_ID_PREFIX = '019597a0-0004-7000-8000-00000000'
const ITEM_ID_PREFIX = '019597a0-0005-7000-8000-00000000'
const HISTORY_ID_PREFIX = '019597a0-0006-7000-8000-00000000'
/** 아직 클레임이 없는 판매자 몫들 — 확정 후 하자 반품이 시작되는 자리 (F4). */
const CLAIMABLE_ID_PREFIX = '019597a0-0008-7000-8000-00000000'

/** 이 대역이 말하는 「지금」. 고정이라 픽스처가 나이를 먹지 않는다. */
export const MOCK_ADMIN_CLAIM_NOW = '2026-09-08T05:00:00.000Z'

/** 개입이 만들어 내는 클레임의 id. 화면이 답을 따라갈 때 쓴다. */
export const MOCK_ADMIN_INTERVENTION_ID = `${CLAIM_ID_PREFIX}00f1`

/** 확정 후 하자 반품이 만들어 내는 클레임의 id. 위와 **다른 값**이어야 한다. */
export const MOCK_ADMIN_DEFECT_RETURN_ID = `${CLAIM_ID_PREFIX}00f2`

const HOUR_MS = 3_600_000

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 「몇 시간 전」을 ISO 로. 대역의 시각은 전부 이 함수를 지난다. */
function hoursAgo(hours: number): string {
  return new Date(Date.parse(MOCK_ADMIN_CLAIM_NOW) - hours * HOUR_MS).toISOString()
}

/**
 * 한 줄이 무엇인가 — 씨앗.
 *
 * 상태와 「몇 시간 전인가」만 손으로 적고 나머지는 파생시킨다. 열두 줄을 손으로
 * 적으면 그중 하나가 `type` 과 `status` 가 어긋난 채 남고, 그런 행은 실제 API 가
 * `ClaimRequest_type_status_check` 로 막아 **절대 오지 않는다.**
 */
export interface MockAdminClaimSeed {
  readonly index: number
  readonly status: ClaimStatus
  /** 신청한 지 몇 시간 지났나. 기한(압축 모드 10분)을 넘겼는지가 여기서 갈린다. */
  readonly agedHours: number
  /** 두 가게 중 어느 쪽인가. 관리자 목록의 필터가 이 축으로 좁힌다. */
  readonly store: 0 | 1
  /** 검토를 기다리는 이의가 걸려 있다. 거절된 줄에만 붙을 수 있다. */
  readonly appealed?: boolean
}

/** 유형은 상태가 정한다 — 실제 표에서 둘이 어긋난 행은 만들어질 수 없다. */
export function mockAdminClaimTypeOf(status: ClaimStatus): ClaimType {
  return status.startsWith('CANCEL') ? 'CANCEL' : 'RETURN'
}

/**
 * 단계는 **전이표가 정한다.**
 *
 * 목록을 손으로 적지 않는 이유는 서버와 같다 — 표를 한 벌 더 두면 상태가 늘 때 한
 * 곳만 고쳐지고, 그때 증상은 「처리할 것이 없는데 대기 3건」이다.
 */
const WAITING: readonly ClaimStatus[] = [
  'CANCEL_REQUESTED',
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  'PICKING_UP',
  'INSPECTING',
]

const CLOSED: readonly ClaimStatus[] = ['CANCEL_REJECTED', 'RETURN_REJECTED', 'REFUNDED']

export function mockAdminClaimStageOf(status: ClaimStatus): ClaimHandlingStage {
  if (WAITING.includes(status)) return 'WAITING'

  return CLOSED.includes(status) ? 'CLOSED' : 'IN_PROGRESS'
}

/** 두 가게. 실제 상표를 쓰지 않는다 (CLAUDE.md 6장). */
const BRANDS = ['루미에르', '노브가든'] as const

/**
 * 열두 줄.
 *
 * **오래된 것과 방금 것이 섞여 있다.** 지연 목록이 뜻을 가지려면 기한을 넘긴 줄과
 * 아직 남은 줄이 둘 다 있어야 하고, 전부 지연이면 뱃지가 아무것도 구분하지 못한다
 * (`claim-deadline.ts` 가 압축 기한을 10분으로 정한 것과 같은 이유다).
 */
export const mockAdminClaimSeeds: readonly MockAdminClaimSeed[] = [
  { index: 1, status: 'REFUNDED', agedHours: 72, store: 0 },
  { index: 2, status: 'CANCEL_REJECTED', agedHours: 60, store: 0, appealed: true },
  { index: 3, status: 'RETURN_REJECTED', agedHours: 54, store: 1, appealed: true },
  { index: 4, status: 'RETURN_REJECTED', agedHours: 48, store: 0 },
  { index: 5, status: 'CANCEL_APPROVED', agedHours: 36, store: 1 },
  { index: 6, status: 'RETURN_COMPLETED', agedHours: 30, store: 0 },
  { index: 7, status: 'INSPECTING', agedHours: 26, store: 1 },
  { index: 8, status: 'PICKING_UP', agedHours: 20, store: 0 },
  { index: 9, status: 'RETURN_APPROVED', agedHours: 12, store: 1 },
  { index: 10, status: 'RETURN_REQUESTED', agedHours: 6, store: 0 },
  { index: 11, status: 'CANCEL_REQUESTED', agedHours: 2, store: 1 },
  // 방금 들어온 신청. **지연이 아닌 줄이 하나는 있어야** 뱃지가 뜻을 갖는다.
  { index: 12, status: 'CANCEL_REQUESTED', agedHours: 0, store: 0 },
]

/**
 * 씨앗 하나를 번호로 찾는다. **없으면 던진다.**
 *
 * 목록을 첨자로 집으면 그 값이 `undefined` 일 수 있다는 사실을 타입이 계속
 * 상기시키고, 부르는 쪽마다 그 갈래를 달래게 된다 — 여기서 한 번 던지면 그 갈래가
 * 사라지고, 실제로 없는 번호를 부른 것은 대역의 버그이지 화면이 다룰 상태가 아니다.
 */
export function mockAdminClaimSeedOf(index: number): MockAdminClaimSeed {
  const seed = mockAdminClaimSeeds.find((entry) => entry.index === index)

  if (seed === undefined) throw new Error(`씨앗 ${String(index)} 이(가) 없습니다.`)

  return seed
}

export function mockAdminClaimIdOf(index: number): string {
  return `${CLAIM_ID_PREFIX}${pad2(index)}${pad2(index)}`
}

export function mockAdminSellerIdOf(store: 0 | 1): string {
  return `${SELLER_ID_PREFIX}${pad2(store + 1)}${pad2(store + 1)}`
}

export function mockAdminBuyerIdOf(index: number): string {
  return `${BUYER_ID_PREFIX}${pad2(index)}${pad2(index)}`
}

/**
 * 기한 — 압축 모드의 10분 뒤 (`CLAIM_HANDLING_DEMO_MS`).
 *
 * 실제 서버는 배포 설정에 따라 2영업일을 쓰지만, **대역이 고를 수 있는 값은
 * 하나뿐**이고 데모 배포의 값이 화면이 실제로 만나는 값이다. 화면은 이 날짜를
 * 스스로 계산하지 않는다 — 그것이 `dueAt` 이 응답에 실리는 이유다.
 */
const DEMO_DEADLINE_MS = 10 * 60_000

function dueAtOf(requestedAt: string): string {
  return new Date(Date.parse(requestedAt) + DEMO_DEADLINE_MS).toISOString()
}

export function mockAdminClaimListItemOf(seed: MockAdminClaimSeed): AdminClaimListItem {
  const requestedAt = hoursAgo(seed.agedHours)
  const stage = mockAdminClaimStageOf(seed.status)
  const dueAt = dueAtOf(requestedAt)

  return {
    id: mockAdminClaimIdOf(seed.index),
    sellerOrderId: `${ORDER_ID_PREFIX}${pad2(seed.index)}${pad2(seed.index)}`,
    orderNumber: `20260905-${String(seed.index).padStart(8, '0')}`,
    sellerId: mockAdminSellerIdOf(seed.store),
    brandName: BRANDS[seed.store],
    buyerId: mockAdminBuyerIdOf(seed.index),
    type: mockAdminClaimTypeOf(seed.status),
    status: seed.status,
    stage,
    fault: seed.status.startsWith('RETURN') ? 'SELLER' : 'CUSTOMER',
    requestedAt,
    dueAt,
    // 기한이 지났고 **아직 처리 대기인** 줄만 지연이다. 끝난 건에 「지연」을 붙이면
    // 그 뱃지는 아무도 손댈 수 없는 과거를 가리킨다.
    overdue: stage === 'WAITING' && Date.parse(dueAt) < Date.parse(MOCK_ADMIN_CLAIM_NOW),
    itemCount: 1,
    totalQuantity: seed.index % 2 === 0 ? 2 : 1,
    appealPending: seed.appealed === true,
    intervention: false,
  }
}

/** 이 씨앗에 걸린 이의, 또는 없으면 `null`. */
function appealOf(seed: MockAdminClaimSeed): ClaimAppeal | null {
  if (seed.appealed !== true) return null

  return {
    claimId: mockAdminClaimIdOf(seed.index),
    filedById: mockAdminBuyerIdOf(seed.index),
    reason: '판매자 설명과 배송 기록이 맞지 않아요. 다시 봐 주세요.',
    filedAt: hoursAgo(seed.agedHours - 1),
    reviewedAt: null,
    reviewedById: null,
    outcome: null,
    reviewNote: null,
  }
}

/**
 * 클레임 하나, 상세가 그리는 모양 그대로.
 *
 * 이력이 **한 줄뿐인 것이 일부러다.** 대역이 재현해야 하는 것은 「이력이 있다」와
 * 「거기 누가·왜가 적힌다」이고, 실제 이력의 줄 수는 그 클레임이 걸어온 길에 달렸다
 * — 지어내면 화면이 실제로는 오지 않는 순서에 맞춰진다.
 */
export function mockAdminClaimOf(seed: MockAdminClaimSeed): Claim {
  const id = mockAdminClaimIdOf(seed.index)
  const requestedAt = hoursAgo(seed.agedHours)
  const type = mockAdminClaimTypeOf(seed.status)

  return {
    id,
    sellerOrderId: `${ORDER_ID_PREFIX}${pad2(seed.index)}${pad2(seed.index)}`,
    orderId: `${ORDER_ID_PREFIX}${pad2(seed.index)}${pad2(seed.index)}`,
    orderNumber: `20260905-${String(seed.index).padStart(8, '0')}`,
    type,
    status: seed.status,
    reason: type === 'CANCEL' ? '주문을 잘못했어요.' : '받아 보니 상태가 달라요.',
    fault: type === 'CANCEL' ? 'CUSTOMER' : 'SELLER',
    requestedById: mockAdminBuyerIdOf(seed.index),
    requestedAt,
    updatedAt: requestedAt,
    items: [
      {
        id: `${ITEM_ID_PREFIX}${pad2(seed.index)}${pad2(seed.index)}`,
        orderItemId: `${ITEM_ID_PREFIX}${pad2(seed.index)}aa`,
        variantId: `${ITEM_ID_PREFIX}${pad2(seed.index)}bb`,
        snapshot: {
          productId: `${ORDER_ID_PREFIX}${pad2(seed.index)}cc`,
          productName: '울 블렌드 코트',
          optionLabel: '블랙 / M',
          sku: `SKU-${pad2(seed.index)}`,
          thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
          brandName: BRANDS[seed.store],
        },
        quantity: 1,
        // 아직 계산하지 않았다는 뜻의 0 이다. 계산은 환불이 실행될 때 일어난다.
        refundAmount: 0,
      },
    ],
    history: [
      {
        id: `${HISTORY_ID_PREFIX}${pad2(seed.index)}01`,
        fromStatus: null,
        toStatus: type === 'CANCEL' ? 'CANCEL_REQUESTED' : 'RETURN_REQUESTED',
        reason: null,
        actor: 'BUYER',
        actorId: mockAdminBuyerIdOf(seed.index),
        occurredAt: requestedAt,
      },
    ],
    overturnsClaimId: null,
    overturnedByClaimIds: [],
    appeal: appealOf(seed),
  }
}

/**
 * 개입 하나 — **원본을 가리키는 새 클레임**.
 *
 * 이 대역이 실제 서버와 같은 모양인지가 이 함수의 전부다: 원본은 거절된 채 남고,
 * 개입은 승인된 상태로 태어나며, 첫 이력 줄의 주체가 `ADMIN` 이고 거기 사유가 있다.
 */
export function mockAdminInterventionOf(original: Claim, reason: string, adminId: string): Claim {
  const now = MOCK_ADMIN_CLAIM_NOW
  const approved = original.type === 'CANCEL' ? 'CANCEL_APPROVED' : 'RETURN_APPROVED'
  const requested = original.type === 'CANCEL' ? 'CANCEL_REQUESTED' : 'RETURN_REQUESTED'

  return {
    ...original,
    id: MOCK_ADMIN_INTERVENTION_ID,
    status: approved,
    reason,
    requestedById: adminId,
    requestedAt: now,
    updatedAt: now,
    history: [
      {
        id: `${HISTORY_ID_PREFIX}f101`,
        fromStatus: null,
        toStatus: requested,
        reason,
        actor: 'ADMIN',
        actorId: adminId,
        occurredAt: now,
      },
      {
        id: `${HISTORY_ID_PREFIX}f102`,
        fromStatus: requested,
        toStatus: approved,
        reason,
        actor: 'ADMIN',
        actorId: adminId,
        occurredAt: now,
      },
    ],
    overturnsClaimId: original.id,
    overturnedByClaimIds: [],
    appeal: null,
  }
}

/**
 * 나가지 못한 환불 두 건.
 *
 * **정상 흐름에서 이 목록은 0건이다.** 그래도 대역이 두 건을 답하는 이유는 화면이
 * 그려야 하는 것이 「0건일 때의 빈 상태」만이 아니기 때문이고, 두 건인 것은 **다시
 * 시도하면 사라질 실패와 사람이 손대야 할 실패**를 둘 다 보여 주기 위해서다
 * (`attempts` 와 `lastError` 가 그 둘을 가른다).
 */
export const mockAdminFailedRefunds: readonly AdminFailedRefund[] = [
  {
    claimId: mockAdminClaimIdOf(5),
    sellerOrderId: `${ORDER_ID_PREFIX}0505`,
    orderNumber: '20260905-00000005',
    sellerId: mockAdminSellerIdOf(1),
    brandName: BRANDS[1],
    claimStatus: 'CANCEL_APPROVED',
    amount: 42_000,
    attempts: 1,
    lastError: '결제사에 닿지 못했습니다. (timeout)',
    lastAttemptAt: hoursAgo(1),
    waitingSince: hoursAgo(36),
  },
  {
    claimId: mockAdminClaimIdOf(6),
    sellerOrderId: `${ORDER_ID_PREFIX}0606`,
    orderNumber: '20260905-00000006',
    sellerId: mockAdminSellerIdOf(0),
    brandName: BRANDS[0],
    claimStatus: 'RETURN_COMPLETED',
    amount: 18_000,
    attempts: 9,
    lastError: '이미 전액 환불된 결제입니다.',
    lastAttemptAt: hoursAgo(2),
    waitingSince: hoursAgo(30),
  },
]

/** 최신순 — 실제 목록의 `ORDER BY c."id" DESC` 와 같은 축이다. */
export function sortAdminClaims(rows: readonly AdminClaimListItem[]): AdminClaimListItem[] {
  return [...rows].toSorted((left, right) => right.id.localeCompare(left.id))
}

/* ------------------------------------------------------------------------- *
 * 확정 후 하자 반품 (TASK-0071 F4)
 * ------------------------------------------------------------------------- */

/**
 * 관리자가 **원본 거절 없이** 개입하는 경로가 묻는 것 하나 —
 * `GET /seller-orders/:id/claimable`.
 *
 * 위의 열두 줄과 **다른 축**이라 따로 있다. 저것들은 이미 클레임이 된 것들이고, 이
 * 다섯은 **아직 클레임이 없는 판매자 몫**이다. 확정 후 하자 반품의 시작점이 정확히
 * 거기이기 때문에(원본이 없다) 목록의 어느 줄로도 그 화면에 닿을 수 없다.
 *
 * **다섯인 이유는 화면이 갈라야 하는 답이 다섯이기 때문**이다. 실제 서버의
 * `ClaimService.claimable` 은 **구매자의 판정**(`claimEligibility`)으로 답하므로,
 * 확정된 몫에는 `type: null` · `refusal: 'confirmed'` 가 온다 — 그 거절이 관리자
 * 화면에서는 **「여기서 시작할 수 있다」는 신호**다. 나머지 넷은 각각 다른 문장으로
 * 끝나야 하는 상태이고, 그중 둘(`delivered` · `shipped`)에는 이미 정상 경로가 있다.
 */
export const MOCK_ADMIN_CLAIMABLE_IDS = {
  /** 구매확정. 관리자만 여기서 반품을 열 수 있다 — 이 화면의 정상 흐름이다. */
  confirmed: `${CLAIMABLE_ID_PREFIX}c001`,
  /** 구매확정인데 **남은 수량이 없다.** 이미 전량이 다른 클레임에 잡혀 있다. */
  exhausted: `${CLAIMABLE_ID_PREFIX}c002`,
  /** 배송완료, 기간 안. 구매자가 **직접** 신청할 수 있으니 이 화면의 일이 아니다. */
  delivered: `${CLAIMABLE_ID_PREFIX}c003`,
  /** 배송중. 취소하기엔 떠났고 반품하기엔 안 왔다. */
  shipped: `${CLAIMABLE_ID_PREFIX}c004`,
  /** 이미 취소된 몫. 걸 것이 없다. */
  canceled: `${CLAIMABLE_ID_PREFIX}c005`,
} as const

/** 이 다섯 몫이 딸린 주문의 번호. 화면이 「맞는 주문인가」를 대조하는 값이다. */
export const MOCK_ADMIN_CLAIMABLE_ORDER_NUMBERS: Readonly<Record<string, string>> = {
  [MOCK_ADMIN_CLAIMABLE_IDS.confirmed]: '20260901-000000C1',
  [MOCK_ADMIN_CLAIMABLE_IDS.exhausted]: '20260901-000000C2',
  [MOCK_ADMIN_CLAIMABLE_IDS.delivered]: '20260901-000000C3',
  [MOCK_ADMIN_CLAIMABLE_IDS.shipped]: '20260901-000000C4',
  [MOCK_ADMIN_CLAIMABLE_IDS.canceled]: '20260901-000000C5',
}

/** 몫 하나의 항목 둘. 부분 반품이 뜻을 가지려면 고를 것이 둘 이상이어야 한다. */
function claimableItemsOf(sellerOrderId: string, claimed: readonly number[]): ClaimableItem[] {
  const tail = sellerOrderId.slice(-2)

  return [
    { name: '울 블렌드 코트', option: '블랙 / M', ordered: 2 },
    { name: '리브 니트 가디건', option: '아이보리 / L', ordered: 1 },
  ].map((line, index) => {
    const claimedQuantity = claimed[index] ?? 0

    return {
      orderItemId: `${CLAIMABLE_ID_PREFIX}${tail}a${String(index)}`,
      variantId: `${CLAIMABLE_ID_PREFIX}${tail}b${String(index)}`,
      snapshot: {
        productId: `${CLAIMABLE_ID_PREFIX}${tail}c${String(index)}`,
        productName: line.name,
        optionLabel: line.option,
        sku: `SKU-${tail}-${String(index)}`,
        thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
        brandName: BRANDS[0],
      },
      quantity: line.ordered,
      claimedQuantity,
      remainingQuantity: Math.max(0, line.ordered - claimedQuantity),
    }
  })
}

/**
 * 「이 몫에 지금 무엇을 몇 개까지 신청할 수 있나」, 또는 모르는 몫이면 `null`.
 *
 * **`type` 과 `refusal` 을 손으로 적는다.** 실제 서버가 그 답을 내는 함수는
 * `apps/api` 안이라 대역이 들여올 수 없고, 옮겨 적으면 규칙이 두 벌이 된다 —
 * 그래서 옮기는 것이 아니라 **다섯 개의 고정된 답**을 둔다. 대역이 답해야 하는 것은
 * 규칙이 아니라 화면이 갈라야 하는 다섯 가지 답 그 자체다.
 */
export function mockAdminClaimableOf(sellerOrderId: string): ClaimableResponse | null {
  const ids = MOCK_ADMIN_CLAIMABLE_IDS

  if (sellerOrderId === ids.confirmed) {
    return {
      sellerOrderId,
      type: null,
      refusal: 'confirmed',
      returnWindowEndsAt: null,
      items: claimableItemsOf(sellerOrderId, [0, 0]),
    }
  }
  if (sellerOrderId === ids.exhausted) {
    return {
      sellerOrderId,
      type: null,
      refusal: 'confirmed',
      returnWindowEndsAt: null,
      items: claimableItemsOf(sellerOrderId, [2, 1]),
    }
  }
  if (sellerOrderId === ids.delivered) {
    return {
      sellerOrderId,
      type: 'RETURN',
      refusal: null,
      returnWindowEndsAt: '2026-09-15T02:30:00.000Z',
      items: claimableItemsOf(sellerOrderId, [0, 0]),
    }
  }
  if (sellerOrderId === ids.shipped) {
    return {
      sellerOrderId,
      type: null,
      refusal: 'in_transit',
      returnWindowEndsAt: null,
      items: claimableItemsOf(sellerOrderId, [0, 0]),
    }
  }
  if (sellerOrderId === ids.canceled) {
    return {
      sellerOrderId,
      type: null,
      refusal: 'not_claimable',
      returnWindowEndsAt: null,
      items: claimableItemsOf(sellerOrderId, [0, 0]),
    }
  }

  return null
}

/**
 * 확정 후 하자 반품 하나 — **원본이 없는 개입**.
 *
 * {@link mockAdminInterventionOf} 와 나란히 있고 다른 것은 두 가지다: 원본이 없으니
 * `overturnsClaimId` 가 `null` 이고, 항목이 **관리자가 고른 것**이다. 태어나는 자리가
 * `RETURN_APPROVED` 인 것은 같다 — 개입 자체가 결론이기 때문이다.
 */
export function mockAdminDefectReturnOf(input: {
  readonly sellerOrderId: string
  readonly lines: readonly { readonly orderItemId: string; readonly quantity: number }[]
  readonly reason: string
  readonly adminId: string
}): Claim {
  const now = MOCK_ADMIN_CLAIM_NOW
  const claimable = mockAdminClaimableOf(input.sellerOrderId)
  const items = input.lines.map((line, index) => {
    const source = claimable?.items.find((item) => item.orderItemId === line.orderItemId)

    return {
      id: `${CLAIMABLE_ID_PREFIX}dd0${String(index)}`,
      orderItemId: line.orderItemId,
      variantId: source?.variantId ?? `${CLAIMABLE_ID_PREFIX}de0${String(index)}`,
      snapshot: source?.snapshot ?? {
        productId: `${CLAIMABLE_ID_PREFIX}df0${String(index)}`,
        productName: '울 블렌드 코트',
        optionLabel: '블랙 / M',
        sku: 'SKU-00-0',
        thumbnailUrl: null,
        brandName: BRANDS[0],
      },
      quantity: line.quantity,
      refundAmount: 0,
    }
  })

  return {
    id: MOCK_ADMIN_DEFECT_RETURN_ID,
    sellerOrderId: input.sellerOrderId,
    orderId: `${CLAIMABLE_ID_PREFIX}0dd0`,
    orderNumber: MOCK_ADMIN_CLAIMABLE_ORDER_NUMBERS[input.sellerOrderId] ?? '20260901-000000C1',
    type: 'RETURN',
    status: 'RETURN_APPROVED',
    reason: input.reason,
    fault: 'SELLER',
    requestedById: input.adminId,
    requestedAt: now,
    updatedAt: now,
    items,
    history: [
      {
        id: `${HISTORY_ID_PREFIX}d101`,
        fromStatus: null,
        toStatus: 'RETURN_REQUESTED',
        reason: input.reason,
        actor: 'ADMIN',
        actorId: input.adminId,
        occurredAt: now,
      },
      {
        id: `${HISTORY_ID_PREFIX}d102`,
        fromStatus: 'RETURN_REQUESTED',
        toStatus: 'RETURN_APPROVED',
        reason: input.reason,
        actor: 'ADMIN',
        actorId: input.adminId,
        occurredAt: now,
      },
    ],
    overturnsClaimId: null,
    overturnedByClaimIds: [],
    appeal: null,
  }
}
