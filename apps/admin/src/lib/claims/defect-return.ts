import type {
  ClaimableItem,
  ClaimableResponse,
  ClaimItemInput,
  ClaimRefusal,
  CreateAdminClaimRequest,
  ReturnReason,
} from '@shopping/shared'
import {
  CLAIM_REASON_MAX_LENGTH,
  claimableResponseSchema,
  orderNumberSchema,
  returnReasons,
} from '@shopping/shared'

import { RETURN_FAULT } from './claim-console'

/**
 * 확정 후 하자 반품의 순수 판단 — **어디서 시작할 수 있고, 그 신청이 무엇을 보내는가**
 * (TASK-0071 F4).
 *
 * `claim-console.ts` 옆에 따로 있는 이유는 **묻는 질문이 다르기** 때문이다. 저쪽은
 * 「이 거절을 뒤집을 수 있는가」에 답하고 여기는 **「이 주문에서 관리자가 반품을 열 수
 * 있는가」**에 답한다 — 시작점이 클레임이 아니라 **주문**이고, 그래서 목록의 어느
 * 줄로도 이 화면에 닿을 수 없다(원본이 없는 개입이다).
 *
 * ## 이 파일이 하지 **않는** 것
 *
 * 규칙을 다시 적지 않는다. 「확정된 주문에 관리자만 반품을 열 수 있다」는
 * `apps/api/src/claims/admin-claim-rules.ts` 의 `adminClaimRouteFor` 가 정하고, 남은
 * 수량은 서버가 답한다(`claimableItemSchema.remainingQuantity`). 여기 있는 것은 그
 * 답들을 **화면이 갈라야 하는 상태로 접는 일**뿐이다.
 *
 * 접는 방법이 하나 재미있다. 실제 서버의 `GET /seller-orders/:id/claimable` 은
 * **구매자의 판정**(`claimEligibility`)으로 답하므로 확정된 몫에는
 * `refusal: 'confirmed'` 가 온다. 구매자에게 그것은 거절이지만 **관리자에게는 신호**다
 * — 「일반 반품은 끝났고 관리자 개입만 남았다」가 그 값의 뜻 그대로이기 때문이다
 * (`ClaimRefusal` 의 주석). 그래서 이 화면은 거절 하나를 진입 조건으로 읽는다.
 *
 * I/O 도 렌더도 없으므로 분기 전부가 단위 스펙에서 닿는다 (QUALITY-GATES 순수 로직 —
 * `vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/* ------------------------------------------------------------------------- *
 * 1. 대상을 무엇으로 찾는가
 * ------------------------------------------------------------------------- */

/**
 * 입력칸에 적힌 것이 무엇인가.
 *
 * ## 왜 주문번호가 여기서 **찾을 수 없는 값**인가
 *
 * 사람이 손에 들고 오는 것은 주문번호다(고객센터가 받아 적는 값이고, 클레임 목록의
 * 첫 칸도 그것이다). 그런데 **주문번호로 판매자 몫을 찾는 조회 라우트가 이 저장소에
 * 없다.** `GET /seller-orders?q=` 는 부르는 사람의 가게로 좁혀지고
 * (`SellerOrderListService.ownStore` 가 `sellerId` 없는 주체를 403 으로 끝낸다),
 * `GET /orders/:id` 는 번호가 아니라 주문 uuid 를 받는다. 관리자 라우트 중
 * 주문번호를 답하는 것은 `GET /admin/claims` 뿐인데, 그것은 **이미 클레임이 된 것**의
 * 목록이라 확정 후 하자 반품의 시작점에는 닿지 않는다.
 *
 * 그래서 화면은 **판매자 주문 식별자**로 열고, 주문번호가 적히면 그 사실을 말한다 —
 * 없는 계약을 프론트에만 만들어 두면 서버가 절대 답하지 않는 죽은 코드가 되고, 모킹
 * 위에서는 그것이 초록으로 통과한다 (CLAUDE.md 2장).
 *
 * **형식을 손으로 재지 않는다.** uuid 인지는 계약 자신의 스키마가 답하고
 * (`claimableResponseSchema.shape.sellerOrderId`), 주문번호인지는 `orderNumberSchema`
 * 가 답한다 — 그 둘이 곧 서버가 받아 주는 형식이라, 여기서 정규식을 한 벌 더 적으면
 * 언젠가 서버가 받는 값을 화면이 거절한다.
 */
