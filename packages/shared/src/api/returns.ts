import { z } from 'zod'

import {
  claimItemsAreDistinct,
  claimRequestFields,
  claimReturnDetailsSchema,
  claimSchema,
  CLAIM_DUPLICATE_ITEMS_ISSUE,
  returnReasonSchema,
} from './claims.js'
import { returnPhotoKeySchema } from './uploads.js'

/**
 * 반품의 계약 — 수거 · 검수 · 부속의 모양 (TASK-0067 · `docs/design/state-machines.md` 4장).
 *
 * **클레임의 계약을 대체하지 않는다.** 상태·전이·항목·수량은 전부 `claims.ts` 가
 * 갖고(TASK-0065), 여기 있는 것은 **반품 경로에만 있는 사실들**이다 — 회수 운송장은
 * 무엇인가, 검수는 어떻게 끝났는가, 배송비는 어떻게 갈렸는가.
 *
 * ## 신청의 **입력**은 여기 없다
 *
 * 사유(`returnReason`)와 사진(`photoKeys`)은 `claims.ts` 의
 * `claimReturnDetailsSchema` 에 있고, 이 파일은 그것을 빌려 온다. 신청의 계약이 둘로
 * 갈려 있던 동안 `POST /claims` 는 **부속 없는 반품**을 만들 수 있었고 — 수거에서
 * 409 로 끝나는, 신청한 사람이 아무것도 잘못하지 않은 행이다 — 계약을 합치는 것이
 * 그 상태를 「막는」 대신 **생기지 않게** 하는 방법이었다.
 *
 * 그래서 아래 {@link createReturnRequestSchema} 는 `createClaimRequestSchema` 의
 * **좁힘**이다. 같은 칸을 쓰되 부속을 **필수**로 요구하고 귀책 칸을 아예 두지
 * 않는다 — 이 라우트로 들어온 것은 반품이며, 반품의 귀책은 사유에서 파생된다.
 */

/**
 * 반품 배송비를 **누가 무는가** (`pricing.md` 3장).
 *
 * `ClaimFault` 와 값이 닮았지만 다른 축이다. 귀책은 「누구 탓인가」이고 이것은
 * 「누가 내는가」다 — 지금은 둘이 함께 움직이지만, 부분 부담이나 플랫폼 부담이
 * 생기는 날 갈라지는 것은 이쪽이다. 한 열거형으로 묶으면 그날 두 뜻이 한 값에
 * 얹히고, 어느 쪽이 바뀐 것인지 아무도 모른다.
 */
export const returnFeeBearers = ['BUYER', 'SELLER'] as const

export type ReturnFeeBearer = (typeof returnFeeBearers)[number]

export const returnFeeBearerSchema = z.enum(returnFeeBearers)

/**
 * `POST /api/v1/returns` — 반품을 신청한다.
 *
 * **`createClaimRequestSchema` 의 좁힘이다.** 같은 칸(`claimRequestFields`)을 쓰고,
 * 다른 것은 둘뿐이다.
 *
 * - **부속이 필수다.** 이 문으로 들어온 것은 반품이므로 사유와 증거가 없을 수 없다.
 * - **`fault` 칸이 없다.** 귀책은 사유에서 파생되며(`returnFaultOf`), 요청이 직접
 *   주장하면 「오배송인데 구매자 귀책」이 만들어진다.
 *
 * `type` 이 없는 것은 그쪽과 같은 이유다 — 취소인지 반품인지는 주문 상태가 정한다.
 * 이 라우트를 불렀는데 그 답이 취소면 신청 자체가 거절된다.
 */
export const createReturnRequestSchema = z
  .object({
    ...claimRequestFields,
    return: claimReturnDetailsSchema,
  })
  .refine(claimItemsAreDistinct, CLAIM_DUPLICATE_ITEMS_ISSUE)

export type CreateReturnRequest = z.infer<typeof createReturnRequestSchema>

/**
 * `POST /api/v1/returns/:claimId/inspection` — 입고 검수 결과.
 *
 * **합격 여부가 불리언인 이유.** 검수의 답은 둘뿐이고(`INSPECTING` 에서 나가는
 * 화살표가 둘이다), 상태를 요청이 직접 고르게 두면 검수가 「반품완료로 옮겨 줘」가
 * 되어 전이표와 검수 결과가 서로 다른 사실을 말할 수 있다.
 */
