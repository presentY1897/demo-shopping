import type {
  Claim,
  ClaimAction,
  ClaimActionRoute,
  ClaimFault,
  ClaimHandlingStage,
  ClaimHistoryEntry,
  ClaimItem,
  ClaimRefundQuote,
  ClaimStatus,
  ClaimType,
  ReturnDetail,
  ReturnReason,
  ReturnShipment,
  ReturnShipmentDirection,
  SellerClaimDetailResponse,
  SellerClaimListItem,
  SellerClaimSummary,
} from '@shopping/shared'
import { claimHandlingStages, claimStatuses, demoCarrierNames } from '@shopping/shared'

/**
 * 판매자 클레임 대역이 픽스처와 핸들러 **양쪽에서** 읽는 것들 (TASK-0070).
 *
 * 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없으므로(`registry.spec.ts`), 두 곳이
 * 함께 쓰는 값은 여기 산다 — `claim-contract.ts` · `order-contract.ts` 가 같은 이유로
 * 있다. 여기에는 상수만이 아니라 **줄을 조립하는 순수 함수**도 있는데, 그것이 이
 * 파일이 답하는 질문이기 때문이다: 「목록의 첫 페이지」(픽스처)와 「저장소가 세우는
 * 줄」(핸들러)이 **같은 열 건**이어야 한다. 조립기를 양쪽에 한 벌씩 두면 픽스처가
 * 말하는 첫 페이지와 라우트가 답하는 첫 페이지가 갈리고, 그 어긋남은 목의 사정인데
 * 화면의 결함처럼 보인다.
 *
 * **상태를 갖지 않는다.** 저장소도 msw 도 여기 없다 — 그쪽은 `seller-claims.ts` 다.
 */

/** uuid 의 앞 네 마디. 마지막 마디만 줄마다 다르다. */
const ID_PREFIX = '01937c00-0000-7000-8000-'

/** 열 건이므로 두 자리로 충분하다. 자릿수가 같아야 사전순이 곧 번호순이다. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 클레임 id — **정렬 가능하다**.
 *
 * 커서가 가리키는 것이 `(단계, id)` 두 칸이고 그중 뒤 칸이 이것이므로, id 의 순서가
 * 곧 계약이다. 실제 서버의 UUIDv7 은 신청 시각과 같은 순서라 「오래된 것이 먼저」가
 * 공짜로 따라오는데(`seller-claim.service.ts`), 목의 `requestedAt` 도 그래서 id 와
 * 같은 방향으로 자란다 — 어긋나면 「대기 안에서 오래된 것이 먼저」를 재는 검사가
 * 목의 사정으로 통과한다.
 */
function claimIdAt(index: number): string {
  return `${ID_PREFIX}00000000cc${pad2(index + 1)}`
}

/**
 * 이 대역이 답하는 열 건의 id.
 *
 * 순서는 id 순이고 **단계 순이 아니다** — 뒤엣것은 {@link sortSellerClaims} 가 만든다.
 */
export const MOCK_SELLER_CLAIM_IDS: readonly string[] = Array.from(
  { length: 10 },
  (_unused, index) => claimIdAt(index),
)

/**
 * 이 대역이 서 있는 순간.
 *
 * 기한(`dueAt`)이 이 시각의 양쪽에 흩어져 있어야 「지연」과 「기한 안」을 **둘 다**
 * 그릴 수 있다. 한쪽만 있으면 지연 강조는 늘 켜져 있거나 늘 꺼져 있고, 그 상태에서
 * 화면 검사는 강조를 재지 못한다.
 */
export const MOCK_SELLER_CLAIM_NOW = '2026-09-07T03:00:00.000Z'

/**
 * 이 콘솔이 보는 가게. **하나뿐인 것이 요점이다** — 판매자 콘솔은 자기 가게의
 * 클레임만 답한다(`SellerClaimService.ownStore`). 브랜드가 섞이면 목이 답할 수 없는
 * 화면(관리자의 것, TASK-0071)을 흉내 내게 된다.
 */
export const MOCK_SELLER_CLAIM_BRAND = '루미에르'

/** 실제 상표를 쓰지 않는다 (CLAUDE.md 6장). 열 줄이라 열 가지다. */
const PRODUCTS: readonly string[] = [
  '울 블렌드 코트',
  '캐시미어 머플러',
  '스웨이드 첼시부츠',
  '오버핏 셔츠',
  '리넨 원피스',
  '데님 재킷',
  '니트 가디건',
  '코튼 치노팬츠',
  '레더 크로스백',
  '니트 비니',
]