export type DefectReturnTarget =
  /** 아직 아무것도 적지 않았다. */
  | 'empty'
  /** 판매자 주문 식별자. 이것만 조회로 이어진다 */
  | 'seller_order_id'
  /** 주문번호다. 맞는 값인데 **이것으로 찾는 길이 없다** */
  | 'order_number'
  /** 둘 다 아니다 */
  | 'unrecognised'

const SELLER_ORDER_ID = claimableResponseSchema.shape.sellerOrderId

export function defectReturnTargetOf(text: string): DefectReturnTarget {
  const value = text.trim()

  if (value === '') return 'empty'
  if (SELLER_ORDER_ID.safeParse(value).success) return 'seller_order_id'

  return orderNumberSchema.safeParse(value.toUpperCase()).success ? 'order_number' : 'unrecognised'
}

/* ------------------------------------------------------------------------- *
 * 2. 사유는 판매자 귀책 둘뿐이다
 * ------------------------------------------------------------------------- */

/**
 * 이 화면이 고를 수 있는 반품 사유 — **하자와 오배송**.
 *
 * **목록을 손으로 적지 않는다.** 「단순 변심으로 구매확정을 되돌릴 수는 없다」는
 * 문장이 뜻하는 것은 **귀책이 판매자인 사유만 남는다**이고, 그 대응표는 이미
 * {@link RETURN_FAULT} 에 있다(서버 쪽 `returnFaultOf` 의 거울). 여기서 두 값을
 * 다시 적으면 사유가 하나 느는 날 「귀책이 판매자인데 이 화면에는 없는 사유」가
 * 조용히 생기고, 반대로 구매자 귀책 사유가 늘면 그것이 이 목록에 섞인다.
 *
 * 규칙 자체는 서버의 것이기도 하다 — 확정된 주문의 반품은 판매자가 물어야 하는
 * 돈이 걸린 일이라 사진이 **필수**이고(`returnPhotoDecision`), 단순 변심은 애초에
 * 사진을 붙일 수 없다(`RETURN_PHOTO_NOT_ALLOWED`). 즉 이 목록은 서버가 받아 주는
 * 조합과 정확히 겹친다.
 */
export const DEFECT_RETURN_REASONS: readonly ReturnReason[] = returnReasons.filter(
  (reason) => RETURN_FAULT[reason] === 'SELLER',
)

/** 이 사유로 확정을 되돌릴 수 있는가. 화면이 고를 수 없는 값을 막는 마지막 자리다. */
export function isDefectReturnReason(reason: ReturnReason): boolean {
  return DEFECT_RETURN_REASONS.includes(reason)
}

/* ------------------------------------------------------------------------- *
 * 3. 이 몫에서 시작할 수 있는가
 * ------------------------------------------------------------------------- */

/**
 * 지금 이 몫에서 확정 후 하자 반품을 **시작할 수 없는 이유**, 되면 `null`.
 *
 * **비활성 버튼을 대신하는 값이다** — 이 콘솔이 「처리할 수 없다」를 문장으로 말하는
 * 규칙과 같다 (TASK-0063 4.1 · `claim-console.ts` 의 `interventionBlockOf`).
 *
 * 다섯을 나누는 기준은 **사람이 할 일이 다른가**다. 앞의 둘은 「여기가 아니라 저기서
 * 하면 된다」이고, 셋째는 기다리는 것이며, 넷째는 아무 데서도 할 수 없고, 다섯째는
 * 자리는 맞는데 **남은 수량이 없다.**
 */
export type DefectReturnBlock =
  /** 아직 구매확정 전이다. 구매자·판매자의 정상 경로가 열려 있다 */
  | 'claim_path_open'
  /** 배송 중. 취소하기엔 떠났고 반품하기엔 안 왔다 */
  | 'in_transit'
  /** 반품 기간이 지난 배송완료 몫. 확정 전이라 이 화면의 일이 아니다 */
  | 'window_closed'
  /** 결제 전이거나 이미 취소·반품으로 끝났다 */
  | 'not_claimable'
  /** 구매확정한 몫이 맞는데 **남은 수량이 하나도 없다** */
  | 'nothing_left'

