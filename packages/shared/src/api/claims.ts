import { z } from 'zod'

import { orderActorSchema, orderItemSnapshotSchema, orderNumberSchema } from './orders.js'
import { priceSchema, variantIdSchema } from './products.js'
import { returnPhotoKeySchema } from './uploads.js'

/**
 * 클레임의 계약 — 취소 · 반품 (TASK-0065 · `docs/design/state-machines.md` 4장).
 *
 * **신청의 단위는 주문이 아니라 항목·수량이다** (D-027). 주문 항목 셋 중 하나만, 그
 * 중 두 개 중 하나만 취소하는 것이 정상 흐름이고, 주문 단위로만 만들면 실제 서비스로
 * 쓸 수 없다. 그래서 이 파일의 요청·응답이 전부 항목 배열을 중심으로 돈다.
 *
 * **유형(`type`)을 요청이 정하지 않는다.** 「취소할까 반품할까」는 물건이 어디
 * 있는가의 문제이지 취향이 아니다 — 고르게 두면 배송된 물건을 취소로 신청해 재고가
 * 두 번 늘어난다. 주문 상태가 정하고 서버가 답한다
 * (`claimableResponseSchema.type`).
 *
 * 순수 규칙은 `apps/api/src/claims/claim-rules.ts` 가 갖고, 아래 열거형들은 그것과
 * **같은 목록**이어야 한다. 갈라지지 않는 것은 규율이 아니라 타입이 지킨다 —
 * 서비스가 이 스키마로 파싱한 값을 그대로 규칙 함수에 넘기므로, 한쪽에 상태를 하나
 * 더하고 다른 쪽을 안 고치면 `pnpm typecheck` 이 멈춘다.
 */

/** 취소인가 반품인가. 주문 상태가 정한다. */
export const claimTypes = ['CANCEL', 'RETURN'] as const

export type ClaimType = (typeof claimTypes)[number]

export const claimTypeSchema = z.enum(claimTypes)

/**
 * 클레임이 지나는 상태.
 *
 * **두 경로가 한 열거형에 있다.** 나누면 「지금 이 클레임이 어디까지 왔나」를 묻는
 * 화면과 목록이 유형별로 다른 코드를 갖게 되고, 실제로 둘은 같은 표에 나란히 있다.
 * 경로를 섞지 못하게 막는 것은 전이표와 `ClaimRequest_type_status_check` 이지 이
 * 목록이 아니다.
 *
 * 화면이 `Record<ClaimStatus, string>` 으로 문장을 갖게 하면 상태가 늘 때 **타입
 * 검사가** 빠진 문장을 잡는다 — `orderStatuses` 를 지금 전부 적어 둔 것과 같은
 * 이유다.
 */
export const claimStatuses = [
  'CANCEL_REQUESTED',
  'CANCEL_APPROVED',
  'CANCEL_REJECTED',
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  /** 회수 중. 실제 운송이 아니라 가상이다 (TASK-0067). */
  'PICKING_UP',
  'INSPECTING',
  'RETURN_COMPLETED',
  'RETURN_REJECTED',
  /** 환불까지 끝났다. 두 경로가 만나는 유일한 자리다. */
  'REFUNDED',
] as const

export type ClaimStatus = (typeof claimStatuses)[number]

export const claimStatusSchema = z.enum(claimStatuses)

/**
 * 누구 탓인가 (`pricing.md` 4장).
 *
 * 값이 아니라 **돈**이다 — 판매자 귀책이면 배송비·반품비를 판매자가 물고 구매자는
 * 전액을 돌려받으며, 단순 변심이면 반품 배송비가 환불액에서 빠진다. 「모름」이 없는
 * 이유가 그것이다: 정하지 않으면 환불액을 계산할 수 없다.
 */
export const claimFaults = ['CUSTOMER', 'SELLER'] as const

export type ClaimFault = (typeof claimFaults)[number]

export const claimFaultSchema = z.enum(claimFaults)

/**
 * 왜 돌려보내는가 (TASK-0067 2장 · 4장의 표).
 *
 * **`ClaimFault` 바로 옆에 있는 것이 이 값의 설명이다.** 귀책은 **둘**이다 — 그것이
 * 돈을 가르는 축이고, `pricing.md` 4장의 표도 두 줄이다. 그런데 사람이 고르는 사유는
 * **셋**이다. 셋을 둘로 접지 않는 이유는 **하자와 오배송이 돈에서만 같기 때문**이다:
 * 둘 다 판매자가 반품비를 물지만 하자는 물건의 문제이고 오배송은 이행의 실수다.
 * 분쟁·판매자 평가·나중의 통계가 다투는 것이 바로 그 차이이고, `SELLER` 한 값으로
 * 접으면 그 사실은 자유 서술(`ClaimRequest.reason`)에만 남아 아무도 셀 수 없다.
 *
 * 그래서 **셋이 입력이고 둘은 파생**이다 (`returnFaultOf`). 요청이 귀책을 직접
 * 주장하지 못하게 하는 것이 요점이다 — 주장하게 두면 「오배송인데 `CUSTOMER`」 같은
 * 조합이 만들어지고, 그것을 막을 검사가 어디에도 없다.
 *
 * 사유가 `returns.ts` 가 아니라 여기 있는 이유는 **신청서의 칸이기 때문**이다.
 * 신청의 계약이 하나면(아래 {@link createClaimRequestSchema}) 그 칸의 정의도 한
 * 곳에 있어야 하고, 반대로 두면 계약이 자기 칸을 남의 파일에서 빌려 오게 된다.
 * 「기타」가 없는 것도 같은 축이다 — 정하지 않으면 누가 반품비를 무는지 계산할 수
 * 없고, 계산하지 못하는 반품은 영원히 열려 있는 반품이 된다.
 */
export const returnReasons = [
  /** 단순 변심 · 주문 실수. 물건에는 아무 문제가 없다. */
  'CHANGE_OF_MIND',
  /** 상품 하자. 받은 물건 자체가 문제다. */
  'DEFECTIVE',
  /** 오배송. 물건은 멀쩡하지만 주문한 것이 아니다. */
  'WRONG_ITEM',
] as const

export type ReturnReason = (typeof returnReasons)[number]

export const returnReasonSchema = z.enum(returnReasons)

/**
 * 신청이 거절되는 여섯 이유 (`claim-rules.ts` 의 `ClaimRefusal`).
 *
 * 계약에 두는 이유는 **화면이 「지금 신청할 수 있나」를 버튼을 누르기 전에 물어야
 * 하기 때문**이다 (`claimableResponseSchema`). 거절을 오류로만 돌려주면 화면은
 * 눌러 보고서야 알게 되고, 그때 사람은 이미 사유를 다 적은 뒤다.
 *
 * 여섯을 나누는 기준은 **사람이 할 일이 다른가**다 — 기다리면 되는 것(`in_transit`),
 * 아무것도 할 수 없는 것(`confirmed` · `window_closed` · `not_claimable`), 수량을
 * 고치면 되는 것(`exceeds_remaining` · `invalid_quantity`).
 */
export const claimRefusals = [
  'in_transit',
  'confirmed',
  'window_closed',
  'not_claimable',
  'exceeds_remaining',
  'invalid_quantity',
] as const

export type ClaimRefusal = (typeof claimRefusals)[number]

export const claimRefusalSchema = z.enum(claimRefusals)

/** 사유의 길이. 판매자가 읽고 판단할 만큼이되, 본문이 아니다. */
export const CLAIM_REASON_MAX_LENGTH = 500

export const claimReasonSchema = z.string().trim().min(1).max(CLAIM_REASON_MAX_LENGTH)

/** 전이에 붙이는 사유. 거절에는 있고 정상 진행에는 없다. */
export const CLAIM_TRANSITION_REASON_MAX_LENGTH = 200

