import type { ClaimFault, ClaimStatus, ReturnFeeBearer, ReturnReason } from '@shopping/shared'
import { claimStatuses, RETURN_PHOTO_MAX_COUNT, returnPhotoKeyPattern } from '@shopping/shared'

/**
 * 반품의 순수 판단 (TASK-0067 · `docs/design/pricing.md` 4장).
 *
 * `claim-rules.ts` 가 「이 신청을 받아도 되는가」와 「이 걸음을 걸어도 되는가」를
 * 답한다면, 여기는 **반품 경로에만 있는 세 가지 판단**을 답한다.
 *
 * ① **누가 반품 배송비를 무는가** (귀책 → 부담자 → 금액)
 * ② **이 사유에 사진이 필요한가, 이 사진들을 붙여도 되는가**
 * ③ **검수 결과가 다음에 무엇을 부르는가** — 특히 **합격일 때만 환불이다**
 *
 * 데이터베이스도 시계도 보지 않는다. 금액도 인자로 받는다 — 「지금 이 판매자의
 * 배송비」를 여기서 읽으면 그것을 재려고 데이터베이스가 필요해지고, 그 순간 이
 * 파일의 분기 전부에 닿을 수 없게 된다. 이 TASK 의 Q5 는 **분기 커버리지 100%** 이고,
 * 뒤집어 말하면 **닿을 수 없는 방어 분기를 쓰지 않는다.**
 *
 * ## 값을 어디서 가져왔나 — 문서와 판단을 나눈다
 *
 * **문서가 정한 것** (`pricing.md` 4장 · TASK-0067 4장의 표): 단순 변심이면 반품
 * 배송비를 구매자가 물고 원 배송비는 돌려주지 않는다. 상품 하자와 오배송이면
 * 판매자가 물고 원 배송비까지 돌려준다.
 *
 * **문서가 말하지 않은 것**: **반품 배송비가 얼마인가.** `pricing.md` 1장 ④는 주문
 * 배송비의 출처로 `Seller.shippingFee` 와 `Seller.freeShippingThreshold` 만 적어
 * 두었고, 반품비를 위한 컬럼도 상수도 이 저장소에 없다. 그래서 이 파일은 금액을
 * **정하지 않고 받는다** — 어느 값을 넣을지는 서비스의 결정이고
 * (`return.service.ts`), 그 결정의 근거도 그쪽에 적혀 있다.
 */

/**
 * 셋을 둘로 접는다 — `ReturnReason` → `ClaimFault`.
 *
 * **신청이 `fault` 를 직접 주장하지 못하게 하려고 있다.** 주장하게 두면
 * 「오배송인데 구매자 귀책」 같은 조합이 만들어지고, 그것을 막을 검사가 어디에도
 * 없다. 귀책은 값이 아니라 돈이므로(`ClaimFault` 의 주석) 그 조합은 곧 「판매자가
 * 잘못했는데 구매자가 반품비를 무는」 행이다.
 *
 * `switch` 가 아니라 **사유 전부를 덮는 레코드**인 이유는 `@shopping/shared` 에
 * 사유를 하나 더 넣고 여기를 안 고치면 **컴파일이 깨져야** 하기 때문이다. 안 그러면
 * 새 사유는 귀책이 정해지지 않은 채로 신청될 수 있고, 그 신청의 환불액은 아무도
 * 계산할 수 없다.
 */
const FAULT_OF: Readonly<Record<ReturnReason, ClaimFault>> = {
  CHANGE_OF_MIND: 'CUSTOMER',
  DEFECTIVE: 'SELLER',
  WRONG_ITEM: 'SELLER',
}

export function returnFaultOf(reason: ReturnReason): ClaimFault {
  return FAULT_OF[reason]
}

/**
 * 누가 반품 배송비를 내는가.
 *
 * 귀책과 **한 줄씩 짝이 맞지만 표를 따로 둔다.** 지금은 「구매자 탓이면 구매자가
 * 낸다」가 참이지만 그것은 정책이지 정의가 아니고, 플랫폼이 일부를 무는 프로모션이
 * 생기는 날 갈라지는 것은 이쪽이다. 한 표로 합치면 그날 두 뜻이 한 값에 얹힌다.
 */
