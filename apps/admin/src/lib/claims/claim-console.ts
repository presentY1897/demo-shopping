import type {
  AdminClaimListQuery,
  Claim,
  ClaimFault,
  ClaimHandlingStage,
  ClaimStatus,
  ClaimType,
  CreateAdminClaimRequest,
  ReturnReason,
} from '@shopping/shared'

/**
 * 관리자 클레임 화면의 순수 판단 — **무엇을 뒤집을 수 있고, 그 개입이 무엇을 보내는가**.
 *
 * `lib/sellers/decisions.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은
 * **틀려도 조용하다.** 뒤집을 수 있는 상태를 잘못 적으면 화면은 누를 수 없는 버튼을
 * 내거나 눌러야 할 버튼을 감추고, 개입 요청을 잘못 조립하면 **다른 주문의 항목으로
 * 환불이 나간다** — 어느 쪽도 빨간 검사로 나타나지 않는다.
 *
 * ## 두 표는 **거울**이고, 그렇게 말해 두는 것이 요점이다
 *
 * | 여기 | 원본 |
 * | --- | --- |
 * | {@link CLAIM_OVERTURNABLE} | `apps/api/src/claims/admin-claim-rules.ts` 의 같은 이름 |
 * | {@link RETURN_FAULT} | `apps/api/src/claims/return-rules.ts` 의 `FAULT_OF` |
 * | {@link RETURN_PHOTO_RULE} | `apps/api/src/claims/return-rules.ts` 의 `PHOTO_RULE` |
 *
 * 저쪽은 `apps/api` 안이라 브라우저가 들여올 수 없다(`decisions.ts` 가 같은 사정을
 * 적어 두었다). **어긋나면 무엇이 나쁜가**도 같다 — 최악이 살아 있어 보이는 버튼과
 * 그 답으로 오는 409 이고, **틀린 쓰기를 만들 수는 없다.** 판정은 언제나 서버가 한다.
 *
 * I/O 도 렌더도 없으므로 분기 전부가 단위 스펙에서 닿는다 (QUALITY-GATES 순수 로직 —
 * `vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/**
 * 이 상태의 클레임을 **뒤집을 수 있는가**.
 *
 * `Record` 라 상태가 하나 늘면 컴파일이 막는다. 안 그러면 새 상태는 「뒤집을 수 있는지
 * 아무도 정한 적 없는 상태」로 태어나고, 그 결정이 빠졌다는 것을 어느 검사도 알려
 * 주지 않는다.
 */
export const CLAIM_OVERTURNABLE: Readonly<Record<ClaimStatus, boolean>> = {
  /** 판매자가 낸 결론 둘. 관리자의 강제 처리가 뒤집는 것이 정확히 이것이다. */
  CANCEL_REJECTED: true,
  RETURN_REJECTED: true,
  // 아직 결론이 아니다.
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: false,
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_COMPLETED: false,
  /** 이미 구매자가 원한 결과다. 되돌리는 것은 돈을 도로 받는 일이라 절차가 없다. */
  REFUNDED: false,
}

export function canOverturn(status: ClaimStatus): boolean {
  return CLAIM_OVERTURNABLE[status]
}

/**
 * 지금 이 클레임을 뒤집을 수 **없는 이유**, 뒤집을 수 있으면 `null`.
 *
 * **비활성 버튼을 대신하는 값이다.** 화면은 이 값으로 문장을 고르고, 문장이 있는 동안
 * 버튼을 내지 않는다 — 누를 수 없는 컨트롤을 내는 대신 왜 지금이 아닌지를 말하는
 * 것이 이 저장소의 규칙이다 (TASK-0063 4.1).
 *
 * 둘로 나누는 이유는 **사람이 할 일이 다르기 때문**이다. 앞엣것은 기다리면 열리고,
 * 뒤엣것은 영영 열리지 않는다.
 */
export type InterventionBlock = 'not_concluded' | 'settled'