/**
 * 한 신청이 걸 수 있는 항목의 수.
 *
 * 주문 하나의 항목 수를 넘을 이유가 없고(`createCheckoutRequestSchema` 가 100 이다),
 * 상한이 없으면 한 요청이 조건부 갱신 100개가 아니라 10만 개가 된다.
 */
export const CLAIM_MAX_ITEMS = 100

/**
 * 신청할 항목 하나 — **무엇을 몇 개**.
 *
 * **수량의 하한이 여기 없는 것이 일부러다.** `min(1)` 을 걸면 「0개」가 스키마
 * 단계에서 400 이 되는데, 그것은 **거절의 순서를 뒤집는다** — 배송 중인 주문에
 * 0개를 신청하면 답이 「배송 중이라 지금은 할 수 없다」여야 하지 「수량이
 * 올바르지 않다」가 아니다. 후자를 받은 사람은 수량을 고쳐 다시 시도하고, 또
 * 거절당한다.
 *
 * 그래서 하한은 **도메인 규칙**이 갖는다 (`claimEligibility` 의 순서 5번째,
 * `invalid_quantity`). 상한도 마찬가지로 규칙이 갖는다 — 남은 수량이 상한이고,
 * 그 값은 항목마다 다르다.
 */
export const claimItemInputSchema = z.object({
  orderItemId: z.uuid(),
  quantity: z.int(),
})

export type ClaimItemInput = z.infer<typeof claimItemInputSchema>

/**
 * 경로와 **무관한** 칸들 — 무엇을, 몇 개, 왜.
 *
 * 두 라우트(`POST /claims` · `POST /returns`)가 같은 것을 받게 하려고 따로 있다.
 * 필드를 두 벌 적으면 한쪽에만 상한이 붙는 날이 오고, 그때 두 문이 서로 다른 요청을
 * 받아들이면서 같은 표를 쓴다.
 */
export const claimRequestFields = {
  sellerOrderId: z.uuid(),
  items: z.array(claimItemInputSchema).min(1).max(CLAIM_MAX_ITEMS),
  reason: claimReasonSchema,
}

/**
 * 같은 항목이 두 줄로 오지 않는가.
 *
 * 오면 「이 신청이 이 항목의 몇 개를 잡고 있나」에 답이 둘이 된다.
 * `ClaimItem_claimId_orderItemId_key` 가 결국 막지만, 그때는 잡아 둔 수량을
 * 되돌리는 롤백으로 끝나고 부르는 쪽은 무엇이 잘못됐는지 못 듣는다.
 */
export function claimItemsAreDistinct(input: {
  readonly items: readonly ClaimItemInput[]
}): boolean {
  return new Set(input.items.map((item) => item.orderItemId)).size === input.items.length
}

/** 위 검사가 실패했을 때 붙는 자리와 문장. 두 라우트가 **같은 말**을 해야 한다. */
export const CLAIM_DUPLICATE_ITEMS_ISSUE: { path: string[]; message: string } = {
  path: ['items'],
  message: '같은 주문 항목을 두 번 보낼 수 없습니다.',
}

/**
 * 반품에만 있는 칸들 — 왜 돌려보내는가와, 그 증거.
 *
 * **둘이 한 객체인 것이 이 스키마의 전부다.** 따로 두면 「사유 없는 사진」이 표현
 * 가능해지고, 그것은 무엇의 증거인지 아무도 말할 수 없는 이미지다.
 */
export const claimReturnDetailsSchema = z.object({
  returnReason: returnReasonSchema,
  /**
   * 이미 올라간 사진의 열쇠들.
   *
   * **URL 이 아니라 열쇠다.** URL 을 받으면 그것이 우리 버킷의 것인지 아닌지를 문자열
   * 파싱으로 되묻게 되고, 그 판정은 도메인이 아니라 배포 설정에 달린 값(공개 호스트)에
   * 기댄다. 열쇠는 그 자체로 소유자를 말한다 (`returnPhotoKeyPattern`).
   *
   * **장수의 상한이 여기 없는 것이 일부러다** — `claimItemInputSchema.quantity` 의
   * 하한과 같은 이유다. `.max(RETURN_PHOTO_MAX_COUNT)` 를 걸면 여섯 번째 장이
   * 스키마 단계에서 `INVALID` 한 필드 오류가 되고, 그 답은 **사유를 고쳐야 하는
   * 사람과 한 장을 빼면 되는 사람을 구분하지 못한다.** 상한은 규칙이 갖고, 그쪽은
   * 「이 사유에 사진이 필요한가」까지 함께 답하며 몇 장까지인지를 `params.max` 로
   * 싣는다 (`returnPhotoDecision` → `RETURN_PHOTO_TOO_MANY`).
   *
   * 두 곳에 같은 숫자를 두면 뒤엣것은 **닿을 수 없는 규칙**이 된다 — 코드도 문장도
   * 다 만들어 놓고 아무도 받지 못하는 상태가 그것이다.
   */
  photoKeys: z.array(returnPhotoKeySchema).default([]),
})

export type ClaimReturnDetails = z.infer<typeof claimReturnDetailsSchema>

/**
 * `POST /api/v1/claims` — 취소·반품을 신청한다.
 *
 * **`type` 이 없다.** 경로는 주문 상태가 정하므로 요청이 주장할 것이 아니고, 주장하게
 * 두면 배송된 물건이 취소로 들어와 재고가 두 번 늘어난다.
 *
 * **`status` 도 없다.** 신청은 전이가 아니라 **생성**이고, 시작하는 자리는 유형이
 * 정한다 (`CLAIM_INITIAL`).
 *
 * ## 반품의 부속이 여기 있는 이유 (TASK-0067)
 *
 * 없던 동안 이 문은 **걸을 수 없는 반품**을 만들 수 있었다. `ReturnDetail` 이 없는
 * `RETURN` 신청은 회수 운송장이 매달릴 곳이 없어 수거에서 409 로 끝나는데, 그 409 는
 * 신청한 사람이 아무것도 잘못하지 않았는데 며칠 뒤에 나온다. 「막는다」보다
 * **「생기지 않는다」**가 나으므로, 부속을 신청서의 칸으로 들여 신청과 **한
 * 트랜잭션**에 쓴다 (`ClaimService.create`).
 *
 * ## 귀책과 사유가 **둘 중 하나**인 것
 *
 * 취소는 사람이 귀책을 고르고(`fault`), 반품은 사유를 고르며 귀책은 거기서
 * 파생된다(`returnFaultOf`). 둘 다 실을 수 있게 두면 「오배송인데 `CUSTOMER`」가
 * 표현 가능해지고, 둘 다 비울 수 있게 두면 귀책 없는 신청이 생긴다 — 그 신청의
 * 환불액은 아무도 계산할 수 없다. 그래서 **정확히 하나**를 계약이 요구한다.
 *
 * 어느 쪽을 실을지는 화면이 이미 안다. `GET /seller-orders/:id/claimable` 이
 * `type` 을 답한 뒤에야 이 요청을 만들 수 있기 때문이고, 그 답과 어긋나면 서버가
 * 거절한다 — **경로는 여전히 주문 상태가 정한다.**
 */
export const createClaimRequestSchema = z
  .object({
    ...claimRequestFields,
    /** 취소의 귀책. 반품에는 없다 — 반품의 귀책은 `return.returnReason` 이 정한다. */
    fault: claimFaultSchema.nullable().default(null),
    /** 반품의 부속. 취소에는 없다. */
    return: claimReturnDetailsSchema.nullable().default(null),
  })
  .refine(claimItemsAreDistinct, CLAIM_DUPLICATE_ITEMS_ISSUE)
  .refine((input) => (input.fault === null) !== (input.return === null), {
    path: ['return'],
    message: '취소는 귀책을, 반품은 사유를 — 둘 중 하나만 보내야 합니다.',
  })