const BEARER_OF: Readonly<Record<ReturnReason, ReturnFeeBearer>> = {
  CHANGE_OF_MIND: 'BUYER',
  DEFECTIVE: 'SELLER',
  WRONG_ITEM: 'SELLER',
}

export function returnFeeBearerOf(reason: ReturnReason): ReturnFeeBearer {
  return BEARER_OF[reason]
}

/** 판정에 들어가는 두 금액. 둘 다 **신청 시점의 사실**이고 여기서 읽지 않는다. */
export interface ReturnFees {
  /**
   * 회수에 드는 배송비. 부담자가 구매자면 환불액에서 이만큼이 빠진다.
   *
   * 서비스가 `Seller.shippingFee` 를 넣는다 — 그 근거는 `return.service.ts` 에 있다.
   */
  readonly returnShippingFee: number
  /** 이 몫에 실제로 부과됐던 배송비 (`SellerOrder.shippingFee`). */
  readonly originalShippingFee: number
}

/**
 * 이 반품에서 배송비가 어떻게 갈리는가 (`pricing.md` 4장의 아래 두 줄).
 *
 * **두 금액을 하나로 합치지 않는다.** 「반품비 3,000원 차감」과 「원 배송비 3,000원
 * 환불」은 사람이 확인해야 할 서로 다른 줄이고, 합치면 0원이 되어 **아무 일도 없었던
 * 것처럼 보인다** — `quoteRefund` 의 `shippingAdjustment` 가 부호를 살려 둔 것과 같은
 * 판단이다.
 *
 * 부담자로 갈라지는 것도 일부러다. 사유 셋으로 갈면 하자와 오배송이 **같은 두 줄을
 * 두 번** 적게 되고, 그때 한쪽만 고치는 실수가 가능해진다.
 */
export interface ReturnCostShare {
  readonly feeBearer: ReturnFeeBearer
  /** 환불액에서 뺄 반품 배송비. 판매자 부담이면 0 이다. */
  readonly returnShippingDeduction: number
  /** 돌려줄 원 배송비. 구매자 부담이면 0 이다. */
  readonly originalShippingRefund: number
}

export function returnCostShare(reason: ReturnReason, fees: ReturnFees): ReturnCostShare {
  const feeBearer = returnFeeBearerOf(reason)

  if (feeBearer === 'BUYER') {
    // 단순 변심. 반품비는 구매자가 물고, **원 배송비는 돌려주지 않는다** — 물건은
    // 실제로 배송됐고 그 운송에는 아무 잘못이 없다.
    return {
      feeBearer,
      returnShippingDeduction: fees.returnShippingFee,
      originalShippingRefund: 0,
    }
  }

  // 판매자 귀책(하자 · 오배송). 「배송비·반품비 모두 판매자 부담, 구매자에게 전액
  // 환불」이 문서의 문장이다. 차감이 0 인 것이 그 「전액」이고, 원 배송비 환불이
  // 「모두 판매자 부담」이다.
  return {
    feeBearer,
    returnShippingDeduction: 0,
    originalShippingRefund: fees.originalShippingFee,
  }
}

/**
 * 이 사유에 사진이 **필요한가, 붙일 수 있는가**.
 *
 * ## 왜 「선택」이 없는가
 *
 * 세 값이 아니라 두 값인 것이 이 표의 결정이다.
 *
 * - **하자 · 오배송은 필수다.** 이 두 사유는 판매자에게 **돈을 물린다**(반품비 +
 *   원 배송비). 근거 없이 그것을 주장할 수 있으면 귀책 선택은 사실상 「누가 낼지
 *   구매자가 고르는 칸」이 되고, 그때 판매자가 할 수 있는 일은 전부 거절하는 것뿐이다
 *   — R2 가 관리자 개입을 예비해 두었지만, 개입할 근거 자체가 없으면 그 장치도
 *   아무 일도 못 한다.
 * - **단순 변심은 금지다.** 뒤집을 것이 없는 주장에 증거를 받을 이유가 없다. 받아
 *   두면 아무도 보지 않는 이미지가 버킷에 쌓이고, 그것은 비용이자 지우지 못하는
 *   개인정보다.
 *
 * 「선택」을 두면 두 사유 모두에서 **없는 상태가 정상**이 되어 위 두 문장이 동시에
 * 거짓이 된다.
 */
const PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

export function returnPhotosRequired(reason: ReturnReason): boolean {
  return PHOTO_RULE[reason] === 'required'
}

/** 사진이 거절되는 다섯 이유. 나누는 기준은 **사람이 할 일이 다른가**다. */
export type ReturnPhotoRefusal =
  /** 하자·오배송인데 사진이 없다 — 찍어서 다시 올려야 한다 */
  | 'photo_required'
  /** 단순 변심에 사진을 붙였다 — 사유를 고치거나 사진을 빼야 한다 */
  | 'photo_not_allowed'
  /** 상한을 넘었다 — 몇 장을 빼야 한다 */
  | 'too_many_photos'
  /** 같은 사진을 두 번 보냈다 — 클라이언트의 실수다 */
  | 'duplicate_photo'
  /** 내 것이 아닌 열쇠다 — 고칠 방법이 없다 */
  | 'foreign_photo'

export type ReturnPhotoDecision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'refused'; readonly reason: ReturnPhotoRefusal }

/**
 * 이 사진들을 이 사유의 신청서에 붙여도 되는가 (F2).
 *
 * **순서가 답의 우선순위다.** 앞의 것이 어긋나면 뒤는 볼 필요가 없고, 무엇보다
 * 사람에게 할 말이 그 순서로 정해진다 — 단순 변심으로 여섯 장을 올린 사람에게
 * 「다섯 장까지입니다」라고 답하면 한 장을 빼고 다시 시도하게 되는데, 그가 할 일은
 * 전부 빼거나 사유를 고치는 것이다.
 *
 * 소유자 확인이 마지막인 것도 같은 이유다. 그것은 **고칠 방법이 없는** 거절이라,
 * 고칠 수 있는 것들을 먼저 말한다.
 *
 * @param ownerUserId 신청하는 사람. 열쇠의 가운데 칸이 이 값이어야 한다.
 */
export function returnPhotoDecision(
  reason: ReturnReason,
  keys: readonly string[],
  ownerUserId: string,
): ReturnPhotoDecision {
  const refused = (photoReason: ReturnPhotoRefusal): ReturnPhotoDecision => ({
    outcome: 'refused',
    reason: photoReason,
  })

  if (PHOTO_RULE[reason] === 'forbidden') {
    return keys.length > 0 ? refused('photo_not_allowed') : { outcome: 'allowed' }
  }

  if (keys.length === 0) return refused('photo_required')
  if (keys.length > RETURN_PHOTO_MAX_COUNT) return refused('too_many_photos')
  if (new Set(keys).size !== keys.length) return refused('duplicate_photo')
  if (!keys.every((key) => isOwnPhotoKey(key, ownerUserId))) return refused('foreign_photo')

  return { outcome: 'allowed' }
}

/**
 * 이 열쇠가 **이 사람의** 것인가.
 *
 * 형식을 다시 재는 것은 계약(`returnPhotoKeySchema`)이 이미 걸러 낸 뒤라도 마찬가지다
 * — `upload-rules.ts` 의 `productImageKey` 가 자기가 만든 열쇠를 스스로 검사하는 것과
 * 같은 이유이고, 이 함수를 부르는 자리가 HTTP 하나뿐이라고 보장할 수 없다.
 *
 * 접두어가 사람인 덕분에 **두 번째 조회가 필요 없다.** 열쇠만 보고 소유자를 말할 수
 * 있으니, 「남의 사진을 내 신청서에 붙인다」가 조용히 통과하지 않는다.
 */