/**
 * 확정이 아닌 거절 넷을 화면의 말로.
 *
 * `Record` 라 계약에 거절이 하나 늘면 **컴파일이 막는다.** 안 그러면 새 거절은
 * 「무슨 문장을 보여 줄지 아무도 정한 적 없는 상태」로 도착하고, 그때 화면은
 * `undefined` 를 그린다.
 *
 * `'confirmed'` 가 빠져 있는 것이 이 표의 요점이다 — 그것은 거절이 아니라 **이
 * 화면의 진입 조건**이라 아래에서 먼저 갈린다. 수량 관련 둘(`invalid_quantity` ·
 * `exceeds_remaining`)은 이 라우트가 답할 수 없는 값이지만(`ClaimService.claimable`
 * 이 1개·1개를 넣어 판정한다) 계약의 유니온에 있으므로 문장을 갖는다.
 */
const BLOCK_OF: Readonly<Record<Exclude<ClaimRefusal, 'confirmed'>, DefectReturnBlock>> = {
  in_transit: 'in_transit',
  window_closed: 'window_closed',
  not_claimable: 'not_claimable',
  invalid_quantity: 'not_claimable',
  exceeds_remaining: 'nothing_left',
}

export function defectReturnBlockOf(claimable: ClaimableResponse): DefectReturnBlock | null {
  // 아직 확정 전이다 — 구매자가 스스로 신청할 수 있는 몫이고, 그 경로가 정상이다.
  if (claimable.refusal === null) return 'claim_path_open'
  if (claimable.refusal !== 'confirmed') return BLOCK_OF[claimable.refusal]

  return claimable.items.every((item) => item.remainingQuantity === 0) ? 'nothing_left' : null
}

/** 아직 걸 수 있는 항목만. 남은 수량이 0인 줄은 고를 것이 없다. */
export function claimableTargets(claimable: ClaimableResponse): readonly ClaimableItem[] {
  return claimable.items.filter((item) => item.remainingQuantity > 0)
}

/**
 * 이 항목에 고를 수 있는 수량들 — **서버가 답한 잔여까지**.
 *
 * 화면이 `quantity - claimedQuantity` 를 계산하지 않는다. 그 뺄셈의 정의가 한 곳에만
 * 있어야 하고(계약의 `claimableItemSchema` 주석), 무엇보다 다른 창에서 방금 신청한
 * 것이 이 화면의 뺄셈에는 반영되지 않는다.
 */
export function defectQuantityChoices(item: ClaimableItem): readonly number[] {
  return Array.from({ length: item.remainingQuantity }, (_, index) => index + 1)
}

/* ------------------------------------------------------------------------- *
 * 4. 신청서
 * ------------------------------------------------------------------------- */

/**
 * 고른 것 — 항목 id → 수량.
 *
 * **키의 있고 없음이 곧 선택 여부다.** `{ selected, quantity }` 로 두면 「고르지
 * 않았는데 수량이 2인」 상태가 표현 가능해지고, 그 상태가 만들어지는 날 요청에 무엇이
 * 실릴지는 두 필드를 읽는 순서가 정한다 (구매자 신청서가 같은 이유로 같은 모양이다).
 */
export type DefectReturnSelection = Readonly<Record<string, number>>

/** 한 항목을 고르고, 또는 고르기를 물린다. 처음 고른 수량은 1이다. */
export function withDefectTarget(
  selection: DefectReturnSelection,
  orderItemId: string,
  chosen: boolean,
): DefectReturnSelection {
  if (!chosen) {
    const { [orderItemId]: _removed, ...rest } = selection

    return rest
  }

  return { ...selection, [orderItemId]: selection[orderItemId] ?? 1 }
}

/** 고른 항목의 수량을 바꾼다. 고르지 않은 항목은 건드리지 않는다. */
export function withDefectQuantity(
  selection: DefectReturnSelection,
  orderItemId: string,
  quantity: number,
): DefectReturnSelection {
  if (selection[orderItemId] === undefined) return selection

  return { ...selection, [orderItemId]: quantity }
}

/** 신청서가 지금 들고 있는 것. */
export interface DefectReturnDraft {
  readonly selection: DefectReturnSelection
  readonly returnReason: ReturnReason
  /** **올라간 것만.** 올라가는 중인 장은 아래 `uploading` 이 말한다 */
  readonly photoKeys: readonly string[]
  readonly uploading: boolean
  /** 개입 사유. 이력에 그대로 남는다 */
  readonly reason: string
}

export const EMPTY_DEFECT_RETURN_DRAFT: DefectReturnDraft = {
  selection: {},
  // 첫 값이 하자인 것은 이 화면이 존재하는 이유가 그것이기 때문이다. 오배송은
  // 고르면 되고, 단순 변심은 애초에 목록에 없다.
  returnReason: 'DEFECTIVE',
  photoKeys: [],
  uploading: false,
  reason: '',
}

