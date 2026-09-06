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
   * 그 상태에서 그 상태로 가는 길이 **없다** (TASK-0059 F2).
   *
   * `params` 에 `from`·`to` 를 싣는다. 고쳐도 안 되는 거절이다 — 다른 사람이 부르든
   * 무엇을 채우든 이 화살표는 존재하지 않는다. 대개 화면이 낡은 상태를 들고 있는
   * 것이므로 할 일은 다시 읽는 것이다.
   */
  'ORDER_TRANSITION_UNDEFINED',
  /**
   * 길은 있는데 **이 주체가 지날 수 없다** (F3).
   *
   * 세 거절을 하나로 묶지 않는 이유가 이것이다. 이것은 「다른 사람이면 된다」이고,
   * 위의 것은 「아무도 안 된다」이며, 아래의 것은 **「채우면 된다」**다 — 사람이 할
   * 일이 셋 다 다르다.
   */
  'ORDER_TRANSITION_FORBIDDEN',
  /**
   * 길도 있고 주체도 맞는데 **조건이 모자란다** (F4).
   *
   * 셋 중 유일하게 **부르는 쪽이 고칠 수 있는** 거절이다. 그래서 `details` 가
   * 모자란 것의 입력 이름을 들고 간다(운송장이면 `trackingNumber`) — 화면은 그
   * 입력에 「운송장을 먼저 등록해 주세요」를 띄우면 되고, 버튼을 감출 필요가 없다.
   */
  'ORDER_TRANSITION_REQUIREMENT',
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
   * 결제창이 돌려준 금액이 주문 금액과 다르다 (TASK-0055 F2).
   *
   * **PG 연동에서 가장 비싼 실수를 막는 코드다.** 리다이렉트의 쿼리스트링은
   * 사용자가 고칠 수 있는 값이라, 그것을 그대로 믿고 승인하면 조작된 금액으로
   * 결제가 끝난다. 서버는 DB 의 승인액과 대조하고 어긋나면 **결제사를 부르기
   * 전에** 멈춘다 — 부르고 나서 거절하면 저쪽에는 승인이 남고 우리 장부에는
   * 남지 않는 훨씬 나쁜 모양이 된다.
   */
  'PAYMENT_AMOUNT_MISMATCH',
  /** 그 결제수단으로 시작한 결제가 아니다 — 토스 승인 라우트에 가상 카드 결제를 준 경우다. */
  'PAYMENT_PROVIDER_MISMATCH',
  /**
   * 이 주문에 **결과를 모르는 결제**가 있다 (TASK-0056 · D-220).
   *
   * 결제사에 닿지 못해 승인됐는지 모르는 건이 있으면 **다시 결제하게 두지
   * 않는다.** 저쪽에서 승인이 나 있었다면 두 번 빠지고, 그 두 번째는 우리가
   * 만든 것이다. 대사가 그 건을 풀면 자동으로 열린다.
   */
  'PAYMENT_AWAITING_RESULT',
  /**
   * 환불 누계가 승인액을 넘는다 (F4). `params.refundable` 을 싣는다.
   *
   * 금액을 함께 보내는 이유는 「환불할 수 없습니다」로 끝나는 화면이 상담원에게
   * 아무 도움이 안 되기 때문이다 — 「최대 12,000원까지」는 다음 행동을 알려 준다.
   */
  'PAYMENT_REFUND_EXCEEDS',
  /** 카드 한도나 결제 금액이 0 이하이거나 원 단위가 아니다 (TASK-0053). */
  'CARD_AMOUNT_INVALID',
  /**
   * 가질 수 있는 **장수**를 넘었다. `params.max` 를 싣는다.
   *
   * 한도 초과(`CARD_LIMIT_EXCEEDED`)와 **다른 코드**다. 이름이 비슷해서 헷갈리기
   * 쉬운데, 하나는 카드를 더 만들 수 없다는 것이고 하나는 이 카드로 더 결제할 수
   * 없다는 것이라 사람이 할 일이 정반대다 — 앞은 카드를 지우는 것이고 뒤는 다른
   * 카드를 고르는 것이다.
   */
  'CARD_COUNT_REACHED',
  /** 정지·삭제된 카드다. 금액을 고쳐도 소용없다. */
  'CARD_UNUSABLE',
  /** 잔여 한도를 넘는 결제다. `params.available` 을 싣는다. */
  'CARD_LIMIT_EXCEEDED',
  /** 쓴 것보다 많이 돌려주려 했다. `params.releasable` 을 싣는다. */
  'CARD_RELEASE_EXCEEDS',
  /** 유효기간이 지난 카드다. */
  'CARD_EXPIRED',
  /**
   * 반품 사진이 필요한데 없다 (TASK-0067).
   *
   * 하자·오배송은 판매자에게 **돈을 물리는 주장**이라 근거가 없으면 판매자가 할 수
   * 있는 일이 거절뿐이다. 단순 변심에는 반대로 **첨부를 금지**한다 — 뒤집을 것이
   * 없어 받아 두면 아무도 안 보는 이미지와 지우지 못하는 개인정보만 쌓인다.
   */
  'RETURN_PHOTO_REQUIRED',
  /** 단순 변심에 사진을 붙였다. */
  'RETURN_PHOTO_NOT_ALLOWED',
  /** 사진이 너무 많다. `params.max` 를 싣는다. */
  'RETURN_PHOTO_TOO_MANY',
  /** 같은 사진을 두 번 붙였다. */
  'RETURN_PHOTO_DUPLICATE',
  /**
   * 남의 사진이다.
   *
   * 열쇠 접두어가 **올린 사람**이라(`returns/{userId}/…`) 조회 한 번 없이 판단된다.
   */
  'RETURN_PHOTO_FOREIGN',
  /**
   * 클레임 신청이 거절된 여섯 (TASK-0065 · `claim-rules.ts` 의 `ClaimRefusal`).
   *
   * **여섯을 하나로 묶지 않는 이유는 사람이 할 일이 다르기 때문이다.** 그리고
   * 이 여섯에는 순서가 있다 — 배송 중인 주문에 「수량이 모자랍니다」라고 답하면
   * 수량을 고쳐 다시 시도하게 되고, 또 거절당한다. 코드가 하나면 그 순서를
   * 표현할 방법 자체가 없다.
   */
  /** 배송 중이다. 취소하기엔 떠났고 반품하기엔 안 왔다 — 기다리는 수밖에 없다. */
  'CLAIM_IN_TRANSIT',
  /**
   * 구매확정했다. 일반 반품은 끝났고 관리자 개입만 남는다.
   *
   * 기간 만료(`CLAIM_WINDOW_CLOSED`)와 **다른 코드**다. 확정한 주문에 「기간이
   * 지났습니다」는 반쯤 맞는 말이라 더 나쁘다 — 기다렸으면 됐다는 뜻으로 읽힌다.
   */
  'CLAIM_ORDER_CONFIRMED',
  /** 반품 기간이 지났다. `params.deadline` 에 기간의 끝을 싣는다. */
  'CLAIM_WINDOW_CLOSED',
  /** 이 상태의 주문에는 애초에 클레임이 없다 — 결제 전이거나 이미 취소됐다. */
  'CLAIM_NOT_CLAIMABLE',
  /**
   * 남은 수량보다 많이 신청했다. `params.remaining` 을 싣는다.
   *
   * **동시 신청에서 진 쪽이 받는 코드이기도 하다** (R1). 그래서 숫자를 함께
   * 보낸다 — 「신청할 수 없습니다」로 끝나는 화면은 방금 다른 창에서 하나를 먼저
   * 신청한 사람에게 아무것도 알려 주지 않는다.
   */
  'CLAIM_EXCEEDS_REMAINING',
  /** 0개 이하를 신청했다. */
  'CLAIM_INVALID_QUANTITY',
  /** 신청한 항목이 이 주문의 것이 아니다 (`ORDER_ITEM_MISSING` 과 같은 종류). */
  'CLAIM_ITEM_MISSING',
  /**
   * 그 상태에서 그 상태로 가는 길이 **없다** (TASK-0065 F7).
   *
   * `params` 에 `from`·`to` 를 싣는다. 주문 쪽 `ORDER_TRANSITION_UNDEFINED` 와
   * 같은 뜻이고 **다른 코드**인 이유는 화면이 다르기 때문이다 — 클레임 화면이
   * 주문 문장을 보여 주면 「주문 상태가 바뀌었어요」가 반품 상세에 뜬다.
   */
  'CLAIM_TRANSITION_UNDEFINED',
  /**
   * 길은 있는데 **이 주체가 지날 수 없다.**
   *
   * 이 코드가 실제로 막는 것 하나: **신청자가 자기 클레임을 승인하는 것.** 전이표
   * 어느 화살표에도 `BUYER` 가 없고, 그 사실이 밖으로 나오는 자리가 여기다.
   */
  'CLAIM_TRANSITION_FORBIDDEN',
  /**
   * **거절인데 사유가 없다** (TASK-0070 5장).
   *
   * 화면이 먼저 막지만 그것은 친절이고, 규칙은 여기 있다 — 화면만 막으면 API 를
   * 직접 부르는 길이 남고, 그 길로 들어온 거절은 **구매자가 왜 거절당했는지 아무도
   * 말할 수 없는 행**이 된다. 분쟁에서 관리자가 읽을 것이 그 한 줄뿐이다
   * (TASK-0071 이 개입하는 자리).
   *
   * 승인·수거·입고에는 걸지 않는다. 정상 흐름마다 빈 칸을 채우게 하면 그 칸은 곧
   * 「.」 으로 채워지고, 그때 거절 사유도 함께 무의미해진다.
   */
  'CLAIM_REASON_REQUIRED',
  /**
   * 판매자가 자기 스토어 밖까지 덮는 쿠폰을 발행하려 했다 (TASK-0072 F2).
   *
   * **403 이고 `FORBIDDEN` 이 아니다.** 저것은 「당신의 역할로는 이 일을 할 수
   * 없다」이고 이것은 「당신은 쿠폰을 낼 수 있는데 이 범위로는 낼 수 없다」다 —
   * 앞은 권한을 구하러 가는 일이고 뒤는 범위를 좁히는 일이라, 화면이 할 말이
   * 다르다 (`PRODUCT_SELLER_INACTIVE` 와 같은 나눔).
   *
   * `details` 가 `scopeType` 또는 `scopeIds` 를 가리키므로, 발행 화면은 그 칸에
   * 문장을 붙이고 버튼을 감추지 않아도 된다.
   */
  'COUPON_SCOPE_FORBIDDEN',
  /**
   * 준비된 발급 수량이 모두 나갔다 (F5 · F6).
   *
   * **동시 발급에서 진 쪽이 받는 코드이기도 하다.** 잔여 1장에 열 건이 들어오면
   * 아홉이 이것을 받는다 — 조건부 갱신이 0행으로 지는 자리이고, DB 의
   * `Coupon_issued_count_check` 가 그 뒤에 한 겹 더 서 있다.
   */
  'COUPON_ISSUE_EXHAUSTED',
  /**
   * 같은 쿠폰을 두 번 받으려 했다 (F4).
   *
   * 소진(`COUPON_ISSUE_EXHAUSTED`)과 **다른 코드**다. 이미 가진 사람에게 「다
   * 나갔어요」라고 답하면 자기 쿠폰함에 있는 쿠폰을 찾지 못한 채 서두르게 된다 —
   * 그래서 서버가 진 이유를 가릴 때 중복을 먼저 본다.
   */
  'COUPON_ALREADY_ISSUED',
  /**
   * 그런 쿠폰 코드가 없다 (F8).
   *
   * **형식이 틀린 코드도 같은 코드로 답한다.** 갈라 답하면 코드를 찍어 보는 쪽에
   * 「형식은 맞다」는 힌트가 되고, 그 힌트가 탐색 공간을 좁힌다.
   */
  'COUPON_CODE_UNKNOWN',
  /** 아직 발급 기간이 시작되지 않았다. **기다리면 되는** 거절이다. */
  'COUPON_NOT_STARTED',
  /**
   * 발급 기간이 끝났다.
   *
   * 위와 나누는 이유는 사람이 할 일이 다르기 때문이다 — 하나는 기다리는 것이고
   * 하나는 포기하는 것이라, 한 코드로 답하면 화면은 둘 중 하나를 반드시 틀리게
   * 말한다.
   */
  'COUPON_ENDED',
  /**
   * 고른 쿠폰을 이 주문에는 쓸 수 없다 (TASK-0075 F2 · F4).
   *
   * **사유는 `details[0].params.reason` 에 있다.** 코드를 사유마다 나누지 않은
   * 이유는 화면이 하는 일이 같기 때문이다 — 그 쿠폰의 선택을 풀고 사유를 그 자리에
   * 적는다. 코드를 여섯 개로 나누면 화면은 여섯 갈래를 만들어 같은 일을 여섯 번
   * 하게 되고, 사유가 하나 늘 때마다 화면이 먼저 깨진다.
   *
   * 반대로 문장만 내려보내지 않는 이유는 **문장을 보고 분기하는 화면**을 만들지
   * 않기 위해서다. 서버가 문구를 다듬는 순간 그 화면은 조용히 망가진다.
   */
  'COUPON_NOT_APPLICABLE',
  /**
   * 주문을 만드는 사이에 그 쿠폰이 다른 주문에 쓰였다 (F5).
   *
   * **동시 사용에서 진 쪽이 받는 코드다.** 한 장을 두 탭에서 「주문하기」 하면
   * 조건부 갱신(`WHERE "status" = 'ISSUED'`)이 하나만 통과시키고, 진 쪽은 주문
   * 트랜잭션 전체가 롤백된다 — 쿠폰 없이 주문을 만들어 주면 사는 사람이 동의한 적
   * 없는 금액이 결제되기 때문이다.
   *
   * 409 이고 400 이 아니다. 입력이 틀린 것이 아니라 **그 사이에 세상이 바뀐 것**
   * 이라, 화면이 할 일은 고치라고 말하는 것이 아니라 주문서를 다시 읽는 것이다.
   */
  'COUPON_ALREADY_USED',
  /**
   * 체험용으로 발행된 쿠폰을 실계정이 받으려 했다 (TASK-0073).
   *
   * **403 이고 「없는 쿠폰」이 아니다.** 코드는 맞게 쳤고 쿠폰도 있다 — 다만 그것을
   * 낸 것이 방문자의 관리자 계정이라 실계정에 갈 수 없다. 없는 것처럼 답하는 길도
   * 있지만, 그러면 진짜로 코드를 잘못 친 사람과 같은 답을 받아 계속 다시 친다.
   *
   * 반대 방향은 거절이 아니다: 진짜 쿠폰을 체험 계정이 받는 것은 방문자가 진짜
   * 흐름을 겪는 일이고, 그 주문 자체가 체험 데이터다.
   */
  'COUPON_DEMO_ONLY',
  /**
   * 발행자가 멈춘 쿠폰을 받으려 했다 (TASK-0073 F5).
   *
   * **소진과 다른 코드다.** 「다 나갔어요」를 받은 사람은 자기가 늦었다고 읽고 다음
   * 캠페인을 기다리지만, 멈춘 쿠폰은 발행자가 다시 열 수도 있는 것이라 사람이 할 일이
   * 다르다 — `COUPON_NOT_STARTED` 와 `COUPON_ENDED` 를 나눈 것과 같은 판단이다.
   *
   * **이미 받은 장에는 아무 일도 일어나지 않는다.** 중단은 「더 나가지 않게」이지
   * 「나간 것을 무르게」가 아니므로, 이 코드는 발급하는 자리에서만 나온다.
   */
  'COUPON_SUSPENDED',
  /**
   * 적립금이 모자란다 (TASK-0076 F4).
   *
   * `params.available` 에 **지금 쓸 수 있는 금액**을 싣는다. 「잔액이 부족합니다」
   * 만으로는 사람이 다음에 무엇을 할지 정할 수 없고, 화면이 자기가 마지막으로 읽은
   * 잔액을 적으면 그 숫자는 방금 다른 탭에서 쓴 금액을 모른다 — 거절을 만든 쪽이
   * 그 순간의 값을 함께 보내야 참인 문장이 된다.
   */
  'POINT_INSUFFICIENT',
  /** 0 이하이거나 원 단위 정수가 아닌 적립금 금액. */
  'POINT_AMOUNT_INVALID',
  /**
   * 같은 참조로 이미 기록된 적립금 사건이다 (F6).
   *
   * 오류처럼 보이지만 **멱등이 지켜졌다는 뜻**이다 — 같은 구매확정이 두 번 도착했고
   * 두 번째가 `PointTransaction_ref_key` 에 막혔다. 부르는 쪽이 배치라면 세고 넘어갈
   * 일이고, 사람이라면 「이미 처리됐어요」다.
   */
  'POINT_ALREADY_RECORDED',
  /**
   * 지금 상태에서는 할 수 없는 정산 처리다 (TASK-0081 F5).
   *
   * 「지급완료된 정산서는 수정할 수 없다」가 이 코드로 나온다. **화면이 버튼을
   * 가리고 있어도 온다** — 다른 관리자가 방금 지급 처리했을 수 있고, 그때 이 답은
   * 「당신이 틀렸다」가 아니라 「목록을 다시 읽어 보라」는 뜻이다.
   */
  'SETTLEMENT_WRONG_STATUS',
  /**
   * 리뷰를 쓸 수 없는 네 가지 (TASK-0083 F3).
   *
   * 넷을 나누는 이유는 **사람이 할 일이 다르기** 때문이다. 아직 안 온 것은 기다리면
   * 되고, 이미 쓴 것은 고치면 되며, 기한이 지난 것은 할 수 있는 일이 없고, 취소된
   * 것은 애초에 받은 적이 없다 — 한 코드로 답하면 화면은 넷 중 셋을 반드시 틀리게
   * 말한다.
   */
  'REVIEW_NOT_DELIVERED',
  'REVIEW_ALREADY_WRITTEN',
  'REVIEW_WINDOW_CLOSED',
  'REVIEW_ORDER_CANCELED',
  /**
   * 수정 기한이 지났다 (F5).
   *
   * 작성 기한과 나누는 이유도 같다 — 이쪽은 이미 쓴 사람에게 하는 말이고, 그 사람이
   * 알아야 하는 것은 「지금 보이는 리뷰가 최종본이다」이다.
   */
  'REVIEW_EDIT_WINDOW_CLOSED',
  /** 사진이 너무 많다. `params.max` 를 싣는다 — 화면이 숫자를 적어 두면 갈린다. */
  'REVIEW_IMAGE_TOO_MANY',
  /**
   * 남의 사진을 붙이려 했다.
   *
   * 없는 사진인지 남의 사진인지 **구분해 답하지 않는다.** 열쇠가 곧 소유자라,
   * 갈라 답하면 남의 열쇠를 넣어 보는 것만으로 존재를 알 수 있다 (반품 사진의
   * `RETURN_PHOTO_FOREIGN` 과 같은 판단).
   */
  'REVIEW_IMAGE_FOREIGN',
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