export function isOwnPhotoKey(key: string, ownerUserId: string): boolean {
  return returnPhotoKeyPattern.test(key) && key.startsWith(`returns/${ownerUserId}/`)
}

/**
 * 검수가 끝났을 때 무엇이 따라오는가 (F4 · F5).
 *
 * **「합격일 때만 환불」이 이 함수 하나에 있다.** 서비스가 `if (passed)` 를 다시 쓰지
 * 않는 이유가 그것이다 — 조건이 두 곳에 있으면 언젠가 한쪽만 고쳐지고, 그때 증상은
 * 빨간 테스트가 아니라 **물건을 돌려받지 못했는데 나간 돈**이다.
 *
 * `sendsBack` 이 `refunds` 의 반대인 것은 지금 우연이 아니라 정의다. 검수의 답은
 * 둘뿐이고, 물건은 둘 중 하나로만 간다 — 판매자의 재고로 들어가거나 구매자에게
 * 돌아가거나.
 */
export interface ReturnInspectionOutcome {
  readonly nextStatus: ClaimStatus
  /** 환불과 재고 복원을 부르는가 (TASK-0068 · 0069). **합격에서만 참이다.** */
  readonly refunds: boolean
  /** 물건을 구매자에게 돌려보내는가. 불합격에서만 참이다. */
  readonly sendsBack: boolean
}

export function returnInspectionOutcome(passed: boolean): ReturnInspectionOutcome {
  if (passed) return { nextStatus: 'RETURN_COMPLETED', refunds: true, sendsBack: false }

  return { nextStatus: 'RETURN_REJECTED', refunds: false, sendsBack: true }
}

/**
 * 이 클레임이 반품으로서 **지금 걸을 수 있는 걸음**인가.
 *
 * 전이표(`claim-rules.ts`)가 「이 화살표가 있는가」를 답한다면 여기는 그 앞의 질문,
 * **「이 반품이 그 자리에 서 있는가」**를 답한다. 둘이 다른 이유는 이 TASK 의 걸음이
 * 전이 말고도 하는 일이 있기 때문이다 — 수거는 운송장을 발급하고, 검수는 결과를
 * 적는다. 그것들을 엉뚱한 상태에서 하면 전이가 나중에 거절해도 **부수효과는 이미
 * 남는다.**
 */
export type ReturnStepRefusal =
  /** 취소 신청이다. 반품의 걸음을 걸 수 없다 */
  | 'not_a_return'
  /** 지금 상태에서 할 수 있는 걸음이 아니다 */
  | 'wrong_status'

export type ReturnStepDecision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'refused'; readonly reason: ReturnStepRefusal }

/**
 * 수거는 `RETURN_APPROVED` 에서, 검수는 `INSPECTING` 에서.
 *
 * **이미 걸은 걸음은 거절이 아니다.** 목표 상태에 이미 있으면 통과시키는데, 그것이
 * 이 TASK 의 걸음들이 멱등인 방법이기 때문이다 — 운송장은 발급된 것을 다시 주고,
 * 전이는 `changed: false` 로 끝난다. 여기서 막으면 **중간에서 끊긴 걸음을 다시
 * 이어붙일 방법이 없어진다** (운송장은 났는데 상태가 안 옮겨진 경우가 바로 그것이다).
 */
export function returnStepDecision(
  type: 'CANCEL' | 'RETURN',
  status: ClaimStatus,
  from: ClaimStatus,
  to: ClaimStatus,
): ReturnStepDecision {
  if (type !== 'RETURN') return { outcome: 'refused', reason: 'not_a_return' }
  if (status !== from && status !== to) return { outcome: 'refused', reason: 'wrong_status' }

  return { outcome: 'allowed' }
}