export type CreateClaimRequest = z.infer<typeof createClaimRequestSchema>

/**
 * 신청에 걸린 항목 하나.
 *
 * 스냅샷을 함께 싣는 이유는 화면이 「무엇을 반품하나」를 그려야 하기 때문이다. 빼면
 * 클레임 상세를 여는 화면이 주문 상세를 한 번 더 부르게 되고, 그 두 응답이 서로 다른
 * 순간을 보게 된다.
 */
export const claimItemSchema = z.object({
  id: z.uuid(),
  orderItemId: z.uuid(),
  variantId: variantIdSchema,
  /** 주문한 때의 상품. 지금 `Product` 가 뭐라고 하든 바뀌지 않는다. */
  snapshot: orderItemSnapshotSchema,
  quantity: z.int().min(1),
  /**
   * 이 줄로 돌려줄 금액.
   *
   * **아직 계산되지 않는다** (TASK-0068). 지금은 언제나 0 이고, 그 0 은 「0원을
   * 돌려준다」가 아니라 **「아직 계산하지 않았다」**다.
   */
  refundAmount: priceSchema,
})

export type ClaimItem = z.infer<typeof claimItemSchema>

/**
 * 상태 이력 한 줄.
 *
 * **누가 옮겼는지가 이 줄의 값이다.** 분쟁에서 다투는 것은 「언제 거절됐나」가 아니라
 * 「누가 그렇게 판단했나」이고, 그래서 `actor` 는 선택이 아니다 — 사람이 없는
 * 전이는 `actorId` 가 `null` 이지 `actor` 가 비는 것이 아니다.
 */
export const claimHistoryEntrySchema = z.object({
  id: z.uuid(),
  /** 신청이 생긴 줄에는 이전 상태가 없다. */
  fromStatus: claimStatusSchema.nullable(),
  toStatus: claimStatusSchema,
  reason: z.string().nullable(),
  actor: orderActorSchema,
  actorId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
})

export type ClaimHistoryEntry = z.infer<typeof claimHistoryEntrySchema>

/* ------------------------------------------------------------------------- *
 * 이의 제기 (TASK-0071)
 * ------------------------------------------------------------------------- */

/**
 * 이의가 어떻게 끝났나.
 *
 * **「검토 중」이 값으로 없다.** 그것은 `reviewedAt` 이 `null` 인 것이고, 값을 하나
 * 더 두면 「검토 중인데 결론이 적힌 이의」가 표현 가능해진다 — 서버 쪽
 * `ClaimAppeal_review_check` 이 그 조합을 막는 것과 같은 판단이다.
 */
export const claimAppealOutcomes = [
  /** 인용. 관리자가 거절을 뒤집었고, 그 개입은 **새 클레임**으로 서 있다. */
  'UPHELD',
  /** 기각. 판매자의 거절이 유지된다. 사유가 필수다. */
  'DISMISSED',
] as const

export type ClaimAppealOutcome = (typeof claimAppealOutcomes)[number]

export const claimAppealOutcomeSchema = z.enum(claimAppealOutcomes)

/** 이의의 사유. 신청 사유와 같은 길이다 — 읽고 판단할 만큼이되 본문이 아니다. */
export const CLAIM_APPEAL_REASON_MAX_LENGTH = CLAIM_REASON_MAX_LENGTH

export const claimAppealReasonSchema = z.string().trim().min(1).max(CLAIM_APPEAL_REASON_MAX_LENGTH)

/**
 * 거절에 대한 **구매자의 이의** 한 건.
 *
 * ## 왜 상태가 아니라 별도의 사실인가
 *
 * 이의를 냈다고 클레임이 움직이지 않는다 — 관리자가 볼 때까지 그 클레임은 거절된
 * 채다. 상태를 하나 더 만들면(예: `APPEALED`) 전이표에 되돌아오는 화살표가 생기고,
 * `ClaimRefund` 의 멱등이 기대는 「한 클레임은 평생 한 번만 그 자리에 선다」가
 * 흔들린다. 이력 줄로 적을 수도 없다: `ClaimStatusHistory` 는 전이의 기록이고, 같은
 * 상태로 옮긴 줄은 `ClaimStatusHistory_transition_check` 이 막는다.
 *
 * 그래서 이의는 **클레임 옆에 붙는 사실**이고, `claimSchema.appeal` 이 그 자리다.
 */
export const claimAppealSchema = z.object({
  claimId: z.uuid(),
  /** 이의를 낸 사람. 이 클레임을 신청한 그 사람이다. */
  filedById: z.uuid(),
  reason: z.string(),
  filedAt: z.iso.datetime(),
  /** 관리자가 결론을 낸 순간. `null` 이면 **검토 대기**다. */
  reviewedAt: z.iso.datetime().nullable(),
  reviewedById: z.uuid().nullable(),
  outcome: claimAppealOutcomeSchema.nullable(),
  /**
   * 기각의 사유. **인용에는 없다** — 인용의 근거는 개입 클레임의 이력에 적히고,
   * 두 곳에 적으면 둘이 다른 말을 하는 날이 온다.
   */
  reviewNote: z.string().nullable(),
})

export type ClaimAppeal = z.infer<typeof claimAppealSchema>

/**
 * `POST /api/v1/claims/:id/appeal` — 구매자가 거절에 이의를 제기한다.
 *
 * **퍼미션이 `order.write` 다.** 신청과 같은 축이기 때문이다 — 이의는 자기 주문에
 * 대한 행위이고, `claim.handle` 은 처리하는 쪽의 것이다. 구매자에게 그것을 요구하면
 * 아무도 이의를 낼 수 없다 (`ClaimController` 의 표와 같은 나눔).
 */
export const fileClaimAppealRequestSchema = z.object({ reason: claimAppealReasonSchema })

export type FileClaimAppealRequest = z.infer<typeof fileClaimAppealRequestSchema>

/**
 * `POST /api/v1/admin/claims/:id/appeal/dismiss` — 이의를 기각한다.
 *
 * **사유가 필수다.** 인용은 개입 클레임이 자기 이력에 근거를 남기지만, 기각은 그런
 * 클레임이 생기지 않는다 — 여기 말고는 「왜 기각했나」가 적힐 자리가 없고, 그것이
 * 없으면 구매자는 답을 받지 못한 채 거절만 다시 본다.
 */
export const dismissClaimAppealRequestSchema = z.object({ reason: claimAppealReasonSchema })

export type DismissClaimAppealRequest = z.infer<typeof dismissClaimAppealRequestSchema>

/**
 * 클레임 하나. 구매자와 판매자가 **같은 모양**을 본다 — 다른 것은 볼 수 있는가뿐이다.
 *
 * 관리자 개입의 세 필드도 여기 있다 (TASK-0071). 관리자 전용 응답으로 빼지 않은
 * 이유는 **세 역할이 전부 알아야 하는 사실**이기 때문이다 — 판매자는 자기 거절이
 * 뒤집혔다는 것을, 구매자는 자기 이의가 어디까지 갔는지를 알아야 하고, 그것을
 * 관리자 화면에만 실으면 나머지 둘은 「아무 일도 없었다」를 본다 (TASK-0071 R1).
 */