const OPTION_LABELS: readonly string[] = ['블랙 / M', '아이보리 / L', '카멜 / 260', '네이비 / S']

function productAt(index: number): string {
  return PRODUCTS[index % PRODUCTS.length] ?? '데모 상품'
}

function optionAt(index: number): string {
  return OPTION_LABELS[index % OPTION_LABELS.length] ?? '블랙 / M'
}

/**
 * 어느 상태가 어느 단계인가 — **손으로 적는다.**
 *
 * 실제 서버는 이 표를 갖지 않는다. 「판매자가 할 일이 있다」는 곧 「전이표에서 이
 * 상태를 떠나는 화살표 중 `SELLER` 가 지날 수 있는 것이 있다」이고, 그 사실은
 * `apps/api/src/claims/claim-rules.ts` 의 `claimTransitions` 에 한 번 적혀 있어
 * `claimHandlingStage()` 가 거기서 답을 만든다.
 *
 * **그 전이표가 `@shopping/shared` 에 없다.** 계약이 갖는 것은 상태 목록과 단계
 * 목록뿐이고, 화살표는 API 앱 안에 산다 — 목이 그것을 들여오면 대역이 서버 코드에
 * 의존하게 된다. 그래서 여기서는 표를 **옮겨 적고**, 옮겨 적었다는 사실을 이렇게
 * 남긴다: 상태가 늘거나 화살표가 바뀌면 **이 파일도 함께 고쳐야 한다.** `Record` 로
 * 적은 것이 그 절반을 타입에 맡기는 방법이다 — 상태가 하나 늘면 여기서 컴파일이
 * 멈춘다.
 *
 * 아래 {@link MOCK_SELLER_CLAIM_SELLER_STEPS} 와 **함께 읽어야 한다**: 걸음이 있는
 * 상태가 곧 `WAITING` 이고, 종착 셋만 `CLOSED` 이며, 나머지가 `IN_PROGRESS` 다.
 */
export const MOCK_SELLER_CLAIM_STAGES: Readonly<Record<ClaimStatus, ClaimHandlingStage>> = {
  CANCEL_REQUESTED: 'WAITING',
  CANCEL_APPROVED: 'IN_PROGRESS',
  CANCEL_REJECTED: 'CLOSED',
  RETURN_REQUESTED: 'WAITING',
  RETURN_APPROVED: 'WAITING',
  PICKING_UP: 'WAITING',
  INSPECTING: 'WAITING',
  RETURN_COMPLETED: 'IN_PROGRESS',
  RETURN_REJECTED: 'CLOSED',
  REFUNDED: 'CLOSED',
}

/**
 * 이 상태에서 **판매자가** 밟을 수 있는 걸음 — `claimTransitions` 에서 `SELLER` 가
 * 지날 수 있는 화살표만.
 *
 * 위 표와 같은 이유로 손으로 적는다. 목이 늘 같은 버튼을 답하면 「상태가 바뀌면
 * 버튼도 바뀐다」가 검사에서 사라지고, 화면은 상태로 분기하는 코드를 갖게 된다 —
 * 서버가 `actions` 를 답하는 이유가 정확히 그것을 막는 것이다.
 */
export const MOCK_SELLER_CLAIM_SELLER_STEPS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> =
  {
    CANCEL_REQUESTED: ['CANCEL_APPROVED', 'CANCEL_REJECTED'],
    CANCEL_APPROVED: [],
    CANCEL_REJECTED: [],
    RETURN_REQUESTED: ['RETURN_APPROVED', 'RETURN_REJECTED'],
    RETURN_APPROVED: ['PICKING_UP'],
    PICKING_UP: ['INSPECTING'],
    INSPECTING: ['RETURN_COMPLETED', 'RETURN_REJECTED'],
    RETURN_COMPLETED: [],
    RETURN_REJECTED: [],
    REFUNDED: [],
  }