/**
 * 반품이 **확정된 것으로 세어지는** 상태 (TASK-0071).
 *
 * `cancel-rules.ts` 의 `CANCEL_SETTLED` 와 **같은 장치이고 같은 이유**다 — 아직
 * 판단 전인 신청까지 세면 판매자가 거절할 반품 하나가 주문을 `RETURNED` 로 닫고,
 * 전이표에 거기서 돌아오는 화살표는 없다.
 *
 * 세는 자리가 취소보다 **뒤**인 것이 이 표의 요점이다. 취소는 승인이 곧 확정이지만
 * (물건이 아직 떠나지 않았다) 반품은 **물건이 돌아와 검수를 통과해야** 확정이다 —
 * `RETURN_APPROVED` 를 세면 승인만 받고 물건을 안 보낸 반품이 주문을 닫는다.
 *
 * `REFUNDED` 가 함께 있는 것은 그것이 완료의 **다음** 자리이기 때문이다. 환불까지
 * 끝난 반품이 「확정되지 않은 반품」으로 읽히면, 두 번째 부분 반품이 들어올 때 첫
 * 번째가 세어지지 않는다 (`CANCEL_SETTLED` 가 같은 이유로 같은 모양이다).
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 막는다.**
 */
export const RETURN_SETTLED: Readonly<Record<ClaimStatus, boolean>> = {
  /** 검수를 통과했다. 물건이 우리 손에 있고 되돌릴 것도 없다. */
  RETURN_COMPLETED: true,
  /** 환불까지 끝난 반품. 완료의 다음 자리라 함께 센다. */
  REFUNDED: true,
  // 아직 물건이 돌아오지 않았거나, 돌아왔지만 검수에서 떨어졌다.
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_REJECTED: false,
  // 취소는 반품이 아니다. 그 몫은 `CANCELED` 로 끝난다 (`CANCEL_SETTLED`).
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: false,
  CANCEL_REJECTED: false,
}

/** 같은 목록을, 질의에 그대로 실을 수 있는 모양으로. 두 벌로 적지 않는다. */
export const returnSettledStatuses: readonly ClaimStatus[] = claimStatuses.filter(
  (status) => RETURN_SETTLED[status],
)

/**
 * 한 주문 항목이, 「이 몫이 전부 돌아왔는가」 판단에 필요한 만큼.
 *
 * 두 수 다 **이 완료가 반영된 뒤의 값**이다. 완료 전 값으로 판단하면 마지막 한 개가
 * 돌아오는 순간이 언제나 「부분」이 된다 (`CancelLine` 과 같은 판단).
 */
export interface ReturnLine {
  /** Original quantity less settled cancellations. */
  readonly ordered: number
  /** 반품이 확정된 수량 ({@link RETURN_SETTLED} 인 클레임들의 합). */
  readonly returned: number
}

export type ReturnScope =
  /** 이 몫에 남은 것이 없다. `SellerOrder` 가 `RETURNED` 로 간다. */
  | 'FULL'
  /** 남은 항목은 그대로다. 상태를 옮기지 않는다. */
  | 'PARTIAL'

/**
 * 이 반품으로 판매자 몫이 끝나는가 (TASK-0071).
 *
 * **정의가 `cancelScopeOf` 와 같다** — 「전체」는 한 신청의 크기가 아니라 **그 뒤에
 * 남은 것의 크기**다. 세 개를 하나씩 세 번 나눠 반품하면 어느 신청도 「전체」가
 * 아니지만, 세 번째가 마지막 한 개를 데려가면서 답이 `FULL` 로 바뀌어야 한다.
 *
 * 그런데 **타입을 함께 쓰지 않는다.** 세는 대상이 다르기 때문이다 — 저쪽은 취소된
 * 수량이고 여기는 반품된 수량이며, 한 인터페이스에 담으면 `canceled` 라는 이름의
 * 칸에 반품 수량이 들어간다. 그 거짓말은 질의를 읽는 사람에게 그대로 옮는다.
 *
 * 빈 목록을 따로 막지 않는다. 항목이 없는 판매자 몫은 주문 생성이 만들지 않고,
 * 닿을 수 없는 분기를 두면 이 파일의 분기 100% 가 거짓이 된다.
 */
export function returnScopeOf(lines: readonly ReturnLine[]): ReturnScope {
  return lines.every((line) => line.returned >= line.ordered) ? 'FULL' : 'PARTIAL'
}