export function interventionBlockOf(status: ClaimStatus): InterventionBlock | null {
  if (canOverturn(status)) return null

  return status === 'REFUNDED' ? 'settled' : 'not_concluded'
}

/**
 * 반품 사유가 정하는 귀책 — `returnFaultOf` 의 거울.
 *
 * 화면이 이것을 갖는 이유는 **고르기 전에 결과를 말하기 위해서**다. 관리자가 고르는
 * 것은 사유인데 바뀌는 것은 귀책이고, 귀책이 곧 반품 배송비를 누가 무는가다. 값을
 * 만드는 것은 서버이고 여기서 하는 일은 그 값을 미리 **보여 주는 것**뿐이다.
 */
export const RETURN_FAULT: Readonly<Record<ReturnReason, ClaimFault>> = {
  CHANGE_OF_MIND: 'CUSTOMER',
  DEFECTIVE: 'SELLER',
  WRONG_ITEM: 'SELLER',
}

/**
 * 이 사유에 사진이 필요한가 — `return-rules.ts` 의 `PHOTO_RULE` 거울.
 *
 * **귀책 표에서 파생시키지 않는다.** 지금은 「판매자 귀책이면 사진이 필수」가
 * 참이지만 그것은 두 표가 우연히 같은 줄을 갖는 것이고, 정의는 서로 다르다 — 앞은
 * 돈을 누가 무는가이고 뒤는 근거를 요구하는가다. 하나에서 다른 하나를 만들면 둘이
 * 갈라지는 날 **사진 칸이 조용히 사라지거나 조용히 생긴다.**
 *
 * 「선택」이 없는 것이 이 표의 결정이다(서버 쪽 주석). 하자·오배송은 판매자에게 돈을
 * 물리므로 근거가 **필수**이고, 단순 변심은 뒤집을 것이 없는 주장이라 **금지**다.
 */
export const RETURN_PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

/**
 * 이 개입이 사진을 **받는가**.
 *
 * 취소에는 붙일 자리가 없다 — 계약이 `return` 을 싣지 않고(둘 중 하나다), 사진은
 * 반품 부속의 칸이다. 그래서 유형이 먼저 갈리고, 반품일 때만 사유가 답한다.
 */
export function forcePhotoRule(type: ClaimType, reason: ReturnReason): 'required' | 'forbidden' {
  return type === 'CANCEL' ? 'forbidden' : RETURN_PHOTO_RULE[reason]
}

/** 강제 처리 대화상자가 들고 있는 것. */
export interface ForceInput {
  readonly reason: string
  /** 취소를 뒤집을 때의 귀책 재판정. 반품에서는 쓰이지 않는다. */
  readonly fault: ClaimFault
  /** 반품을 뒤집을 때의 사유. 취소에서는 쓰이지 않는다. */
  readonly returnReason: ReturnReason
  /**
   * 하자·오배송으로 뒤집을 때 붙는 증거 — **올라간 것만**.
   *
   * 사유가 사진을 금지하면 이 목록은 요청에 실리지 않는다({@link forceRequestOf}).
   * 사람이 하자로 골라 사진을 붙였다가 단순 변심으로 바꾸는 길이 있고, 그때 남은
   * 열쇠가 그대로 나가면 서버가 `RETURN_PHOTO_NOT_ALLOWED` 로 거절한다.
   */
  readonly photoKeys: readonly string[]
  /** 아직 올라가는 중인 장이 있는가. 지금 보내면 그 장이 빠진 신청이 된다 */
  readonly uploading: boolean
}