/**
 * 해피 패스의 다음 상태. **이력을 세우는 데만 쓴다.**
 *
 * 이미 진행된 줄을 씨앗으로 두면서 이력을 한 줄로 두면, 상세의 타임라인이 「신청됐고
 * 지금은 검수 중」이라고만 말한다 — 실제 서버에서는 그 사이의 걸음이 전부 남아
 * 있고, 분쟁에서 읽히는 것이 그 이력이다. 곁가지(거절)는 이 선 위에 없으므로
 * {@link historyOf} 가 「닿지 못하면 한 걸음」으로 되돌린다.
 */
const MAIN_LINE: Readonly<Record<ClaimStatus, ClaimStatus | null>> = {
  CANCEL_REQUESTED: 'CANCEL_APPROVED',
  CANCEL_APPROVED: 'REFUNDED',
  CANCEL_REJECTED: null,
  RETURN_REQUESTED: 'RETURN_APPROVED',
  RETURN_APPROVED: 'PICKING_UP',
  PICKING_UP: 'INSPECTING',
  INSPECTING: 'RETURN_COMPLETED',
  RETURN_COMPLETED: 'REFUNDED',
  RETURN_REJECTED: null,
  REFUNDED: null,
}

/** 신청이 태어나는 자리. 유형이 정한다 — 전이가 아니라 생성이기 때문이다. */
const INITIAL_STATUS: Readonly<Record<ClaimType, ClaimStatus>> = {
  CANCEL: 'CANCEL_REQUESTED',
  RETURN: 'RETURN_REQUESTED',
}

/** 반품 사유가 정하는 귀책 (`returnFaultOf`). 목은 그 역방향을 쓴다. */
const RETURN_REASON_OF: Readonly<Record<ClaimFault, ReturnReason>> = {
  /** 단순 변심. 반품비를 구매자가 물고 사진은 붙일 수 없다. */
  CUSTOMER: 'CHANGE_OF_MIND',
  /**
   * 하자. **오배송(`WRONG_ITEM`)과 돈에서 같으므로** 둘 중 하나만 세운다 —
   * 대역이 재현하는 것은 금액과 사진 규칙이고, 그 둘은 이 사유로 전부 지나간다.
   */
  SELLER: 'DEFECTIVE',
}

/** 사람이 적은 문장. 유형과 사유마다 다르게 두어야 화면이 같은 문장만 그리지 않는다. */
const REASON_TEXT: Readonly<Record<ReturnReason | 'CANCEL', string>> = {
  CANCEL: '주문을 잘못 넣었어요.',
  CHANGE_OF_MIND: '입어 보니 생각한 색이 아니에요.',
  DEFECTIVE: '소매 박음질이 뜯어져 있어요.',
  WRONG_ITEM: '주문한 것과 다른 상품이 왔어요.',
}

/** 반품 배송비. 신청 시점에 굳는 값이라 목에서도 한 자리에만 있다. */
const RETURN_SHIPPING_FEE = 3_000

/** 신청한 사람. 이 대역의 클레임은 전부 한 사람이 걸었다. */
const REQUESTED_BY_ID = `${ID_PREFIX}00000000bead`

/** 씨앗 한 줄 — 나머지는 전부 여기서 파생된다. */
interface SellerClaimSeedInput {
  readonly type: ClaimType
  readonly status: ClaimStatus
  readonly fault: ClaimFault
  readonly requestedAt: string
  /**
   * 신청 후 2영업일 (`claim-deadline.ts`).
   *
   * **목이 영업일을 다시 세지 않는다.** 시간대·주말의 정의가 서버에 있고 그 계산을
   * 여기 옮기면 두 벌이 된다 — 대신 답을 굳혀 둔다. 아래 값들은 그 함수가 이
   * `requestedAt` 에 대해 내놓는 답 그대로다 (KST 기준, 주말 제외).
   */
  readonly dueAt: string
  readonly itemCount: number
  readonly totalQuantity: number
}

/**
 * 열 건 — **id 순서와 단계가 일부러 어긋나 있다.**
 *
 * 가장 작은 id 가 `CLOSED` 이고 가장 큰 id 가 `WAITING` 인 것이 그 어긋남이다.
 * 나란히 두면 「단계 순위 오름차순, id 오름차순」이라는 정렬이 「id 오름차순」과 같은
 * 답을 내고, 그때 정렬을 아예 구현하지 않은 목도 검사를 통과한다.
 *
 * 대기 다섯 · 진행 둘 · 종료 셋이고 취소와 반품이 섞여 있다. 대기 중 앞의 둘은
 * 기한을 넘겼고 뒤의 셋은 아직 기한 안이다 — 대기는 `id` 오름차순이므로 지연된 건이
 * **정확히 탭 맨 위에** 모인다 (`seller-claim.service.ts` 의 「지연은 정렬 키가
 * 아니다」).
 */
