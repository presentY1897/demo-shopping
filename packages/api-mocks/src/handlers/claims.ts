import type {
  Claim,
  ClaimableItem,
  ClaimFault,
  DomainErrorCode,
  ClaimHistoryEntry,
  ClaimItem,
  ClaimRefusal,
  ClaimStatus,
  ClaimType,
  CreateClaimRequest,
  OrderItem,
  OrderStatus,
  ReturnReason,
} from '@shopping/shared'
import {
  claimableResponseSchema,
  claimResponseSchema,
  createClaimRequestSchema,
  RETURN_PHOTO_MAX_COUNT,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { shopperPaidClaimable, shopperWindowClosedClaimable } from '../fixtures/claims'
import { shopperMixedOrder } from '../fixtures/orders'
import { sessionBuyer } from '../fixtures/session'
import { mockPaths } from '../paths'
import {
  MOCK_CLAIM_ID,
  MOCK_CLAIM_ORDER_ID,
  MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT,
  MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
  MOCK_CLAIM_SELLER_ORDER_IDS,
} from './claim-contract'
import { MOCK_ORDER_NOW } from './order-contract'
import { shopperBundleOf } from './orders'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 취소·반품 신청 (TASK-0066 의 화면이 읽고 쓴다).
 *
 * **상태를 갖는다** — `handlers/orders.ts` 와 같은 이유다. 이 화면이 묻는 것이
 * 「신청하고 나면 잔여 수량이 줄어드는가」이고, 얼어붙은 픽스처는 거기 답하지
 * 못한다: 세 개 중 하나를 걸고 다시 물으면 남은 것이 둘이어야 하고, 그 둘을 넘겨
 * 신청하면 **지금의 잔여**를 달고 거절이 와야 한다.
 *
 * ## 판단을 세 번 적지 않는다
 *
 * 「무엇을 신청할 수 있나」의 답은 주문 상태가 정한다. 그 표는
 * `apps/api/src/claims/claim-rules.ts` 에 있고, 이 파일의 {@link routeFor} 와
 * {@link eligibilityOf} 는 그것을 **같은 순서로** 옮겨 놓은 것이다. 순서가 곧
 * 사람에게 할 말의 순서라, 배송 중인 주문에 「수량이 모자랍니다」라고 답하는 대역은
 * 화면을 틀린 방향으로 고치게 만든다 — 그 사람은 수량을 고쳐 다시 시도한다.
 *
 * 거절의 **코드와 상태와 필드**도 실제 서버의 것이다 (`claim.service.ts` 의
 * `refusal`). 화면이 `error.code` 로 분기하므로(TASK-0117), 대역이 코드를 빼먹으면
 * 화면은 문장을 읽는 코드를 갖게 되고 그 코드는 실 서버에서 한 번도 안 쓰인다.
 *
 * ## 재현하지 않는 것
 *
 * 전이(`POST /claims/:id/transitions`)·목록·판매자의 승인. 이 대역이 서는 화면은
 * 구매자의 신청이고, 상태 머신 전체를 흉내 내면 QUALITY-GATES 6장 이 금지하는
 * 「더 약한 두 번째 구현」이 된다 — 실제 규칙은 실 PostgreSQL 에 대고 도는
 * `apps/api` 의 검사가 증명한다.
 *
 * **자동 승인만은 예외다.** `PAID` 인 몫의 취소가 승인을 기다리지 않는다는 것이
 * TASK-0066 의 요구사항이고(F1 · 4장), 그것은 화면에서 「신청했습니다」와
 * 「취소되었습니다」를 가르는 유일한 차이다.
 *
 * ## 반품의 부속도 같은 이유로 판정한다 (TASK-0067)
 *
 * 계약이 합쳐진 뒤로 이 라우트는 **완전한 반품**을 만든다 — 사유와 사진이 신청서의
 * 칸이다(`createClaimRequestSchema`). 그래서 경로와 부속이 맞는지, 이 사유에 사진이
 * 필요한지를 대역도 판정한다. 여기서 받아 주면 화면이 사진 없는 하자 반품을 보내고도
 * 모든 프론트 검사를 통과한 뒤 **실 서버에서만** 400 을 받는다.
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

/**
 * 주문 대역에 없는 두 몫. `fixtures/claims.ts` 가 왜 둘뿐인지를 적어 두었다.
 *
 * 나머지 다섯은 주문 저장소에서 **요청이 올 때마다** 읽는다. 리셋 때 한 번 베껴
 * 두면 그 사이에 옮겨진 주문 상태를 이 대역만 모르게 되고, 화면은 상세에서
 * 배송완료인 묶음을 신청 화면에서 준비중으로 보게 된다.
 */
const SEEDED_BUNDLES: Readonly<
  Record<string, { readonly status: OrderStatus; readonly items: readonly ClaimableItem[] }>
> = {
  [MOCK_CLAIM_SELLER_ORDER_IDS.paid]: { status: 'PAID', items: shopperPaidClaimable.items },
  [MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed]: {
    status: 'DELIVERED',
    items: shopperWindowClosedClaimable.items,
  },
}

/**
 * 반품을 받아 주는 기간의 끝 (R2). 배송완료한 몫에만 있다.
 *
 * **대역이 「지금 + 이레」로 계산하지 않는다.** 기간의 축은 배포 설정
 * (`FULFILLMENT_PACE`)이고 어떤 응답에도 실리지 않으므로, 계산으로 만든 값은 이
 * 파일을 읽는 사람이 머릿속에서 실행해 봐야 알 수 있다 — 픽스처가 시각을 고정하는
 * 것과 같은 이유다.
 */
const RETURN_WINDOW_ENDS_AT: Readonly<Record<string, string>> = {
  [MOCK_CLAIM_SELLER_ORDER_IDS.delivered]: MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
  [MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed]: MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT,
}

/**
 * 사유 셋을 귀책 둘로 접는다 (`return-rules.ts` 의 `returnFaultOf`).
 *
 * **대역이 이것을 다시 적는 이유**는 화면이 답의 `fault` 를 그리기 때문이다. 요청에
 * 그 값이 없으므로(반품은 사유만 보낸다) 대역이 접지 않으면 답에 실을 값이 없고,
 * 임의로 하나를 고르면 화면은 실 서버가 절대 주지 않는 조합을 그리게 된다 —
 * 「오배송인데 구매자 귀책」이 바로 그 조합이다.
 */
const FAULT_OF: Readonly<Record<ReturnReason, ClaimFault>> = {
  CHANGE_OF_MIND: 'CUSTOMER',
  DEFECTIVE: 'SELLER',
  WRONG_ITEM: 'SELLER',
}

/**
 * 이 사유에 사진이 필요한가 (`return-rules.ts` 의 `PHOTO_RULE`).
 *
 * **셋이 아니라 둘인 것이 이 표의 결정이다.** 「선택」을 두면 두 사유 모두에서 없는
 * 상태가 정상이 되어, 근거 없이 판매자에게 돈을 물릴 수 있으면서 아무도 보지 않는
 * 이미지도 쌓인다.
 */
const PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

/** 각 경로가 시작하는 자리. 신청은 전이가 아니라 **생성**이다 (`CLAIM_INITIAL`). */
const INITIAL_STATUS: Readonly<Record<ClaimType, ClaimStatus>> = {
  CANCEL: 'CANCEL_REQUESTED',
  RETURN: 'RETURN_REQUESTED',
}

/** 클레임 항목과 이력 줄의 id 앞머리. 클레임 자신은 `MOCK_CLAIM_ID` 를 민다. */
const CLAIM_ITEM_ID_PREFIX = '019596d0-1f1c-7c2e-9a0e-7b'
const CLAIM_HISTORY_ID_PREFIX = '019596d0-1f1c-7c2e-9a0e-7c'

interface ClaimStore {
  /** 살아 있는 클레임이 **주문 항목마다** 잡고 있는 수량. 잔여는 이것의 결과다. */
  readonly holds: ReadonlyMap<string, number>
  readonly claims: readonly Claim[]
}

const EMPTY: ClaimStore = { claims: [], holds: new Map() }

let store: ClaimStore = EMPTY

/** 다음 신청 하나를 실패시킨다 (U6). */
let nextClaimFailure: MockApiError | null = null

export function failNextClaim(error?: MockApiError): void {
  nextClaimFailure =
    error ??
    new MockApiError(409, '지금 상태에서는 신청할 수 없어요.', { code: 'CLAIM_NOT_CLAIMABLE' })
}

/**
 * 신청을 한 건도 하지 않은 상태로.
 *
 * 잡아 둔 수량까지 함께 놓는다 — 클레임만 지우면 「아무 신청도 없는데 잔여가 둘」인
 * 주문이 남고, 그것은 다음 검사가 파일 안의 순서 때문에 빨개지는 모양이다.
 */
export function resetClaimStore(): void {
  nextClaimFailure = null
  store = EMPTY
}

/** 한 몫이 지금 무엇인가 — 상태와, 잔여까지 계산된 줄들. */
interface ClaimBundle {
  readonly id: string
  readonly status: OrderStatus
  readonly items: readonly ClaimableItem[]
}

function bundleOf(sellerOrderId: string): ClaimBundle {
  const seeded = SEEDED_BUNDLES[sellerOrderId]

  if (seeded !== undefined) {
    return { id: sellerOrderId, status: seeded.status, items: seeded.items.map(held) }
  }

  const bundle = shopperBundleOf(sellerOrderId)

  if (bundle === undefined) throw new MockApiError(404, '주문을 찾을 수 없어요.')

  return {
    id: sellerOrderId,
    status: bundle.status,
    items: bundle.items.map((item) => held(claimableFrom(item))),
  }
}

/** 주문 항목을 「몇 개까지 신청할 수 있나」의 모양으로 (`toClaimableItem` 과 같은 사상). */
function claimableFrom(item: OrderItem): ClaimableItem {
  return {
    orderItemId: item.id,
    variantId: item.variantId,
    snapshot: item.snapshot,
    quantity: item.quantity,
    claimedQuantity: 0,
    remainingQuantity: item.quantity,
  }
}

/**
 * 저장소가 잡고 있는 만큼을 덜어 낸 줄.
 *
 * **뺄셈을 대역이 한다.** `remainingQuantity` 가 계약에 있는 이유가 그 정의를 한
 * 곳에만 두기 위해서인데(F8), 대역이 `claimedQuantity` 만 답하면 화면은 결국
 * 자기가 빼는 코드를 갖게 되고 그 코드는 실 서버에서 한 번도 안 쓰인다.
 */
function held(item: ClaimableItem): ClaimableItem {
  const claimedQuantity = item.claimedQuantity + (store.holds.get(item.orderItemId) ?? 0)

  return {
    ...item,
    claimedQuantity,
    remainingQuantity: Math.max(0, item.quantity - claimedQuantity),
  }
}

/** 주문 상태가 정하는 경로 — `claim-rules.ts` 의 `claimRouteFor` 와 **같은 표**. */
function routeFor(status: OrderStatus): ClaimType | null {
  if (status === 'PAID' || status === 'PREPARING') return 'CANCEL'
  if (status === 'DELIVERED') return 'RETURN'

  return null
}

/**
 * 반품 기간 안인가.
 *
 * 문자열끼리 비교한다 — 양쪽 다 밀리초까지 적힌 `Z` 시각이라 사전순이 곧 시간순이고,
 * `Date` 를 만들면 이 대역에만 있는 두 번째 시계가 생긴다.
 *
 * 기간의 끝을 모르는 몫은 **지난 것으로 친다.** 언제 도착했는지 모르는 물건에
 * 「아직 기간이 남았다」고 답할 근거가 없다 (`withinReturnWindow` 가 `deliveredAt`
 * 이 없는 주문을 그렇게 다룬다).
 */
function withinReturnWindow(sellerOrderId: string): boolean {
  const endsAt = RETURN_WINDOW_ENDS_AT[sellerOrderId]

  return endsAt !== undefined && MOCK_ORDER_NOW <= endsAt
}

type ClaimEligibility =
  | { readonly outcome: 'allowed'; readonly type: ClaimType }
  | { readonly outcome: 'refused'; readonly reason: ClaimRefusal }

/**
 * 이 신청을 받아도 되는가 — `claim-rules.ts` 의 `claimEligibility` 와 **같은 순서**다.
 *
 * 앞의 것이 어긋나면 뒤는 볼 필요가 없다. 기간을 상태보다 뒤에 보는 것까지 같다 —
 * 확정한 주문에 「기간이 지났습니다」는 반쯤 맞는 말이라 더 나쁘고, 기다렸으면
 * 됐다는 뜻으로 읽힌다.
 */
function eligibilityOf(
  bundle: ClaimBundle,
  requested: number,
  remaining: number,
): ClaimEligibility {
  const refused = (reason: ClaimRefusal): ClaimEligibility => ({ outcome: 'refused', reason })

  if (bundle.status === 'SHIPPED') return refused('in_transit')
  if (bundle.status === 'CONFIRMED') return refused('confirmed')

  const type = routeFor(bundle.status)

  if (type === null) return refused('not_claimable')
  if (type === 'RETURN' && !withinReturnWindow(bundle.id)) return refused('window_closed')
  if (requested <= 0) return refused('invalid_quantity')
  if (requested > remaining) return refused('exceeds_remaining')

  return { outcome: 'allowed', type }
}

/**
 * 거절 여섯을, 실제 서버가 내는 것과 **같은 코드·상태·필드**로.
 *
 * `claim.service.ts` 의 `refusal()` 을 그대로 옮긴 것이다. 하나로 묶지 않는 이유는
 * 부르는 쪽이 할 일이 다르기 때문이다 — 배송 중이면 기다리면 되고, 확정했으면
 * 관리자를 찾아야 하며, 수량이 모자라면 **숫자를 고치면 된다.** 마지막만이 화면이
 * 「N개까지 신청할 수 있어요」로 바꿔 말할 수 있는 거절이라 `params.remaining` 을
 * 달고 나간다.
 */
function refusalError(reason: ClaimRefusal, remaining: number): MockApiError {
  switch (reason) {
    case 'in_transit':
      return new MockApiError(409, '배송 중에는 취소도 반품도 할 수 없어요.', {
        code: 'CLAIM_IN_TRANSIT',
      })
    case 'confirmed':
      return new MockApiError(409, '구매확정한 주문은 고객센터로 문의해 주세요.', {
        code: 'CLAIM_ORDER_CONFIRMED',
      })
    case 'window_closed':
      return new MockApiError(409, '반품할 수 있는 기간이 지났어요.', {
        code: 'CLAIM_WINDOW_CLOSED',
      })
    case 'not_claimable':
      return new MockApiError(409, '지금 상태에서는 신청할 수 없어요.', {
        code: 'CLAIM_NOT_CLAIMABLE',
      })
    case 'exceeds_remaining':
      return new MockApiError(409, '신청할 수 있는 수량을 넘었어요.', {
        code: 'CLAIM_EXCEEDS_REMAINING',
        field: 'items',
        params: { remaining },
      })
    case 'invalid_quantity':
      return new MockApiError(400, '수량은 1개 이상이어야 해요.', {
        code: 'CLAIM_INVALID_QUANTITY',
        field: 'items',
      })
  }
}

/** 신청에 걸린 줄 하나 — 무엇을 몇 개. */
interface ClaimLine {
  readonly item: ClaimableItem
  readonly quantity: number
}

/**
 * 요청한 줄을 이 몫의 항목에 맞춘다.
 *
 * 남의 주문 항목 id 를 섞어 보낸 요청이 여기서 끝난다. 조용히 무시하면 사람이 고른
 * 것과 다른 것이 신청되고, 그것은 화면과 실제가 갈리는 가장 나쁜 모양이다.
 *
 * **상태 거절보다 먼저 온다.** 실제 서버도 항목을 먼저 맞추고 나서 판단으로
 * 들어간다 (`ClaimService.create` 의 `linesOf`) — 있지도 않은 항목에 「배송
 * 중입니다」라고 답하면 부르는 쪽은 자기 요청이 잘못됐다는 것을 영영 모른다.
 */
function linesOf(bundle: ClaimBundle, input: CreateClaimRequest): readonly ClaimLine[] {
  const byId = new Map(bundle.items.map((item) => [item.orderItemId, item]))

  return input.items.map((line) => {
    const item = byId.get(line.orderItemId)

    if (item === undefined) {
      throw new MockApiError(400, '이 주문에 없는 항목이 있어요.', {
        code: 'CLAIM_ITEM_MISSING',
        field: 'items',
      })
    }

    return { item, quantity: line.quantity }
  })
}

/** 몇 번째 신청인가. `MOCK_CLAIM_ID` 가 첫 건이고 그 뒤는 하나씩 민 것이다. */
function claimIdOf(sequence: number): string {
  return `${MOCK_CLAIM_ID.slice(0, -4)}${String(sequence).padStart(4, '0')}`
}

/** 클레임 안에서 자라는 줄의 id. 신청 번호와 줄 번호를 이어 붙여 겹치지 않게 한다. */
function rowId(prefix: string, sequence: number, index: number): string {
  return `${prefix}${String(sequence).padStart(5, '0')}${String(index).padStart(5, '0')}`
}

/**
 * 신청 하나를 만든다.
 *
 * **상태는 몫의 상태가 정한다.** `PAID` 는 판매자가 아직 아무것도 하지 않은
 * 상태라 승인을 기다릴 이유가 없고(TASK-0066 4장), 그래서 이력이 두 줄로 태어난다 —
 * 사람이 신청한 줄과, **사람이 없는** 승인 줄이다. 그 둘째 줄의 `actor` 가
 * `SYSTEM` 이고 `actorId` 가 `null` 인 것이 「자동으로 승인됐다」의 기록이다.
 *
 * 첫 줄의 주체는 `BUYER` 다. 신청은 사람이 한 일이고, 실제 서버도 생성 이력에
 * 부른 사람을 적는다 (`ClaimService.create`).
 */
function claimFrom(
  bundle: ClaimBundle,
  type: ClaimType,
  lines: readonly ClaimLine[],
  input: CreateClaimRequest,
): Claim {
  const sequence = store.claims.length + 1
  const initial = INITIAL_STATUS[type]
  const autoApproved = bundle.status === 'PAID'
  const requested: ClaimHistoryEntry = {
    id: rowId(CLAIM_HISTORY_ID_PREFIX, sequence, 1),
    fromStatus: null,
    toStatus: initial,
    reason: input.reason,
    actor: 'BUYER',
    actorId: sessionBuyer.user.id,
    occurredAt: MOCK_ORDER_NOW,
  }
  const approved: ClaimHistoryEntry = {
    id: rowId(CLAIM_HISTORY_ID_PREFIX, sequence, 2),
    fromStatus: initial,
    toStatus: 'CANCEL_APPROVED',
    reason: null,
    actor: 'SYSTEM',
    actorId: null,
    occurredAt: MOCK_ORDER_NOW,
  }

  return {
    id: claimIdOf(sequence),
    sellerOrderId: bundle.id,
    orderId: MOCK_CLAIM_ORDER_ID,
    orderNumber: shopperMixedOrder.order.orderNumber,
    type,
    status: autoApproved ? 'CANCEL_APPROVED' : initial,
    reason: input.reason,
    fault: faultOf(input),
    requestedById: sessionBuyer.user.id,
    requestedAt: MOCK_ORDER_NOW,
    updatedAt: MOCK_ORDER_NOW,
    items: lines.map((line, index) => claimItemFrom(line, sequence, index + 1)),
    history: autoApproved ? [requested, approved] : [requested],
  }
}

/**
 * 걸린 줄 하나.
 *
 * `refundAmount` 는 **언제나 0** 이다 — 「0원을 돌려준다」가 아니라 **「아직 계산하지
 * 않았다」**이고, 계산은 TASK-0068 의 것이다. 계약 주석에 그렇게 적혀 있으므로 대역이
 * 그럴듯한 금액을 지어내면 화면은 실 서버에서 절대 오지 않는 값에 맞춰진다.
 */
function claimItemFrom(line: ClaimLine, sequence: number, index: number): ClaimItem {
  return {
    id: rowId(CLAIM_ITEM_ID_PREFIX, sequence, index),
    orderItemId: line.item.orderItemId,
    variantId: line.item.variantId,
    snapshot: line.item.snapshot,
    quantity: line.quantity,
    refundAmount: 0,
  }
}

/**
 * 경로와 부속이 맞는가, 그리고 사진이 규칙에 맞는가 (`ClaimService.create`).
 *
 * **순서가 답의 우선순위다.** 경로가 어긋난 요청에 「사진을 첨부해 주세요」라고
 * 답하면 사람은 사진을 붙여 다시 보내고 또 거절당한다.
 */
function assertParts(type: ClaimType, input: CreateClaimRequest): void {
  if (type === 'RETURN' && input.return === null) {
    throw new MockApiError(409, '이 주문은 반품만 신청할 수 있어요.', {
      code: 'CLAIM_NOT_CLAIMABLE',
      field: 'return',
    })
  }
  if (type === 'CANCEL' && input.return !== null) {
    throw new MockApiError(409, '이 주문은 취소만 신청할 수 있어요.', {
      code: 'CLAIM_NOT_CLAIMABLE',
      field: 'fault',
    })
  }
  if (input.return !== null) assertPhotos(input.return.returnReason, input.return.photoKeys)
}

/** 사진 거절 다섯. 코드가 저마다 다른 것이 이 도메인의 요구다 (TASK-0067). */
function assertPhotos(reason: ReturnReason, keys: readonly string[]): void {
  const refuse = (
    code: DomainErrorCode,
    message: string,
    params?: Record<string, number>,
  ): never => {
    throw new MockApiError(400, message, { code, field: 'return.photoKeys', params })
  }

  if (PHOTO_RULE[reason] === 'forbidden') {
    if (keys.length > 0) {
      refuse('RETURN_PHOTO_NOT_ALLOWED', '단순 변심 반품에는 사진을 첨부할 수 없어요.')
    }

    return
  }

  if (keys.length === 0) {
    refuse('RETURN_PHOTO_REQUIRED', '하자·오배송 반품에는 사진을 한 장 이상 첨부해 주세요.')
  }
  if (keys.length > RETURN_PHOTO_MAX_COUNT) {
    refuse('RETURN_PHOTO_TOO_MANY', '사진은 최대 {max}장까지 첨부할 수 있어요.', {
      max: RETURN_PHOTO_MAX_COUNT,
    })
  }
  if (new Set(keys).size !== keys.length) {
    refuse('RETURN_PHOTO_DUPLICATE', '같은 사진을 두 번 첨부할 수 없어요.')
  }
  // 남의 열쇠는 대역이 가리지 않는다 — 이 대역에는 사람이 하나뿐이라 「남」이 없다.
  // 실 서버는 접두어로 판정한다 (`isOwnPhotoKey`).
}

/**
 * 이 신청의 귀책 — 취소는 사람이 고른 것, 반품은 사유에서 접은 것.
 *
 * 마지막 갈래는 계약이 이미 막는다(`fault` 와 `return` 은 둘 중 하나다). 그래도
 * 두는 것은 타입이 그 사실을 모르기 때문이고, 값을 지어내는 대신 그 사실을 말한다.
 */
function faultOf(input: CreateClaimRequest): ClaimFault {
  if (input.return !== null) return FAULT_OF[input.return.returnReason]
  if (input.fault !== null) return input.fault

  throw new MockApiError(400, '취소는 귀책을, 반품은 사유를 보내야 해요.', {
    code: 'INVALID',
    field: 'fault',
  })
}

/** 잡은 수량을 더한 새 표. 다시 물으면 잔여가 그만큼 줄어 있어야 한다. */
function holdsAfter(lines: readonly ClaimLine[]): ReadonlyMap<string, number> {
  const holds = new Map(store.holds)

  for (const line of lines) {
    holds.set(line.item.orderItemId, (holds.get(line.item.orderItemId) ?? 0) + line.quantity)
  }

  return holds
}

function claimById(id: string): Claim {
  const found = store.claims.find((claim) => claim.id === id)

  if (found === undefined) throw new MockApiError(404, '클레임을 찾을 수 없어요.')

  return found
}

export const claimHandlers: readonly RequestHandler[] = [
  /**
   * 이 몫에 지금 무엇을 몇 개까지 신청할 수 있나 (F8).
   *
   * **수량 갈래를 지나가게 하려고 1·1 로 묻는다.** 이 답이 말해야 하는 것은
   * 「주문이 무엇을 열어 주는가」이고 항목별 수량은 `items` 가 말한다 — 실제 서버가
   * 같은 자리에서 같은 이유로 그렇게 한다 (`ClaimService.claimable`).
   */
  http.get(mockPaths.claimable, ({ params }) =>
    answering(() => {
      const bundle = bundleOf(String(params.id))
      const decision = eligibilityOf(bundle, 1, 1)

      return HttpResponse.json(
        defineFixture(claimableResponseSchema, {
          sellerOrderId: bundle.id,
          type: decision.outcome === 'allowed' ? decision.type : null,
          refusal: decision.outcome === 'refused' ? decision.reason : null,
          // 반품 경로에서만 뜻이 있다. 취소는 물건이 아직 떠나지 않아 기다릴 것이
          // 없다 — 기간이 지난 몫도 배송완료라서 값은 그대로 실린다.
          returnWindowEndsAt:
            routeFor(bundle.status) === 'RETURN'
              ? (RETURN_WINDOW_ENDS_AT[bundle.id] ?? null)
              : null,
          items: [...bundle.items],
        }),
      )
    }),
  ),

  /**
   * 신청한다 (F1 ~ F6).
   *
   * 순서가 규칙이다 — 항목을 맞추고, `claimEligibility` 하나로 판단하고, 잡은 만큼
   * 수량을 눌러 둔 뒤에 신청서를 답한다. 판단을 여기서 다시 적지 않는 이유는 거절
   * 여섯의 순서가 곧 사람에게 할 말의 순서이기 때문이다.
   */
  http.post(mockPaths.claims, ({ request }) =>
    answering(async () => {
      if (nextClaimFailure !== null) {
        const failure = nextClaimFailure

        nextClaimFailure = null
        throw failure
      }

      const input = await readBody(request, createClaimRequestSchema)
      const bundle = bundleOf(input.sellerOrderId)
      const lines = linesOf(bundle, input)

      let type: ClaimType | null = null

      for (const line of lines) {
        const decision = eligibilityOf(bundle, line.quantity, line.item.remainingQuantity)

        if (decision.outcome === 'refused') {
          throw refusalError(decision.reason, line.item.remainingQuantity)
        }

        type = decision.type
      }

      // 줄이 하나도 없는 요청은 계약이 이미 막는다(`items` 는 `min(1)`). 그래서 이
      // 갈래는 컴파일러를 위한 것이고, 값을 지어내는 대신 그 사실을 말한다.
      if (type === null) throw new MockApiError(400, '신청할 항목이 없어요.')

      assertParts(type, input)

      const answer = defineFixture(claimResponseSchema, {
        claim: claimFrom(bundle, type, lines, input),
      })

      store = { claims: [...store.claims, answer.claim], holds: holdsAfter(lines) }

      return HttpResponse.json(answer)
    }),
  ),

  /** 클레임 하나. 신청을 마친 화면이 곧바로 여기로 온다. */
  http.get(mockPaths.claim, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(claimResponseSchema, { claim: claimById(String(params.id)) }),
      ),
    ),
  ),
]
