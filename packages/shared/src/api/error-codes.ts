import { httpErrorCodeSchema } from '../api-error.js'
import type { HttpErrorCode } from '../api-error.js'

/**
 * Codes a domain module raises on purpose, as opposed to the ones
 * {@link httpErrorCodeSchema} derives from an HTTP status.
 *
 * **Why they exist at all.** A status says how the transport ended; it does not
 * say what happened. `POST /categories`, `PATCH /categories/:id` and
 * `DELETE /categories/:id` can all answer 409, and until this list existed the
 * only thing separating "the address is taken" from "somebody saved first" from
 * "there are still children under it" was a Korean sentence — which a screen
 * then had to read, and which nobody could edit without breaking it silently
 * (TASK-0117 1장).
 *
 * **Why one list, in `packages/shared`.** The API throws these strings and each
 * app's message catalog is keyed by them. Two copies would let a typo become a
 * failure with no sentence at all, which is the failure mode nothing reports:
 * the request still fails, the screen still shows *something*, and no test is
 * red. Same reason gate C1 keeps the response schemas here.
 */
export const domainErrorCodes = [
  /**
   * The caller is not signed in.
   *
   * Replaces `UNAUTHORIZED`'s "인증 정보가 없어…" because what a person needs is
   * the next action, not the state of a header (TASK-0117 4.3).
   */
  'AUTH_REQUIRED',
  /**
   * One input did not pass the schema. Carried on a `details[]` entry, next to
   * the `field` it is about — never on the envelope, where it would say nothing
   * a 400 does not already say.
   */
  'INVALID',
  'CATEGORY_SLUG_TAKEN',
  'CATEGORY_VERSION_CONFLICT',
  'CATEGORY_HAS_CHILDREN',
  'CATEGORY_MAX_DEPTH',
  'CATEGORY_MOVE_INTO_SELF',
  'CATEGORY_REORDER_MISMATCH',
  'CATEGORY_PARENT_MISSING',
  'ATTRIBUTE_KEY_TAKEN',
  /**
   * Not in TASK-0117 4.2's table, and deliberately added: the attribute editor
   * loses the same race a category editor does, and leaving one of the two as a
   * bare `CONFLICT` would make "카탈로그 도메인의 실패는 코드를 갖는다" false in
   * exactly one place — the kind of exception that is never found again.
   */
  'ATTRIBUTE_VERSION_CONFLICT',
  /**
   * A definition cannot be retired because live products still carry its key.
   *
   * Carries `params.count` — how many. TASK-0031 F5 asked for the number and
   * could not have it: the refusal was a bare 409 whose only content was a
   * Korean sentence, and a screen cannot put a number into its own copy from
   * that. The count is the difference between "고칠 것이 하나쯤 있나 보다" and
   * "상품 47개를 먼저 손봐야 한다".
   */
  'ATTRIBUTE_IN_USE',
  /**
   * A listing cannot go on sale while a required attribute of its category is
   * empty (TASK-0113 4장).
   *
   * Distinct from `INVALID`, which is a value that is *wrong*. These are two
   * different repairs — one is "고쳐 주세요", the other is "아직 안 채우셨어요" —
   * and a draft is allowed to be in the second state but never the first.
   */
  'PRODUCT_ATTRIBUTES_REQUIRED',
  /** The axes expand past `PRODUCT_MAX_VARIANTS`. Carries `params.max`. */
  'PRODUCT_TOO_MANY_VARIANTS',
  /** `ACTIVE` was asked for with no orderable variant behind it. */
  'PRODUCT_NOT_SELLABLE',
  /**
   * The store's own state forbids this, not the caller's grants.
   *
   * A 403 like an ownership refusal and the opposite advice: `FORBIDDEN` means
   * "내 스토어가 맞는지 확인" and this means the store *is* theirs and is not
   * approved yet. Told apart by the code, because both are 403 and neither has
   * a field (TASK-0108 4장 · TASK-0113 4장).
   */
  'PRODUCT_SELLER_INACTIVE',
  /**
   * A SKU is already taken by another live variant of the same seller.
   *
   * One of two 409s on the product write path, and the one re-reading does not
   * fix. Duplicated option names and option values never reach here — the
   * combination planner refuses those as a 400 before anything is inserted — so
   * the only index that can still raise it is the seller's SKU one.
   */
  'PRODUCT_SKU_TAKEN',
  /** The other 409: somebody saved first. Re-reading fixes it. */
  'PRODUCT_VERSION_CONFLICT',
  /**
   * 담으려는 수량이 재고보다 많다 (TASK-0045 F2). `params.stock` 을 싣는다.
   *
   * `INVALID` 와 다른 이유: 요청이 틀린 것이 아니라 **세상이 바뀐 것**이다. 고칠
   * 것은 입력이 아니라 수량이고, 화면이 할 말도 「잘못 입력하셨습니다」가 아니라
   * 「N개까지 남았습니다」다.
   */
  'CART_STOCK_EXCEEDED',
  /**
   * 판매자가 정한 1회 최대 구매 수량을 넘었다 (F2b). `params.max` 를 싣는다.
   *
   * 재고 초과와 **다른 코드**다. 재고는 기다리면 늘어날 수 있고 이것은 늘어나지
   * 않는다 — 사람이 할 일이 다르다.
   */
  'CART_PURCHASE_LIMIT',
  /** 장바구니가 담을 수 있는 줄 수를 넘었다. `params.max` 를 싣는다. */
  'CART_FULL',
  /** 팔지 않는 것을 담으려 했다 — 내려간 상품이거나 중단된 조합이다. */
  'CART_ITEM_UNAVAILABLE',
  /**
   * 주문서에 들어가려는데 남은 것이 모자란다 (TASK-0048 F2). `params.available` 을
   * 싣는다.
   *
   * `CART_STOCK_EXCEEDED` 와 **다른 코드**다. 장바구니는 실물 재고를 보고 담을 때
   * 확인만 하지만(D-026) 여기는 **가용재고**를 보고 실제로 잡는다 — 남이 주문서에
   * 들고 있는 몫은 장바구니에서는 보이지 않고 여기서는 빠진다. 같은 코드로 묶으면
   * 「담을 땐 됐는데 왜 안 되냐」에 답할 수 없다.
   */
  'RESERVATION_SOLD_OUT',
  /**
   * 이미 해제된 예약을 확정하려 했다.
   *
   * TTL 이 지나 스케줄러가 풀어 준 뒤에 결제가 승인되면 이 모양이 된다. 조용히
   * 성공시키면 **없는 재고를 판다** — 결제를 되돌리는 것이 옳고, 그러려면 부르는
   * 쪽이 이 실패를 구분할 수 있어야 한다.
   */
  'RESERVATION_RELEASED',
  /** 이미 확정된 예약을 해제하거나 연장하려 했다 — 팔린 재고를 되돌리는 일이다. */
  'RESERVATION_CONFIRMED',
  /** 만료된 예약을 연장하려 했다. 되살리는 대신 다시 잡아야 한다. */
  'RESERVATION_EXPIRED',
  /**
   * 주문하려는 줄이 장바구니에 없다 (TASK-0049).
   *
   * 다른 탭에서 지웠거나 이미 주문한 줄이다. **일부만 주문하고 넘어가지 않는다** —
   * 사람이 보고 있는 화면과 다른 것을 사게 되는 쪽이 훨씬 나쁘다.
   */
  'ORDER_ITEM_MISSING',
  /** 주문하려는 것이 더는 팔리지 않는다 — 내려간 상품이거나 중단된 조합이다. */
  'ORDER_ITEM_UNAVAILABLE',
  /**
   * 1회 구매 수량 상한을 넘었다 (F9). `params.max` 를 싣는다.
   *
   * 장바구니가 이미 막지만 여기서 다시 막는다. API 를 직접 부르면 장바구니를 거치지
   * 않고, 상한이 그 사이에 내려갔을 수도 있다.
   */
  'ORDER_PURCHASE_LIMIT',
  /** 주문할 배송지가 없다 — 지워졌거나 남의 것이다. */
  'ORDER_ADDRESS_MISSING',
  /**
   * 지금 상태에서는 할 수 없는 결제 요청이다 (TASK-0052 F2).
   *
   * `params` 에 `from`·`to` 를 싣는다. 상태 이름을 사람에게 그대로 보여 주지는
   * 않지만, 문의를 받는 쪽이 「승인 전인데 매입을 눌렀다」를 알아야 한다.
   */
  'PAYMENT_TRANSITION_REFUSED',
  /** 환불 금액이 0 이하이거나 원 단위가 아니다. */
  'PAYMENT_REFUND_INVALID',
  /**
   * 환불 누계가 승인액을 넘는다 (F4). `params.refundable` 을 싣는다.
   *
   * 금액을 함께 보내는 이유는 「환불할 수 없습니다」로 끝나는 화면이 상담원에게
   * 아무 도움이 안 되기 때문이다 — 「최대 12,000원까지」는 다음 행동을 알려 준다.
   */
  'PAYMENT_REFUND_EXCEEDS',
] as const

export type DomainErrorCode = (typeof domainErrorCodes)[number]

/**
 * Every code a message catalog has to answer for.
 *
 * An app types its `errors` slice as `Record<UserFacingErrorCode, string>`, so
 * adding a code without adding a sentence fails `pnpm typecheck` rather than
 * showing a blank line to whoever hit the error (TASK-0117 4.7 J2).
 */
export const userFacingErrorCodes = [...httpErrorCodeSchema.options, ...domainErrorCodes] as const

export type UserFacingErrorCode = HttpErrorCode | DomainErrorCode

export function isDomainErrorCode(value: string): value is DomainErrorCode {
  return (domainErrorCodes as readonly string[]).includes(value)
}
