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
 * 누구 탓인가 (`pricing.md` 3장).
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
 * 돈을 가르는 축이고, `pricing.md` 3장의 표도 두 줄이다. 그런데 사람이 고르는 사유는
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

/** 클레임 하나. 구매자와 판매자가 **같은 모양**을 본다 — 다른 것은 볼 수 있는가뿐이다. */
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