/**
 * 아직 남은 문제들. 비어 있으면 보낼 수 있다.
 *
 * **서버 규칙을 한 벌 더 적는 것이 아니다.** 판정은 서버가 하고(`returnPhotoDecision`),
 * 여기 있는 것은 **요청이 되기 전의 것들** — 붙지 않은 사진과 아직 올라가는 중인 장.
 * 그 400 은 화면이 「무엇이 빠졌는지」로 바꿔 말할 수 없는 모양으로 온다.
 *
 * **비활성 버튼을 대신하는 값이다** (TASK-0063 4.1 · `interventionBlockOf` 와 같은
 * 규칙). 버튼은 살아 있고, 누르면 무엇이 남았는지 문장으로 답한다.
 *
 * 개입 사유는 여기 없다 — 그것은 **그 칸의 오류**로 붙어야 하고(U2), 대화상자가
 * `Field` 의 `error` 로 말한다.
 */
export type ForceIssue = 'photo_required' | 'photo_uploading'

export function forceIssues(type: ClaimType, input: ForceInput): readonly ForceIssue[] {
  if (forcePhotoRule(type, input.returnReason) === 'forbidden') return []

  const issues: ForceIssue[] = []

  // 상한은 여기 없다. 여섯째 장은 고르는 자리에서 이미 거절되고
  // (`return-photos.ts` 의 `checkReturnPhoto`), 두 곳에 두면 뒤엣것은 닿을 수 없다.
  if (input.photoKeys.length === 0) issues.push('photo_required')
  if (input.uploading) issues.push('photo_uploading')

  return issues
}

/**
 * 첫 값.
 *
 * 취소의 귀책이 `SELLER` 인 것은 **뒤집는 맥락**에서 나온다 — 관리자가 판매자의 거절
 * 대신 승인을 내는 자리이고, 그 상황의 기본값이 「구매자 탓」이면 사람이 매번 고쳐야
 * 한다. 반품 사유도 같은 이유로 하자다. 둘 다 화면에서 바꿀 수 있고, 무엇으로
 * 기록되는지는 대화상자가 미리 말한다.
 */
export const EMPTY_FORCE_INPUT: ForceInput = {
  reason: '',
  fault: 'SELLER',
  returnReason: 'DEFECTIVE',
  photoKeys: [],
  uploading: false,
}

/** 이 개입이 **무엇으로 기록될** 귀책인가. 반품이면 사유가 정한다. */
export function faultOf(type: ClaimType, input: ForceInput): ClaimFault {
  return type === 'CANCEL' ? input.fault : RETURN_FAULT[input.returnReason]
}

/**
 * 원본 거절 하나를 **관리자가 대신 내는 신청**으로.
 *
 * 항목과 수량을 **원본에서 그대로 옮긴다.** 관리자가 부분만 뒤집는 화면은 없다 —
 * 거절은 신청 전체에 대한 답이었고, 그 답을 뒤집는다는 것은 그 신청을 다시 낸다는
 * 뜻이다. 남은 수량이 모자라면 서버가 `CLAIM_EXCEEDS_REMAINING` 으로 거절하고,
 * 그 답에는 몇 개까지인지가 실려 온다.
 *
 * `fault` 와 `return` 은 **정확히 하나만** 실린다(`createAdminClaimRequestSchema` 의
 * refine). 유형은 원본이 정하고 요청이 주장하지 않는다 — 주장하게 두면 배송된 물건이
 * 취소로 들어와 재고가 두 번 늘어난다.
 *
 * **사진은 규칙이 허락할 때만 실린다.** 하자·오배송이면 붙인 것을 그대로 보내고,
 * 단순 변심이면 **빈 목록**이다 — 화면이 사진 칸을 감추기는 하지만, 하자로 골라
 * 붙였다가 변심으로 바꾼 사람의 열쇠가 상태에 남아 있을 수 있고 그 요청은 서버가
 * `RETURN_PHOTO_NOT_ALLOWED` 로 거절한다. 규칙을 아는 자리가 여기 하나여야 한다.
 */