export const claimSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  orderId: z.uuid(),
  orderNumber: orderNumberSchema,
  type: claimTypeSchema,
  status: claimStatusSchema,
  reason: z.string(),
  fault: claimFaultSchema,
  /** 신청한 사람. 사람이 없는 신청은 없다. */
  requestedById: z.uuid(),
  requestedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  items: z.array(claimItemSchema),
  history: z.array(claimHistoryEntrySchema),
  /**
   * **이 신청이 뒤집은 거절** (TASK-0071).
   *
   * 관리자의 강제 처리는 거절된 클레임을 되살리는 것이 아니라 **새 신청을 관리자가
   * 대신 내는 것**이고, 이 값이 그 둘을 잇는 선이다. 「누가·왜」는 `history` 의 첫
   * 줄이 이미 담는다 — `actor` 가 `ADMIN` 이고 `reason` 이 개입의 근거다.
   */
  overturnsClaimId: z.uuid().nullable(),
  /**
   * **이 거절을 뒤집은 신청들** — 위 필드의 반대 방향.
   *
   * 목록인 것은 부분 취소를 나눠 뒤집을 수 있기 때문이다. 대개 0개이거나 1개이고,
   * 비어 있지 않다는 것 자체가 판매자 화면이 그려야 할 사실이다.
   */
  overturnedByClaimIds: z.array(z.uuid()),
  /** 이 거절에 걸린 이의. 없으면 `null` 이다 (TASK-0071). */
  appeal: claimAppealSchema.nullable(),
})

export type Claim = z.infer<typeof claimSchema>

export const claimResponseSchema = z.object({ claim: claimSchema })

export type ClaimResponse = z.infer<typeof claimResponseSchema>

/**
 * `POST /api/v1/claims/:id/transitions` — 다음 상태로 옮긴다.
 *
 * **주체를 보내지 않는다.** 요청이 자기 주체를 주장하게 두면 구매자가 `SELLER` 를
 * 주장해 자기 클레임을 승인한다 — 이 몫의 판 사람인지 산 사람인지는 **서버가
 * 확인해서 정한다** (`SellerOrderService.transition` 과 같은 판단).
 */
export const claimTransitionRequestSchema = z.object({
  to: claimStatusSchema,
  reason: z.string().trim().max(CLAIM_TRANSITION_REASON_MAX_LENGTH).nullable().optional(),
})

export type ClaimTransitionRequest = z.infer<typeof claimTransitionRequestSchema>

/**
 * 전이의 답.
 *
 * **멱등이다.** 이미 목표 상태면 아무 일도 하지 않고 `changed: false` 로 성공한다 —
 * 재시도한 화면에 오류를 보이는 것은, 그 사람이 원한 결과가 이미 이뤄져 있는데
 * 실패했다고 말하는 것이다.
 */
export const claimTransitionResponseSchema = z.object({
  claim: claimSchema,
  changed: z.boolean(),
})

export type ClaimTransitionResponse = z.infer<typeof claimTransitionResponseSchema>

export const CLAIM_LIST_DEFAULT_LIMIT = 20
export const CLAIM_LIST_MAX_LIMIT = 50

export const claimStatusFilterSchema = z.array(claimStatusSchema).min(1).max(claimStatuses.length)

/** `GET /api/v1/claims` 의 질의, 부르는 쪽이 쓰는 모양. */
export const claimListQuerySchema = z.object({
  sellerOrderId: z.uuid().optional(),
  status: claimStatusFilterSchema.optional(),
  type: claimTypeSchema.optional(),
  limit: z.int().min(1).max(CLAIM_LIST_MAX_LIMIT).optional(),
  /** 마지막으로 본 클레임의 id. `id` 가 UUIDv7 이라 그 자체로 시간순이다. */
  cursor: z.uuid().optional(),
})

export type ClaimListQuery = z.infer<typeof claimListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * 타입이 있는 쪽 옆에 두는 이유는 둘이 갈리지 않게 하기 위해서다 — 한쪽에만
 * 파라미터를 더하면 컴파일이 멈춘다. `status` 만 변환이 붙고 문법은 **쉼표 하나**다
 * (`orderListQueryParamsSchema` 와 같은 규약 — 목록마다 다른 문법을 쓰면 그 차이를
 * 설명할 수 있는 사람이 아무도 없다).
 */
export const claimListQueryParamsSchema = z.object({
  sellerOrderId: z.uuid().optional(),
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(claimStatusFilterSchema)
    .optional(),
  type: claimTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CLAIM_LIST_MAX_LIMIT).optional(),
  cursor: z.uuid().optional(),
})

/** 목록 한 줄. 상세를 열지 않고도 그릴 수 있을 만큼만 담는다. */
export const claimListItemSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  orderNumber: orderNumberSchema,
  type: claimTypeSchema,
  status: claimStatusSchema,
  fault: claimFaultSchema,
  requestedAt: z.iso.datetime(),
  /** 걸린 항목의 줄 수와 수량 합. 「2건 3개」를 그리는 데 쓴다. */
  itemCount: z.int().min(0),
  totalQuantity: z.int().min(0),
})

export type ClaimListItem = z.infer<typeof claimListItemSchema>

export const claimListResponseSchema = z.object({
  claims: z.array(claimListItemSchema),
  /** 다음 페이지의 커서. 없으면 `null` 이다. */
  nextCursor: z.uuid().nullable(),
})

export type ClaimListResponse = z.infer<typeof claimListResponseSchema>

/**
 * 항목 하나가 지금 **몇 개까지** 신청될 수 있는가 (F8).
 *
 * `remainingQuantity` 를 화면이 `quantity - claimedQuantity` 로 계산하지 않고 서버가
 * 주는 이유는, 그 뺄셈의 정의가 한 곳에만 있어야 하기 때문이다 — 거절된 클레임이
 * 수량을 돌려준다는 사실이 화면에 한 벌 더 적히면, 규칙이 바뀌는 날 한 곳만 고쳐진다.
 */
export const claimableItemSchema = z.object({
  orderItemId: z.uuid(),
  variantId: variantIdSchema,
  snapshot: orderItemSnapshotSchema,
  /** 주문한 수량. */
  quantity: z.int().min(1),
  /** 살아 있는 클레임이 잡고 있는 수량. */
  claimedQuantity: z.int().min(0),
  /** 아직 신청할 수 있는 수량. */
  remainingQuantity: z.int().min(0),
})

export type ClaimableItem = z.infer<typeof claimableItemSchema>

/**
 * `GET /api/v1/seller-orders/:id/claimable` — 「이 주문에 지금 무엇을 신청할 수
 * 있나」 (F8).
 *
 * `/seller-orders/:id/actions` 가 전이에 대해 하는 일을 클레임에 대해 한다: **화면이
 * 상태로 분기하지 않게 하려고 있다.** 「`DELIVERED` 면 반품 버튼」을 화면에 적으면 그
 * 판단이 세 앱에 흩어지고, 반품 기간처럼 배포 설정에 달린 값은 화면이 **틀린 날짜를
 * 자신 있게** 적게 된다.
 */
export const claimableResponseSchema = z.object({
  sellerOrderId: z.uuid(),
  /**
   * 이 주문이 지금 열어 주는 경로. `null` 이면 아무것도 신청할 수 없다.
   *
   * 배송 중(`SHIPPED`)이 `null` 인 것이 F4 다 — 취소하기엔 이미 떠났고 반품하기엔
   * 아직 안 왔다.
   */
  type: claimTypeSchema.nullable(),
  /** 왜 안 되는가. `type` 이 `null` 일 때만 값이 있다. */
  refusal: claimRefusalSchema.nullable(),
  /**
   * 반품을 받아 주는 기간의 끝 (R2).
   *
   * 반품 경로에서만 값이 있다. 취소는 물건이 아직 떠나지 않은 상태라 기다릴 것이
   * 없다. **화면이 D+7 을 더하지 않는다** — 기간의 축은 배포 설정(`FULFILLMENT_PACE`)
   * 이고 어떤 응답에도 실리지 않으므로, 압축된 데모에서 화면이 계산하면 틀린 날짜가
   * 나온다 (`autoConfirmAt` 이 같은 이유로 서버에서 온다).
   */
  returnWindowEndsAt: z.iso.datetime().nullable(),
  items: z.array(claimableItemSchema),
})

export type ClaimableResponse = z.infer<typeof claimableResponseSchema>