const SEEDS: readonly SellerClaimSeedInput[] = [
  {
    type: 'CANCEL',
    status: 'CANCEL_REJECTED',
    fault: 'CUSTOMER',
    requestedAt: '2026-08-24T01:00:00.000Z',
    dueAt: '2026-08-26T01:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'CANCEL',
    status: 'CANCEL_REQUESTED',
    fault: 'CUSTOMER',
    requestedAt: '2026-08-26T02:00:00.000Z',
    dueAt: '2026-08-28T02:00:00.000Z',
    itemCount: 1,
    totalQuantity: 2,
  },
  {
    type: 'RETURN',
    status: 'REFUNDED',
    fault: 'SELLER',
    requestedAt: '2026-08-28T03:00:00.000Z',
    dueAt: '2026-09-01T03:00:00.000Z',
    itemCount: 2,
    totalQuantity: 3,
  },
  {
    type: 'RETURN',
    status: 'RETURN_REQUESTED',
    fault: 'SELLER',
    requestedAt: '2026-08-31T04:00:00.000Z',
    dueAt: '2026-09-02T04:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'CANCEL',
    status: 'CANCEL_APPROVED',
    fault: 'CUSTOMER',
    requestedAt: '2026-09-01T05:00:00.000Z',
    dueAt: '2026-09-03T05:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'RETURN',
    status: 'RETURN_APPROVED',
    fault: 'CUSTOMER',
    requestedAt: '2026-09-03T06:00:00.000Z',
    dueAt: '2026-09-07T06:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'RETURN',
    status: 'RETURN_REJECTED',
    fault: 'CUSTOMER',
    requestedAt: '2026-09-03T07:00:00.000Z',
    dueAt: '2026-09-07T07:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'RETURN',
    status: 'PICKING_UP',
    fault: 'SELLER',
    requestedAt: '2026-09-04T08:00:00.000Z',
    dueAt: '2026-09-08T08:00:00.000Z',
    itemCount: 2,
    totalQuantity: 2,
  },
  {
    type: 'RETURN',
    status: 'RETURN_COMPLETED',
    fault: 'SELLER',
    requestedAt: '2026-09-04T09:00:00.000Z',
    dueAt: '2026-09-08T09:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
  {
    type: 'RETURN',
    status: 'INSPECTING',
    fault: 'CUSTOMER',
    requestedAt: '2026-09-04T10:00:00.000Z',
    dueAt: '2026-09-08T10:00:00.000Z',
    itemCount: 1,
    totalQuantity: 1,
  },
]

/** 씨앗에 자기 자리와 id 가 붙은 모양. */
export interface MockSellerClaimSeed extends SellerClaimSeedInput {
  readonly id: string
  readonly index: number
}

export const mockSellerClaimSeeds: readonly MockSellerClaimSeed[] = SEEDS.map((seed, index) => ({
  ...seed,
  id: claimIdAt(index),
  index,
}))

/**
 * 자리로 씨앗 하나. **없으면 던진다.**
 *
 * 픽스처가 「네 번째 줄의 상세」를 가리키는데 그 줄이 사라지면, 값을 지어내는 것보다
 * 모듈이 뜨지 않는 편이 낫다 — 지어내면 상세 픽스처가 목록에 없는 클레임을 그리고,
 * 그 어긋남은 아무 곳에서도 실패하지 않는다.
 */
export function mockSellerClaimSeedAt(index: number): MockSellerClaimSeed {
  const seed = mockSellerClaimSeeds[index]

  if (seed === undefined) throw new Error(`판매자 클레임 씨앗 ${String(index)} 번이 없다`)

  return seed
}

/** 저장소가 한 줄에 대해 들고 있는 전부. 상세와 목록이 같은 줄을 본다. */
export interface MockSellerClaimRow {
  item: SellerClaimListItem
  claim: Claim
  quote: ClaimRefundQuote
  /** 취소면 `null`. 수거·검수 라우트가 이 값으로 「반품인가」를 가른다. */
  returnDetail: ReturnDetail | null
}

/** 기한을 넘겼는가. **정각은 아직 기한 안이다** (`isClaimOverdue`). */
function isOverdue(dueAt: string): boolean {
  // 사전순이 곧 시간순이다 — 양쪽 다 밀리초까지 적힌 `Z` 시각이라 그렇다.
  return dueAt < MOCK_SELLER_CLAIM_NOW
}

export function sellerClaimStageOf(status: ClaimStatus): ClaimHandlingStage {
  return MOCK_SELLER_CLAIM_STAGES[status]
}

/** 정렬 축 위의 자리. 작을수록 먼저 온다 (`claimStageRank`). */
export function sellerClaimStageRank(stage: ClaimHandlingStage): number {
  return claimHandlingStages.indexOf(stage)
}

/**
 * 서버와 **같은 정렬** — `(단계 순위 오름차순, id 오름차순)`.
 *
 * 두 번째 칸이 `id` 오름차순인 것은 이 목록이 피드가 아니라 **작업 큐**이기
 * 때문이다. 그리고 그 방향이 공짜로 기한 순을 준다 — id 가 신청 시각과 같은 순서라
 * `id ASC` 가 곧 기한 임박 순이다.
 */
export function sortSellerClaims(
  items: readonly SellerClaimListItem[],
): readonly SellerClaimListItem[] {
  return [...items].sort((left, right) => {
    const byStage = sellerClaimStageRank(left.stage) - sellerClaimStageRank(right.stage)

    return byStage === 0 ? left.id.localeCompare(right.id) : byStage
  })
}

/** 어느 문으로 밟는가 (`claimActionRouteOf`). **`to` 만 보고 정할 수 없다.** */
export function sellerClaimRouteOf(from: ClaimStatus, to: ClaimStatus): ClaimActionRoute {
  if (from === 'RETURN_APPROVED' && to === 'PICKING_UP') return 'pickup'
  if (from === 'INSPECTING') return 'inspection'

  return 'transition'
}

/** 사유가 필수인가 — **거절 둘뿐이다** (`claimTransitionNeedsReason`). */
export function sellerClaimNeedsReason(to: ClaimStatus): boolean {
  return to === 'CANCEL_REJECTED' || to === 'RETURN_REJECTED'
}

/** 지금 판매자가 밟을 수 있는 걸음. 비어 있으면 종착이거나 시스템을 기다리는 자리다. */
export function sellerClaimActionsOf(status: ClaimStatus): readonly ClaimAction[] {
  return MOCK_SELLER_CLAIM_SELLER_STEPS[status].map((to) => ({
    to,
    route: sellerClaimRouteOf(status, to),
    requiresReason: sellerClaimNeedsReason(to),
  }))
}

/** 이 줄이 건 항목의 수량들. 두 줄짜리는 앞줄이 하나이고 나머지가 뒷줄이다. */
function quantitiesOf(seed: MockSellerClaimSeed): readonly number[] {
  if (seed.itemCount === 1) return [seed.totalQuantity]

  return [1, seed.totalQuantity - 1]
}

/** 신청한 때의 단가. 줄마다 달라야 환불 예정액이 전부 같은 숫자가 되지 않는다. */
function unitPriceOf(seed: MockSellerClaimSeed): number {
  return 19_000 + seed.index * 4_000
}

function snapshotOf(seed: MockSellerClaimSeed, line: number): ClaimItem['snapshot'] {
  const catalogueIndex = seed.index + line

  return {
    productId: `${ID_PREFIX}000000fc${pad2(seed.index + 1)}${pad2(line + 1)}`,
    productName: productAt(catalogueIndex),
    optionLabel: optionAt(catalogueIndex),
    sku: `LUMI-${pad2(seed.index + 1)}${pad2(line + 1)}`,
    // 절반은 사진이 없다. 「사진이 없었다」도 스냅샷의 일부라, 그 갈래를 그리지 않는
    // 화면은 목이 전부 사진을 줄 때 통과한다.
    thumbnailUrl:
      seed.index % 2 === 0
        ? `https://cdn.test.invalid/products/lumi-${pad2(seed.index + 1)}.webp`
        : null,
    brandName: MOCK_SELLER_CLAIM_BRAND,
  }
}

function claimItemsOf(seed: MockSellerClaimSeed): readonly ClaimItem[] {
  return quantitiesOf(seed).map((quantity, line) => ({
    id: `${ID_PREFIX}000000dd${pad2(seed.index + 1)}${pad2(line + 1)}`,
    orderItemId: `${ID_PREFIX}000000ee${pad2(seed.index + 1)}${pad2(line + 1)}`,
    variantId: `${ID_PREFIX}000000fb${pad2(seed.index + 1)}${pad2(line + 1)}`,
    snapshot: snapshotOf(seed, line),
    quantity,
    // **언제나 0** — 「0원을 돌려준다」가 아니라 「아직 계산하지 않았다」다
    // (`claimItemSchema`). 승인 전에 보여 줄 금액은 상세의 `quote` 가 답한다.
    refundAmount: 0,
  }))
}

/** 이 걸음을 누가 밟았나. 환불은 사람이 없고, 나머지는 판매자가 눌렀다. */
function actorOf(to: ClaimStatus): ClaimHistoryEntry['actor'] {
  return to === 'REFUNDED' ? 'SYSTEM' : 'SELLER'
}

/** 신청 시각에서 한 걸음마다 한 시간씩. 이력이 같은 순간에 겹쳐 쌓이지 않게 한다. */
function hoursAfter(instant: string, hours: number): string {
  return new Date(Date.parse(instant) + hours * 3_600_000).toISOString()
}

/**
 * 신청부터 지금까지의 이력.
 *
 * 해피 패스를 따라 걸어가다 목표에 닿으면 그 자취가 이력이고, 못 닿으면(거절)
 * 신청에서 **한 걸음**으로 간다 — 거절은 해피 패스 위에 없기 때문이다.
 */
function historyOf(seed: MockSellerClaimSeed): readonly ClaimHistoryEntry[] {
  const initial = INITIAL_STATUS[seed.type]
  const path: ClaimStatus[] = []

  let at: ClaimStatus = initial

  while (at !== seed.status) {
    const next = MAIN_LINE[at]

    if (next === null) break

    path.push(next)
    at = next
  }

  const walked = at === seed.status ? path : [seed.status]
  const created: ClaimHistoryEntry = {
    id: `${ID_PREFIX}000000fa${pad2(seed.index + 1)}${pad2(1)}`,
    fromStatus: null,
    toStatus: initial,
    reason: reasonTextOf(seed),
    // 신청은 사람이 한 일이다 (`ClaimService.create`).
    actor: 'BUYER',
    actorId: REQUESTED_BY_ID,
    occurredAt: seed.requestedAt,
  }

  return walked.reduce<ClaimHistoryEntry[]>(
    (entries, to, step) => [
      ...entries,
      {
        id: `${ID_PREFIX}000000fa${pad2(seed.index + 1)}${pad2(step + 2)}`,
        fromStatus: entries.at(-1)?.toStatus ?? initial,
        toStatus: to,
        reason: null,
        actor: actorOf(to),
        actorId: actorOf(to) === 'SYSTEM' ? null : REQUESTED_BY_ID,
        occurredAt: hoursAfter(seed.requestedAt, step + 1),
      },
    ],
    [created],
  )
}

function returnReasonOf(seed: MockSellerClaimSeed): ReturnReason {
  return RETURN_REASON_OF[seed.fault]
}

function reasonTextOf(seed: MockSellerClaimSeed): string {
  return seed.type === 'CANCEL' ? REASON_TEXT.CANCEL : REASON_TEXT[returnReasonOf(seed)]
}

export function sellerClaimOf(seed: MockSellerClaimSeed): Claim {
  return {
    id: seed.id,
    sellerOrderId: `${ID_PREFIX}00000000ab${pad2(seed.index + 1)}`,
    orderId: `${ID_PREFIX}00000000ba${pad2(seed.index + 1)}`,
    orderNumber: `20260904-000000${pad2(seed.index + 1)}`,
    type: seed.type,
    status: seed.status,
    reason: reasonTextOf(seed),
    fault: seed.fault,
    requestedById: REQUESTED_BY_ID,
    requestedAt: seed.requestedAt,
    updatedAt: seed.requestedAt,
    items: [...claimItemsOf(seed)],
    history: [...historyOf(seed)],
    // 관리자 개입의 세 칸 (TASK-0071). 판매자 콘솔의 씨앗에는 개입이 없다 — 있는
    // 것을 지어내면 「내 거절이 뒤집혔다」를 그리는 화면이 실 서버에서 절대 오지
    // 않는 조합에 맞춰진다.
    overturnsClaimId: null,
    overturnedByClaimIds: [],
    appeal: null,
  }
}

export function sellerClaimListItemOf(seed: MockSellerClaimSeed): SellerClaimListItem {
  const claim = sellerClaimOf(seed)
  const lead = claim.items[0]

  return {
    id: claim.id,
    sellerOrderId: claim.sellerOrderId,
    orderNumber: claim.orderNumber,
    type: claim.type,
    status: claim.status,
    stage: sellerClaimStageOf(claim.status),
    fault: claim.fault,
    requestedAt: claim.requestedAt,
    dueAt: seed.dueAt,
    overdue: isOverdue(seed.dueAt),
    itemCount: seed.itemCount,
    totalQuantity: seed.totalQuantity,
    // 「외 2건」은 붙이지 않는다 — 개수는 `itemCount` 로 따로 나가고 문장은 화면이
    // 만든다 (`sellerOrderHeadline` 과 같은 규칙).
    headline: lead?.snapshot.productName ?? '',
    thumbnailUrl: lead?.snapshot.thumbnailUrl ?? null,
  }
}

/** 회수·반송 운송장 하나. 번호의 모양은 배송의 발급기와 같다 (`trackingNumberFrom`). */
export function sellerReturnShipmentOf(
  seed: MockSellerClaimSeed,
  direction: ReturnShipmentDirection,
): ReturnShipment {
  const carrierCode = direction === 'PICKUP' ? 'GA' : 'HD'
  const serial = direction === 'PICKUP' ? '0000000000' : '1000000000'

  return {
    direction,
    carrierCode,
    carrierName: demoCarrierNames[carrierCode],
    trackingNumber: `DEMO-${carrierCode}-${serial}${pad2(seed.index + 1)}`,
    issuedAt: hoursAfter(seed.requestedAt, 2),
  }
}

/** 수거가 이미 일어난 자리인가. 그 뒤의 상태에는 회수 운송장이 있어야 한다. */
const PICKED_UP_STATUSES: readonly ClaimStatus[] = [
  'PICKING_UP',
  'INSPECTING',
  'RETURN_COMPLETED',
  'REFUNDED',
]

/** 검수가 끝난 자리인가. */
const INSPECTED_STATUSES: readonly ClaimStatus[] = ['RETURN_COMPLETED', 'REFUNDED']

/**
 * 반품의 부속 — 취소면 `null`.
 *
 * 금액 둘은 **신청 시점에 굳은 값**이라 어디서도 다시 계산하지 않는다
 * (`returnCostShare`): 단순 변심이면 반품비를 구매자가 물고(차감), 판매자 귀책이면
 * 원 배송비까지 돌려준다(가산).
 */
export function sellerReturnDetailOf(seed: MockSellerClaimSeed): ReturnDetail | null {
  if (seed.type === 'CANCEL') return null

  const reason = returnReasonOf(seed)
  const bySeller = seed.fault === 'SELLER'
  const inspected = INSPECTED_STATUSES.includes(seed.status)

  return {
    claimId: seed.id,
    reason,
    feeBearer: bySeller ? 'SELLER' : 'BUYER',
    returnShippingFee: RETURN_SHIPPING_FEE,
    originalShippingRefund: bySeller ? RETURN_SHIPPING_FEE : 0,
    returnShippingDeduction: bySeller ? 0 : RETURN_SHIPPING_FEE,
    // 하자·오배송은 사진이 필수이고 단순 변심에는 붙일 수 없다 (`returnPhotoDecision`).
    photoKeys: bySeller
      ? [`returns/${REQUESTED_BY_ID}/${ID_PREFIX}000000fd${pad2(seed.index + 1)}01.webp`]
      : [],
    shipments: PICKED_UP_STATUSES.includes(seed.status)
      ? [sellerReturnShipmentOf(seed, 'PICKUP')]
      : [],
    inspection: inspected
      ? { passed: true, note: null, inspectedAt: hoursAfter(seed.requestedAt, 4) }
      : null,
  }
}

/**
 * 지금 승인하면 나갈 금액.
 *
 * 배송비 몫의 **부호를 살려 둔다** — 「반품비 차감」과 「원 배송비 환불」을 하나로
 * 접으면 0원이 되어 아무 일도 없었던 것처럼 보인다 (`claimRefundQuoteSchema`).
 */
function sellerClaimQuoteOf(
  seed: MockSellerClaimSeed,
  claim: Claim,
  returnDetail: ReturnDetail | null,
): ClaimRefundQuote {
  const unitPrice = unitPriceOf(seed)
  const lines = claim.items.map((item) => ({
    orderItemId: item.orderItemId,
    units: item.quantity,
    amount: unitPrice * item.quantity,
  }))
  const itemsAmount = lines.reduce((sum, line) => sum + line.amount, 0)
  const shippingAmount =
    returnDetail === null
      ? 0
      : returnDetail.originalShippingRefund - returnDetail.returnShippingDeduction

  return {
    lines,
    itemsAmount,
    shippingAmount,
    // 환불은 청구로 뒤집히지 않는다 — 총액은 음수가 될 수 없다.
    total: Math.max(0, itemsAmount + shippingAmount),
  }
}

export function mockSellerClaimRowOf(seed: MockSellerClaimSeed): MockSellerClaimRow {
  const claim = sellerClaimOf(seed)
  const returnDetail = sellerReturnDetailOf(seed)

  return {
    item: sellerClaimListItemOf(seed),
    claim,
    quote: sellerClaimQuoteOf(seed, claim, returnDetail),
    returnDetail,
  }
}

/**
 * 상세 하나 — **한 응답이다**.
 *
 * 화면은 대상 항목·사진·환불 예정액·기한·버튼을 언제나 함께 그린다. 넷으로 나눠
 * 부르면 네 응답이 서로 다른 순간을 보고, 그때 판매자는 「1,000원」을 보면서
 * 「2,000원」을 승인한다.
 */
export function sellerClaimDetailOf(row: MockSellerClaimRow): SellerClaimDetailResponse {
  const { claim, item, quote, returnDetail } = row

  return {
    claim: {
      claim,
      stage: sellerClaimStageOf(claim.status),
      dueAt: item.dueAt,
      overdue: item.overdue,
      quote,
      // 돈이 **이미 나갔는가.** 나간 뒤에는 같은 필드가 예정액이 아니라 나간 액수를
      // 담는다 — 「지금 환불하면 얼마인가」를 끝난 클레임에 물으면 남은 수량이 없어
      // 0이 나오고, 그러면 종결된 상세가 「0원」을 보여 준다 (`sellerClaimDetailSchema`).
      refunded: claim.status === 'REFUNDED',
      actions: [...sellerClaimActionsOf(claim.status)],
      return:
        returnDetail === null
          ? null
          : {
              reason: returnDetail.reason,
              returnShippingDeduction: returnDetail.returnShippingDeduction,
              originalShippingRefund: returnDetail.originalShippingRefund,
              // 열쇠와 URL 을 함께 싣는다 — 화면이 열쇠에서 URL 을 만들면 배포
              // 설정이 프론트에 한 벌 더 생긴다 (`claimPhotoSchema`).
              photos: returnDetail.photoKeys.map((key) => ({
                key,
                url: `https://cdn.test.invalid/${key}`,
              })),
              pickupTrackingNumber:
                returnDetail.shipments.find((shipment) => shipment.direction === 'PICKUP')
                  ?.trackingNumber ?? null,
              sendBackTrackingNumber:
                returnDetail.shipments.find((shipment) => shipment.direction === 'SEND_BACK')
                  ?.trackingNumber ?? null,
            },
    },
  }
}

/**
 * 뱃지와 탭이 읽는 숫자 — **줄에서 센다**.
 *
 * 손으로 적으면 줄을 하나 옮길 때마다 두 곳을 맞춰야 하고, 어긋나면 화면이 「탭에는
 * 5건인데 목록에는 4줄」을 보여 준다. **0건인 상태도 0을 갖는다** — 안 채우면 화면이
 * 「아직 못 읽었다」와 「0건이다」를 구분할 수 없다.
 */
export function sellerClaimSummaryOf(items: readonly SellerClaimListItem[]): SellerClaimSummary {
  const counts = Object.fromEntries(claimStatuses.map((status) => [status, 0])) as Record<
    ClaimStatus,
    number
  >
  const stages = Object.fromEntries(claimHandlingStages.map((stage) => [stage, 0])) as Record<
    ClaimHandlingStage,
    number
  >

  for (const item of items) {
    counts[item.status] += 1
    stages[sellerClaimStageOf(item.status)] += 1
  }

  return { counts, stages, waiting: stages.WAITING }
}