export const inspectReturnRequestSchema = z.object({
  passed: z.boolean(),
  /** 불합격 사유. 합격에는 없어도 되고, 불합격에는 사람이 읽을 근거가 필요하다. */
  note: z.string().trim().min(1).max(200).nullable().optional(),
})

export type InspectReturnRequest = z.infer<typeof inspectReturnRequestSchema>

/**
 * 회수인가 반송인가.
 *
 * **방향이 반대라는 사실이 이 도메인에서 유일하게 새로운 것**이라 값으로 남긴다.
 * 배송(`Shipment`)은 언제나 판매자 → 구매자라 방향을 적을 필요가 없었다.
 */
export const returnShipmentDirections = [
  /** 구매자 → 판매자. 승인된 반품을 걷어 온다. */
  'PICKUP',
  /** 판매자 → 구매자. 검수에서 떨어진 물건을 돌려보낸다. */
  'SEND_BACK',
] as const

export type ReturnShipmentDirection = (typeof returnShipmentDirections)[number]

export const returnShipmentDirectionSchema = z.enum(returnShipmentDirections)

/**
 * 회수·반송 운송장 한 건.
 *
 * **`Shipment` 와 같은 모양이되 `status` 가 없다.** 배송에 상태가 있는 이유는 그것이
 * 주문 상태보다 잘게 움직이기 때문인데(`SHIPPED` 하나에 네 단계가 들어간다), 회수는
 * 클레임 상태가 이미 `PICKING_UP` · `INSPECTING` 으로 나눠 갖고 있다. 상태를 한 벌 더
 * 두면 두 표가 같은 순간에 대해 서로 다른 말을 하게 되고, 그때 어느 쪽이 맞는지
 * 아무도 모른다.
 */
export const returnShipmentSchema = z.object({
  direction: returnShipmentDirectionSchema,
  carrierCode: z.string(),
  carrierName: z.string(),
  /** `DEMO-{운송사코드}-{12자리}`. 배송의 운송장과 **같은 발급기**에서 나온다. */
  trackingNumber: z.string(),
  issuedAt: z.iso.datetime(),
})

export type ReturnShipment = z.infer<typeof returnShipmentSchema>

/** 검수 결과. 아직 검수하지 않았으면 반품 전체에서 `null` 이다. */
export const returnInspectionSchema = z.object({
  passed: z.boolean(),
  note: z.string().nullable(),
  inspectedAt: z.iso.datetime(),
})

export type ReturnInspection = z.infer<typeof returnInspectionSchema>

/**
 * 반품 한 건의 부속 전부.
 *
 * 클레임(`claimSchema`)이 「어디까지 왔나」를 말하고 이것이 「반품으로서 무엇인가」를
 * 말한다. 두 응답으로 나누지 않고 `returnResponseSchema` 가 둘을 함께 싣는 이유는
 * 화면이 그 둘을 언제나 같이 그리기 때문이다 — 따로 부르면 두 응답이 서로 다른
 * 순간을 보게 된다 (`claimItemSchema` 가 스냅샷을 함께 싣는 것과 같은 판단).
 */
export const returnDetailSchema = z.object({
  claimId: z.uuid(),
  reason: returnReasonSchema,
  /** 반품 배송비를 무는 쪽. `reason` 에서 파생된 값이고 신청 시점에 굳는다. */
  feeBearer: returnFeeBearerSchema,
  /**
   * 반품 배송비 — **신청 시점의 스냅샷**.
   *
   * 판매자가 배송비 정책을 바꿔도 이미 신청된 반품의 부담액은 그대로여야 한다
   * (CLAUDE.md 6장 「주문·결제·정산에 관련된 값은 스냅샷으로 남긴다」).
   */
  returnShippingFee: z.int().min(0),
  /** 돌려줄 원 배송비. 판매자 귀책에서만 0보다 크다 (`pricing.md` 3장). */
  originalShippingRefund: z.int().min(0),
  /** 환불액에서 뺄 반품 배송비. 구매자 부담에서만 0보다 크다. */
  returnShippingDeduction: z.int().min(0),
  photoKeys: z.array(returnPhotoKeySchema),
  shipments: z.array(returnShipmentSchema),
  inspection: returnInspectionSchema.nullable(),
})

export type ReturnDetail = z.infer<typeof returnDetailSchema>

export const returnResponseSchema = z.object({
  claim: claimSchema,
  return: returnDetailSchema,
})

export type ReturnResponse = z.infer<typeof returnResponseSchema>