/* ------------------------------------------------------------------------- *
 * 판매자 콘솔 (TASK-0070)
 * ------------------------------------------------------------------------- */

/**
 * 판매자가 **지금 손댈 것이 있는가** — 목록의 세 갈래.
 *
 * ## 왜 상태 열 개가 아니라 셋인가
 *
 * 「상태 탭」을 글자 그대로 만들면 탭이 열 개다. 열 개짜리 탭 줄은 360px 에서
 * 가로로 넘치고, 무엇보다 판매자가 묻는 것은 「이 클레임이 `PICKING_UP` 인가」가
 * 아니라 **「내가 지금 뭘 해야 하나」**다. 그래서 탭의 축은 상태가 아니라 이
 * 셋이고, 상태 자체로 좁히고 싶은 사람을 위해 {@link sellerClaimListQuerySchema} 의
 * `status` 가 그대로 남아 있다.
 *
 * ## 어느 상태가 어느 갈래인지는 **전이표가 정한다**
 *
 * 두 번째 표를 만들지 않는다. 「판매자가 할 일이 있다」는 곧 **「전이표에서 이
 * 상태를 떠나는 화살표 중 `SELLER` 가 지날 수 있는 것이 있다」**이고, 그 사실은
 * `apps/api/src/claims/claim-rules.ts` 의 `claimTransitions` 에 이미 한 번 적혀
 * 있다. 표를 한 벌 더 두면 상태가 늘 때 한 곳만 고쳐지고, 그때 증상은 「처리할 것이
 * 없는데 3건 대기」이거나 「있는데 0건」이다 — 어느 쪽도 실패하지 않는다.
 */
export const claimHandlingStages = [
  /** 판매자가 다음 걸음을 밟아야 한다 — 승인 · 거절 · 수거 · 검수. */
  'WAITING',
  /** 판매자가 지금 할 일은 없다. 환불이 나가기를 기다리는 자리다. */
  'IN_PROGRESS',
  /** 끝났다. 전이표의 종착 셋이다. */
  'CLOSED',
] as const

export type ClaimHandlingStage = (typeof claimHandlingStages)[number]

export const claimHandlingStageSchema = z.enum(claimHandlingStages)

export const SELLER_CLAIM_LIST_DEFAULT_LIMIT = 20
export const SELLER_CLAIM_LIST_MAX_LIMIT = 50

/**
 * 판매자 목록의 커서 — **불투명 문자열**이다.
 *
 * `claimListQuerySchema.cursor` 가 `uuid` 인 것과 다르고, 그 차이가 이 목록의
 * 판단 전체다. 저쪽의 정렬 키는 `id` 하나라 커서가 곧 마지막으로 본 행이지만,
 * 여기 정렬 키는 **(단계, id)** 두 칸이다. 단계는 상태에서 나오고 상태는 움직이므로,
 * 커서가 행을 가리키면 **그 행의 상태가 바뀌는 순간 커서가 가리키던 자리도 함께
 * 움직인다** — 판매자가 목록을 넘기면서 승인을 누르는 것이 정확히 그 상황이다.
 *
 * 그래서 커서에 두 칸을 **모두 굳혀 넣는다.** 커서는 「마지막으로 본 행」이 아니라
 * **「정렬 축 위의 위치」**이고, 그것이 `docs/design/pages.md` 의 커서 규약이 처음부터
 * 적어 둔 문장이다 — 「정렬 키 상의 **위치**를 가리키는 불투명 문자열」.
 *
 * 값의 모양은 서버의 것이고 클라이언트는 해석하지 않는다. 그래서 여기서 재는 것은
 * 길이뿐이다 — 상한이 없으면 이 문자열이 질의 하나를 임의 크기로 만든다.
 */
export const SELLER_CLAIM_CURSOR_MAX_LENGTH = 128

export const sellerClaimCursorSchema = z.string().min(1).max(SELLER_CLAIM_CURSOR_MAX_LENGTH)

/** `GET /api/v1/seller-claims` 의 질의, 부르는 쪽이 쓰는 모양. */
export const sellerClaimListQuerySchema = z.object({
  /** 탭. 없으면 전부이고, 그때도 **대기가 먼저 온다.** */
  stage: claimHandlingStageSchema.optional(),
  type: claimTypeSchema.optional(),
  /** 상태로 직접 좁히기. 탭과 함께 걸면 둘 다 적용된다. */
  status: claimStatusFilterSchema.optional(),
  limit: z.int().min(1).max(SELLER_CLAIM_LIST_MAX_LIMIT).optional(),
  cursor: sellerClaimCursorSchema.optional(),
})

export type SellerClaimListQuery = z.infer<typeof sellerClaimListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * `status` 만 변환이 붙고 문법은 **쉼표 하나**다 — 이 저장소의 모든 목록이 같은
 * 문법을 쓴다(`claimListQueryParamsSchema` · `sellerOrderListQueryParamsSchema`).
 * 목록마다 다른 문법을 쓰면 그 차이를 설명할 수 있는 사람이 아무도 없다.
 */
export const sellerClaimListQueryParamsSchema = z.object({
  stage: claimHandlingStageSchema.optional(),
  type: claimTypeSchema.optional(),
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(claimStatusFilterSchema)
    .optional(),
  limit: z.coerce.number().int().min(1).max(SELLER_CLAIM_LIST_MAX_LIMIT).optional(),
  cursor: sellerClaimCursorSchema.optional(),
})

/**
 * 판매자 목록 한 줄.
 *
 * `claimListItemSchema` 와 겹치지만 **다른 스키마**인 이유는 저쪽이 구매자·판매자·
 * 관리자가 함께 쓰는 모양이기 때문이다. 여기 더 붙는 셋 — 단계 · 기한 · 지연 — 은
 * 판매자에게만 뜻이 있고, 구매자 화면에 「기한 초과」를 그리면 그것은 판매자를
 * 재촉하는 말이 남의 화면에 뜨는 것이다.
 */
export const sellerClaimListItemSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  orderNumber: orderNumberSchema,
  type: claimTypeSchema,
  status: claimStatusSchema,
  /** 상태에서 파생된다. 화면이 다시 세지 않게 서버가 답한다. */
  stage: claimHandlingStageSchema,
  fault: claimFaultSchema,
  requestedAt: z.iso.datetime(),
  /**
   * 처리 기한 — 「신청 후 2영업일」 (TASK-0070 4장).
   *
   * **화면이 더하지 않는다.** 영업일의 정의(시간대 · 주말 · 공휴일)와 압축 데모의
   * 축(`FULFILLMENT_PACE`)이 전부 서버에 있고, 어느 것도 응답에 실리지 않는다 —
   * `claimableResponseSchema.returnWindowEndsAt` 이 같은 이유로 서버에서 온다.
   */
  dueAt: z.iso.datetime(),
  /** 기한을 넘겼는가. 기한 **정각은 아직 기한 안**이다. */
  overdue: z.boolean(),
  /** 걸린 항목의 줄 수와 수량 합. 「2건 3개」를 그리는 데 쓴다. */
  itemCount: z.int().min(0),
  totalQuantity: z.int().min(0),
  /** 「울 코트」. 「외 2건」은 붙이지 않는다 — 문장은 화면이 만든다. */
  headline: z.string(),
  thumbnailUrl: z.string().nullable(),
})

export type SellerClaimListItem = z.infer<typeof sellerClaimListItemSchema>

export const sellerClaimListResponseSchema = z.object({
  claims: z.array(sellerClaimListItemSchema),
  /** 다음 페이지의 커서. 없으면 마지막이다. */
  nextCursor: sellerClaimCursorSchema.nullable(),
})

export type SellerClaimListResponse = z.infer<typeof sellerClaimListResponseSchema>