/**
 * 아직 남은 문제들. 비어 있으면 보낼 수 있다.
 *
 * **서버 규칙을 한 벌 더 적는 것이 아니다.** 잔여도 경로도 서버가 답하고, 여기 있는
 * 것은 **요청이 되기 전의 것들** — 아무것도 안 고른 상태, 빈 사유, 붙지 않은 사진.
 * 계약이 그것들을 400 으로 거절하는데, 그 400 은 화면이 「어느 칸이 비었는지」로 바꿔
 * 말할 수 없는 모양으로 온다.
 *
 * 배열인 것은 **여럿이 동시에 비어 있을 수 있기** 때문이다. 하나만 돌려주면 사람은
 * 항목을 고르고 나서야 사진이 필요하다는 것을 알게 된다.
 */
export type DefectReturnIssue =
  | 'no_items'
  | 'reason_required'
  | 'reason_too_long'
  /** 하자·오배송에는 사진이 **필수**다 (`returnPhotoDecision`) */
  | 'photo_required'
  /** 아직 올라가는 중인 장이 있다. 지금 보내면 그 장이 빠진 신청이 된다 */
  | 'photo_uploading'

export function defectReturnIssues(draft: DefectReturnDraft): readonly DefectReturnIssue[] {
  const issues: DefectReturnIssue[] = []
  const reason = draft.reason.trim()

  if (Object.keys(draft.selection).length === 0) issues.push('no_items')

  if (reason.length === 0) issues.push('reason_required')
  else if (reason.length > CLAIM_REASON_MAX_LENGTH) issues.push('reason_too_long')

  // 상한은 여기 없다. 여섯째 장은 고르는 자리에서 이미 거절되고
  // (`return-photos.ts` 의 `checkReturnPhoto`), 상한을 두 곳에 두면 뒤엣것은
  // **닿을 수 없는 규칙**이 된다 — 계약이 같은 이유로 `.max()` 를 갖지 않는다.
  if (draft.photoKeys.length === 0) issues.push('photo_required')

  if (draft.uploading) issues.push('photo_uploading')

  return issues
}

/**
 * 고른 것을 요청의 줄로. 순서는 목록에 보이는 순서 그대로다.
 *
 * `filter` + `map` 이 아니라 `flatMap` 인 것은 **닿을 수 없는 분기를 만들지 않기**
 * 위해서다. 걸러 낸 뒤에도 타입은 그 값이 있는지 모르므로 `?? 0` 같은 대비가 하나
 * 붙는데, 그 갈래에는 어떤 검사도 닿을 수 없고 그러면 이 파일의 분기 100% 가 거짓이
 * 된다 (`return-rules.ts` 가 같은 규칙을 같은 말로 적어 두었다).
 */
export function defectReturnLines(
  selection: DefectReturnSelection,
  items: readonly ClaimableItem[],
): readonly ClaimItemInput[] {
  return items.flatMap((item) => {
    const quantity = selection[item.orderItemId]

    return quantity === undefined ? [] : [{ orderItemId: item.orderItemId, quantity }]
  })
}

/**
 * 신청서 하나를 **관리자가 대신 내는 개입**으로.
 *
 * **`overturnsClaimId` 가 `null` 인 것이 이 함수의 전부다.** 거절을 뒤집는 개입과
 * 같은 라우트를 지나고(`POST /admin/claims`), 서버에서 갈리는 자리도 그 한 칸이다
 * (`AdminClaimService.force`) — 원본이 없으니 뒤집을 것도, 함께 닫을 이의도 없다.
 *
 * `fault` 가 `null` 인 것은 계약의 요구다. 반품의 귀책은 요청이 주장하는 값이 아니라
 * **사유가 정하는 값**이고(`returnFaultOf`), 둘 다 실으면 「오배송인데 구매자 귀책」이
 * 표현 가능해진다 (`createAdminClaimRequestSchema` 의 refine).
 */
export function defectReturnRequestOf(
  sellerOrderId: string,
  items: readonly ClaimableItem[],
  draft: DefectReturnDraft,
): CreateAdminClaimRequest {
  return {
    sellerOrderId,
    items: [...defectReturnLines(draft.selection, items)],
    reason: draft.reason.trim(),
    fault: null,
    return: { returnReason: draft.returnReason, photoKeys: [...draft.photoKeys] },
    overturnsClaimId: null,
  }
}