export function forceRequestOf(claim: Claim, input: ForceInput): CreateAdminClaimRequest {
  const cancelling = claim.type === 'CANCEL'
  const photographed = forcePhotoRule(claim.type, input.returnReason) === 'required'

  return {
    sellerOrderId: claim.sellerOrderId,
    items: claim.items.map((item) => ({
      orderItemId: item.orderItemId,
      quantity: item.quantity,
    })),
    reason: input.reason,
    fault: cancelling ? input.fault : null,
    return: cancelling
      ? null
      : {
          returnReason: input.returnReason,
          photoKeys: photographed ? [...input.photoKeys] : [],
        },
    overturnsClaimId: claim.id,
  }
}

/**
 * 목록 필터가 들고 있는 것.
 *
 * `sellerName` 만 질의로 나가지 않는다 — 계약이 아는 것은 `sellerId` 뿐이고, 화면은
 * 「루미에르만 보는 중」이라고 말해야 하기 때문이다. 골라 온 자리(목록의 행)가 그
 * 이름을 함께 알고 있으므로 지어낸 값이 아니다.
 */
export interface AdminClaimFilters {
  readonly sellerId: string | null
  readonly sellerName: string | null
  readonly buyerId: string | null
  readonly status: ClaimStatus | null
  readonly stage: ClaimHandlingStage | null
  readonly type: ClaimType | null
  /** `YYYY-MM-DD`. 신청 시각의 구간이고 양끝을 포함한다. */
  readonly from: string | null
  readonly to: string | null
  /** 참이면 검토를 기다리는 이의가 걸린 것만. 거짓은 필터가 없는 것과 같다. */
  readonly appealed: boolean
}

export const EMPTY_ADMIN_CLAIM_FILTERS: AdminClaimFilters = {
  sellerId: null,
  sellerName: null,
  buyerId: null,
  status: null,
  stage: null,
  type: null,
  from: null,
  to: null,
  appealed: false,
}

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: AdminClaimFilters): boolean {
  return (
    filters.sellerId !== null ||
    filters.buyerId !== null ||
    filters.status !== null ||
    filters.stage !== null ||
    filters.type !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.appealed
  )
}

/**
 * 콘솔이 하루를 자르는 시간대 — 고정 오프셋으로 적는다.
 *
 * 계약이 받는 것은 **순간**(`z.iso.datetime()`)이고 사람이 고르는 것은 **날짜**다.
 * 그 사이를 화면이 메워야 하는데, 오프셋을 빼면 브라우저의 시간대가 그 자리를
 * 대신하게 되어 같은 「9월 5일」이 사람마다 다른 구간이 된다. 한국 표준시는 서머타임이
 * 없어 이 상수가 언제나 맞고, 다국어가 붙는 날 바뀌는 자리는 여기 하나다
 * (`lib/claims/format.ts` 의 시간대와 같은 값이다).
 */
export const CONSOLE_UTC_OFFSET = '+09:00'

/** 그 날의 첫 순간을 UTC 로. */
export function dayStart(day: string): string {
  return new Date(`${day}T00:00:00.000${CONSOLE_UTC_OFFSET}`).toISOString()
}

/** 그 날의 마지막 순간을 UTC 로. **끝을 포함하므로** 자정이 아니라 23:59:59.999 다. */
export function dayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999${CONSOLE_UTC_OFFSET}`).toISOString()
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로 읽어
 * 400 으로 답한다.
 */
export function queryOf(filters: AdminClaimFilters): AdminClaimListQuery {
  return {
    ...(filters.sellerId === null ? {} : { sellerId: filters.sellerId }),
    ...(filters.buyerId === null ? {} : { buyerId: filters.buyerId }),
    // 계약의 `status` 는 목록이지만 화면이 고르는 것은 한 값이다. 문법은 쉼표 하나다.
    ...(filters.status === null ? {} : { status: [filters.status] }),
    ...(filters.stage === null ? {} : { stage: filters.stage }),
    ...(filters.type === null ? {} : { type: filters.type }),
    ...(filters.from === null ? {} : { from: dayStart(filters.from) }),
    ...(filters.to === null ? {} : { to: dayEnd(filters.to) }),
    ...(filters.appealed ? { appealed: true } : {}),
  }
}