/**
 * `GET /api/v1/seller-claims/summary` — 뱃지와 탭이 읽는 숫자.
 *
 * **목록과 다른 요청이다.** 같은 응답에 실으면 숫자가 필터를 따라 움직이고, 그러면
 * 뱃지가 아니다 (`sellerOrderSummarySchema` 가 같은 이유로 같은 모양이다).
 *
 * **지연 건수가 여기 없다.** 세려면 「2영업일」을 SQL 로도 내려보내야 하고, 그러면
 * 「영업일이 무엇인가」가 두 곳에 적힌다. 대신 대기 탭이 **오래된 순**이라 지연된
 * 건이 정확히 그 탭 맨 위에 모인다 — 정렬이 곧 기한 순이기 때문이다
 * (`seller-claim.service.ts`).
 */
export const sellerClaimSummarySchema = z.object({
  /** 상태별 건수. **전 상태가 들어 있다** — 0건인 상태도 0을 받아야 그린다. */
  counts: z.record(claimStatusSchema, z.int().min(0)),
  /** 단계별 건수. 탭 옆의 숫자다. */
  stages: z.record(claimHandlingStageSchema, z.int().min(0)),
  /** 처리 대기 — 사이드바와 대시보드가 읽는 하나의 수. `stages.WAITING` 과 같다. */
  waiting: z.int().min(0),
})

export type SellerClaimSummary = z.infer<typeof sellerClaimSummarySchema>

export const sellerClaimSummaryResponseSchema = z.object({ summary: sellerClaimSummarySchema })

export type SellerClaimSummaryResponse = z.infer<typeof sellerClaimSummaryResponseSchema>

/**
 * **환불 예정액** — 승인 버튼을 누르기 전에 얼마가 나가는지 (TASK-0070 4장 · R2).
 *
 * 「실제 환불과 같은 함수를 지난다」가 이 스키마의 전부다. 서버는 미리보기 전용
 * 계산을 갖지 않고 `ClaimRefundService` 가 실제로 쓰는 입력 조립과
 * `claimRefundBreakdown` 을 그대로 부른다 — 두 벌로 만들면 미리 본 금액과 실제 나간
 * 금액이 갈리고, **그 차이는 사람의 장부에 남는다.**
 *
 * 그래서 필드가 `RefundBreakdown` 과 정확히 같은 모양이다. 이름을 바꾸거나 줄이면
 * 그 순간 「같은 함수」가 아니게 된다.
 */
export const claimRefundQuoteLineSchema = z.object({
  orderItemId: z.uuid(),
  units: z.int().min(0),
  amount: priceSchema,
})

export type ClaimRefundQuoteLine = z.infer<typeof claimRefundQuoteLineSchema>

export const claimRefundQuoteSchema = z.object({
  lines: z.array(claimRefundQuoteLineSchema),
  /** 항목 몫의 합. */
  itemsAmount: priceSchema,
  /**
   * 배송비 조정. **양수면 더 돌려주고 음수면 덜 돌려준다.**
   *
   * 부호를 살려 두는 것이 요점이다 — 「반품비 3,000원 차감」과 「원 배송비 3,000원
   * 환불」을 하나로 접으면 0원이 되어 **아무 일도 없었던 것처럼 보인다**.
   */
  shippingAmount: z.int(),
  /** 실제로 나갈 금액. 음수가 될 수 없다 — 환불은 청구로 뒤집히지 않는다. */
  total: priceSchema,
})

export type ClaimRefundQuote = z.infer<typeof claimRefundQuoteSchema>

/**
 * 이 걸음을 **어느 문으로** 밟는가.
 *
 * 세 갈래가 있는 이유는 `POST /claims/:id/transitions` 로 전부 밀면 안 되기
 * 때문이다. 그 라우트로도 상태는 옮겨지지만 **옮겨지기만 한다** — 회수 운송장은
 * 나지 않고 검수 결과는 적히지 않으며, 합격했는데 환불이 시작되지 않는다
 * (`return.controller.ts` 가 그 위험을 적어 두었다). 즉 「반품완료인데 아무 일도
 * 일어나지 않은 반품」이 만들어지고, 그것은 아무 오류도 내지 않는다.
 *
 * 그 판단을 화면에 적으면 세 앱에 흩어진다. 서버가 답한다.
 */
export const claimActionRoutes = [
  /** `POST /claims/:id/transitions` — 승인 · 거절. */
  'transition',
  /** `POST /returns/:claimId/pickup` — 수거. 운송장이 함께 난다. */
  'pickup',
  /** `POST /returns/:claimId/inspection` — 검수. 합격 여부가 환불을 가른다. */
  'inspection',
] as const

export type ClaimActionRoute = (typeof claimActionRoutes)[number]

export const claimActionRouteSchema = z.enum(claimActionRoutes)

/**
 * 지금 이 판매자가 밟을 수 있는 걸음 하나.
 *
 * `sellerOrderActionSchema` 가 주문에 대해 하는 일을 클레임에 대해 한다 — **화면이
 * 상태로 분기하지 않게 하려고 있다.** 새 규칙이 아니라 `claimTransitions` 가 이미
 * 답하고 있던 것을 응답에 싣는 것이고, 거기에 두 가지가 더 붙는다: 어느 문으로
 * 가는가(`route`)와, 사유가 필수인가(`requiresReason`).
 */
export const claimActionSchema = z.object({
  to: claimStatusSchema,
  route: claimActionRouteSchema,
  /**
   * 사유 없이 보내면 **서버가 400 으로 거절한다**.
   *
   * 화면이 먼저 막는 것은 친절이고, 이 값이 참인 걸음을 사유 없이 보냈을 때
   * 거절되는 것이 규칙이다 — 화면만 막으면 API 를 직접 부르는 길이 남는다.
   */
  requiresReason: z.boolean(),
})

export type ClaimAction = z.infer<typeof claimActionSchema>

/**
 * 첨부 사진 한 장.
 *
 * **열쇠와 URL 을 함께 싣는다.** 열쇠는 도메인의 값이고(`returnPhotoKeyPattern` 이
 * 소유자를 말한다) URL 은 배포 설정에 달린 값이라, 화면이 열쇠에서 URL 을 만들면
 * 그 설정이 프론트에 한 벌 더 생긴다.
 *
 * **판매자가 남의 사진을 볼 수 없다는 판정은 이 스키마가 아니라 그 앞에 있다** —
 * `ClaimService.actorFor` 가 이 클레임의 주인이 아닌 사람을 403 으로 돌려보내므로,
 * 여기까지 온 열쇠는 언제나 이 판매자 몫의 신청서에 붙은 것이다.
 */
export const claimPhotoSchema = z.object({
  key: returnPhotoKeySchema,
  /** 공개 URL. **저장소가 설정되지 않은 배포에서는 `null`** 이다 (TASK-0011 4.5). */
  url: z.url().nullable(),
})

export type ClaimPhoto = z.infer<typeof claimPhotoSchema>

/**
 * 반품에만 있는 사실들, 판매자 화면이 그리는 만큼.
 *
 * `returnDetailSchema`(`returns.ts`)의 **부분집합**이고 대체가 아니다. 이 파일이
 * 저쪽을 들여오지 않는 이유는 저쪽이 이 파일을 들여오기 때문이고(신청의 칸이 여기
 * 있다), 고리를 만들면 zod 스키마가 평가 순서에 따라 `undefined` 로 태어난다.
 *
 * **금액 둘은 신청 시점에 굳은 값이다** (`returnCostShare` · `ReturnDetail`).
 * 판매자가 그 뒤에 배송비 정책을 바꿔도 움직이지 않아야 하므로 여기서도, 어디서도
 * 다시 계산하지 않는다.
 */
export const sellerClaimReturnSchema = z.object({
  reason: returnReasonSchema,
  /** 환불액에서 뺄 반품 배송비. 구매자 부담에서만 0보다 크다. */
  returnShippingDeduction: z.int().min(0),
  /** 돌려줄 원 배송비. 판매자 귀책에서만 0보다 크다. */
  originalShippingRefund: z.int().min(0),
  photos: z.array(claimPhotoSchema),
  /** 회수 운송장. 아직 수거하지 않았으면 `null`. */
  pickupTrackingNumber: z.string().nullable(),
  /** 반송 운송장. 검수 불합격에서만 값이 있다. */
  sendBackTrackingNumber: z.string().nullable(),
})

export type SellerClaimReturn = z.infer<typeof sellerClaimReturnSchema>

/**
 * `GET /api/v1/seller-claims/:id` — 판매자 콘솔의 클레임 상세.
 *
 * **한 응답인 것이 이 계약의 요점이다.** 화면은 대상 항목·사진·환불 예정액·기한·
 * 버튼을 **언제나 함께** 그린다. 넷으로 나눠 부르면 네 응답이 서로 다른 순간을
 * 보게 되고, 그때 판매자는 「1,000원」을 보면서 「2,000원」을 승인한다
 * (`returnResponseSchema` 가 클레임과 부속을 함께 싣는 것과 같은 판단).
 */
export const sellerClaimDetailSchema = z.object({
  claim: claimSchema,
  stage: claimHandlingStageSchema,
  dueAt: z.iso.datetime(),
  overdue: z.boolean(),
  /**
   * 돈. **아직 안 나갔으면 예정액이고, 나갔으면 나간 액수다.**
   *
   * 한 필드인 것이 판단이다. 나눠 두면 화면이 「어느 쪽을 그릴지」를 상태로 다시
   * 판정하게 되고, 그 판정이 틀리면 **끝난 클레임의 상세가 「환불 예정액 0원」**을
   * 보여 준다 — 이미 환불된 클레임에 「지금 환불하면 얼마인가」를 물으면 남은 수량이
   * 없으므로 답이 0이기 때문이다. 그것은 거짓말은 아니지만 판매자가 알고 싶은 것도
   * 아니다.
   *
   * 어느 쪽이든 **실제 환불이 쓰는 같은 함수**를 지난 값이다 — 예정액은
   * `claimRefundBreakdown` 이 지금 계산한 것이고, 나간 액수는 그 함수가 그때 계산해
   * `ClaimRefund` 에 적어 둔 것이다.
   */
  quote: claimRefundQuoteSchema,
  /** 위 금액이 **이미 나간 것**인가. 화면의 라벨이 이 값으로 갈린다. */
  refunded: z.boolean(),
  /** 지금 밟을 수 있는 걸음. 비어 있으면 종착이거나 시스템을 기다리는 자리다. */
  actions: z.array(claimActionSchema),
  /** 반품이면 부속, 취소면 `null`. */
  return: sellerClaimReturnSchema.nullable(),
})

export type SellerClaimDetail = z.infer<typeof sellerClaimDetailSchema>

export const sellerClaimDetailResponseSchema = z.object({ claim: sellerClaimDetailSchema })

export type SellerClaimDetailResponse = z.infer<typeof sellerClaimDetailResponseSchema>

/* ------------------------------------------------------------------------- *
 * 관리자 개입 (TASK-0071)
 * ------------------------------------------------------------------------- */

/**
 * `POST /api/v1/admin/claims` — **관리자가 대신 내는 신청**, 그리고 그 자리에서의 승인.
 *
 * ## 이 라우트가 「강제 처리」의 전부인 이유
 *
 * 판매자의 거절을 뒤집는 방법으로 셋을 두고 골랐다.
 *
 * | 안 | 왜 아닌가 |
 * | --- | --- |
 * | ⓐ 거절에서 나가는 화살표를 관리자에게 연다 | 거절은 잡고 있던 수량을 **이미 돌려주었다**. 되돌리는 화살표는 그 수량을 다시 잡는 연산을 함께 요구하고, 그 사이 구매자가 다시 신청했으면 잡을 수 없다. 게다가 `RETURN_REJECTED → RETURN_APPROVED` 는 전이표에 **고리**를 만들어, `ClaimRefund` 의 멱등이 기대는 「돌아오는 화살표가 없다」를 깬다 |
 * | ⓒ 별도의 「개입」 표를 만든다 | 환불·재고 복원·주문 마감이 전부 클레임에 매달려 있다. 표를 하나 더 두면 그 기계를 한 벌 더 만들게 된다 |
 * | ⓑ **새 신청을 관리자가 대신 낸다** | 아래 |
 *
 * 저장소는 이미 「거절된 것은 다시 신청할 수 있다」를 규칙으로 갖고 있다
 * (`remainingQuantity`). **관리자의 뒤집기는 그 재신청의 주체가 관리자인 경우**이고,
 * 그래서 새 상태도 새 화살표도 필요 없이 기존 기계가 그대로 돈다. 원본은 거절된 채
 * 남는데 그것이 사실이다 — 관리자는 판매자가 거절했다는 사실을 없앤 것이 아니라
 * **다른 결론을 낸 것**이다.
 *
 * ## 구매자의 신청과 다른 두 가지
 *
 * - **`overturnsClaimId`** — 어느 거절을 뒤집는가. 없으면 개입이 원본과 이어지지
 *   않고, 판매자는 자기 거절이 살아 있는 줄 안다.
 * - **주문 상태의 문턱이 다르다.** 구매확정한 주문에 하자 반품을 받는 것이 이
 *   라우트의 두 번째 목적이고(TASK-0071 4.0), 반품 기간도 보지 않는다 — 기간은
 *   구매자가 **스스로** 신청할 수 있는 창이지 관리자의 판단을 가두는 값이 아니다.
 *   그 판정은 `claimEligibility` 가 아니라 `adminClaimEligibility` 가 한다.
 *
 * **유형은 여전히 요청이 정하지 않는다.** 주문 상태가 정한다 — 관리자라고 배송 중인
 * 물건을 취소로 넣을 수 있어야 하는 것은 아니고, 그렇게 두면 재고가 두 번 늘어난다.
 */
export const createAdminClaimRequestSchema = z
  .object({
    ...claimRequestFields,
    /** 취소의 귀책. 반품에는 없다 — 반품의 귀책은 `return.returnReason` 이 정한다. */
    fault: claimFaultSchema.nullable().default(null),
    /** 반품의 부속. 취소에는 없다. */
    return: claimReturnDetailsSchema.nullable().default(null),
    /** 이 개입이 뒤집는 거절. 확정 후 하자 반품처럼 원본이 없는 개입이면 `null`. */
    overturnsClaimId: z.uuid().nullable().default(null),
  })
  .refine(claimItemsAreDistinct, CLAIM_DUPLICATE_ITEMS_ISSUE)
  .refine((input) => (input.fault === null) !== (input.return === null), {
    path: ['return'],
    message: '취소는 귀책을, 반품은 사유를 — 둘 중 하나만 보내야 합니다.',
  })

export type CreateAdminClaimRequest = z.infer<typeof createAdminClaimRequestSchema>

export const ADMIN_CLAIM_LIST_DEFAULT_LIMIT = 20
export const ADMIN_CLAIM_LIST_MAX_LIMIT = 50

/**
 * `GET /api/v1/admin/claims` 의 질의 — 판매자 · 구매자 · 상태 · 기간.
 *
 * **커서가 `id` 하나다.** 판매자 콘솔은 정렬 축이 `(단계, id)` 두 칸이라 커서도 두
 * 칸이지만(`sellerClaimCursorSchema`), 관리자 목록은 **작업 큐가 아니라 조회**라
 * 최신순 하나로 충분하다. 「지금 처리할 것」은 아래 `/admin/claims/overdue` 가
 * 따로 답한다 — 그것을 이 목록의 정렬로 만들면 커서가 **요청마다 다른 자리**를
 * 가리키게 된다(지연은 `now` 에 달린 값이다).
 */
export const adminClaimListQuerySchema = z.object({
  /** 이 가게에 들어온 것만. */
  sellerId: z.uuid().optional(),
  /** 이 사람이 산 주문의 것만. */
  buyerId: z.uuid().optional(),
  status: claimStatusFilterSchema.optional(),
  stage: claimHandlingStageSchema.optional(),
  type: claimTypeSchema.optional(),
  /** 신청 시각의 구간. 양끝 모두 포함이다. */
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  /** 참이면 **검토 대기 중인 이의가 걸린 것만**. 거짓은 필터가 없는 것과 같다. */
  appealed: z.boolean().optional(),
  limit: z.int().min(1).max(ADMIN_CLAIM_LIST_MAX_LIMIT).optional(),
  cursor: z.uuid().optional(),
})

export type AdminClaimListQuery = z.infer<typeof adminClaimListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * 타입이 있는 쪽 옆에 두는 이유는 둘이 갈리지 않게 하기 위해서다 — 한쪽에만
 * 파라미터를 더하면 컴파일이 멈춘다. `status` 의 문법은 **쉼표 하나**이고, 그것이
 * 이 저장소의 모든 목록이 쓰는 규약이다.
 */
export const adminClaimListQueryParamsSchema = z.object({
  sellerId: z.uuid().optional(),
  buyerId: z.uuid().optional(),
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(claimStatusFilterSchema)
    .optional(),
  stage: claimHandlingStageSchema.optional(),
  type: claimTypeSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  // `'false'` 를 참으로 읽지 않는다. `z.coerce.boolean()` 은 비지 않은 문자열을 전부
  // 참으로 만들어, 「이의만 보기를 껐다」가 「켰다」로 도착한다.
  appealed: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_CLAIM_LIST_MAX_LIMIT).optional(),
  cursor: z.uuid().optional(),
})

/**
 * 관리자 목록 한 줄.
 *
 * 판매자 목록(`sellerClaimListItemSchema`)과 다른 것은 **누구의 것인지가 필요하다**는
 * 점이다. 판매자는 자기 가게만 보므로 가게를 적을 이유가 없지만, 관리자는 플랫폼
 * 전체를 보므로 「누가 팔았고 누가 샀나」가 없으면 줄을 구분할 수 없다.
 */
export const adminClaimListItemSchema = claimListItemSchema.extend({
  sellerId: z.uuid(),
  brandName: z.string(),
  /** 산 사람. 이름이 아니라 id 다 — 목록에 개인정보를 싣지 않는다. */
  buyerId: z.uuid(),
  stage: claimHandlingStageSchema,
  dueAt: z.iso.datetime(),
  overdue: z.boolean(),
  /** 검토 대기 중인 이의가 걸려 있다. */
  appealPending: z.boolean(),
  /** 이 신청이 **관리자의 개입**이다 — 어느 거절을 뒤집었다. */
  intervention: z.boolean(),
})

export type AdminClaimListItem = z.infer<typeof adminClaimListItemSchema>

export const adminClaimListResponseSchema = z.object({
  claims: z.array(adminClaimListItemSchema),
  nextCursor: z.uuid().nullable(),
})

export type AdminClaimListResponse = z.infer<typeof adminClaimListResponseSchema>

/** 지연 목록이 한 번에 훑는 줄 수. 근거는 `admin-claim-rules.ts` 에 있다. */
export const ADMIN_OVERDUE_SCAN_LIMIT = 200

export const ADMIN_OVERDUE_DEFAULT_LIMIT = 20
export const ADMIN_OVERDUE_MAX_LIMIT = 100

export const adminOverdueClaimsQueryParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_OVERDUE_MAX_LIMIT).optional(),
})

/**
 * `GET /api/v1/admin/claims/overdue` — **기한을 넘긴 채 처리를 기다리는 클레임**.
 *
 * ## 왜 목록의 필터가 아니라 라우트인가
 *
 * 기한은 **영업일**로 센다(`claim-deadline.ts`). SQL 은 주말을 모르고, 그 계산을
 * 질의로 내려보내면 시간대·주말의 정의가 두 벌이 된다 — 그때 지연 뱃지와 지연
 * 목록이 서로 다른 건을 가리키고, 어느 쪽도 실패하지 않는다.
 *
 * 그래서 **넘치게 읽고 정확히 거른다**: 질의는 「가장 짧은 기한조차 지났을 수 있는」
 * 보수적인 컷오프로 좁히고, 판정은 `isClaimOverdue` 가 한다. 훑는 줄 수에 상한이
 * 있으므로({@link ADMIN_OVERDUE_SCAN_LIMIT}) 답에 `truncated` 가 붙는다 — 200줄을
 * 넘겨 밀린 상태는 목록이 아니라 사고이고, 그 사실을 숨기면 화면은 「20건」만 본다.
 */
export const adminOverdueClaimsResponseSchema = z.object({
  claims: z.array(adminClaimListItemSchema),
  /** 훑은 줄 수. 상한에 닿았으면 `truncated` 가 참이다. */
  scanned: z.int().min(0),
  truncated: z.boolean(),
})

export type AdminOverdueClaimsResponse = z.infer<typeof adminOverdueClaimsResponseSchema>

export const ADMIN_FAILED_REFUND_DEFAULT_LIMIT = 20
export const ADMIN_FAILED_REFUND_MAX_LIMIT = 100

export const adminFailedRefundQueryParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_FAILED_REFUND_MAX_LIMIT).optional(),
})

/**
 * 나가지 못한 환불 한 건 (TASK-0068 R3 이 넘긴 항목).
 *
 * **`refundedAt IS NULL` 인 `ClaimRefund` 가 곧 이 목록이다.** 그 행이 없으면 실패한
 * 환불은 「승인됐는데 `REFUNDED` 로 안 간 클레임」으로만 보이고, 그 상태에서 사람이
 * 할 수 있는 일은 로그를 뒤지는 것뿐이다.
 *
 * `attempts` 와 `lastError` 를 함께 싣는 것이 요점이다 — 다음 주기에 사라질 실패(결제사가
 * 잠깐 죽었다)와 사라지지 않을 실패(이미 다 환불된 결제, 없는 결제)를 가르는 것이
 * 그 둘이고, 뒤엣것은 사람이 손대야 한다.
 */
export const adminFailedRefundSchema = z.object({
  claimId: z.uuid(),
  sellerOrderId: z.uuid(),
  orderNumber: orderNumberSchema,
  sellerId: z.uuid(),
  brandName: z.string(),
  claimStatus: claimStatusSchema,
  /** 나갔어야 할 금액. 한 번도 계산되지 못한 실패면 0 이다. */
  amount: priceSchema,
  attempts: z.int().min(0),
  lastError: z.string().nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  /**
   * **환불을 기다리기 시작한 시각** — 승인·검수가 상태를 옮긴 때
   * (`ClaimRequest.updatedAt`). 실패한 환불은 트랜잭션째 물러나 그 행을 건드리지
   * 않으므로, 이 값은 「얼마나 오래 못 받고 있나」에 그대로 답한다.
   */
  waitingSince: z.iso.datetime(),
})

export type AdminFailedRefund = z.infer<typeof adminFailedRefundSchema>

export const adminFailedRefundListResponseSchema = z.object({
  refunds: z.array(adminFailedRefundSchema),
  /**
   * 상한을 넘겨 더 있다.
   *
   * 커서를 두지 않은 것은 **페이지가 필요한 실패 목록은 이미 사고**이기 때문이다 —
   * 정상 흐름에서 이 목록은 0건이고, 넘칠 때 필요한 것은 다음 페이지가 아니라 그
   * 사실 자체다.
   */
  hasMore: z.boolean(),
})

export type AdminFailedRefundListResponse = z.infer<typeof adminFailedRefundListResponseSchema>
