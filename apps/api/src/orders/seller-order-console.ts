import type { OrderStatus, SellerOrderSummary } from '@shopping/shared'

/**
 * 판매자 콘솔이 목록과 뱃지를 그리기 전에 서버가 내리는 판단들 (TASK-0060).
 *
 * 데이터베이스도 시계도 보지 않는다. 그래서 분기 전부가 단위 테스트에서 닿고, 이
 * TASK 의 Q5 는 **분기 커버리지 100%** 다 — 뒤집어 말하면 **닿을 수 없는 방어 분기를
 * 쓰지 않는다** (`seller-product-filters.ts` 가 같은 이유로 같은 모양이다).
 *
 * 셋 다 틀려도 빨간 테스트가 되지 않는 종류다. 마스킹이 한 칸 어긋나면 이름이 그대로
 * 나가는데 화면은 정상으로 보이고, 뱃지의 상태 집합이 어긋나면 판매자가 처리할 것이
 * 없는데 「3건 대기」가 뜨거나 있는데 0이 뜬다.
 */

/** 가려진 자리를 채우는 글자. */
const MASK = '*'

/**
 * 목록에 나갈 수령인 이름 — `홍길동` → `홍*동` (F6).
 *
 * **서버가 가린다.** 화면이 가리는 구조로 두면 전체 이름이 이미 브라우저에 도착해
 * 있고, 그때 가림은 표시 취향이지 보호가 아니다 — 개발자도구도 확장도 오류 보고도
 * 전부 원본을 본다. 데모 계정의 데이터라도 습관을 들인다는 것이 설계서의 문장이고,
 * 습관은 「어디서 가리는가」에 붙는다.
 *
 * 첫 글자와 끝 글자를 남기는 것은 판매자가 **문의 전화를 받는 사람**이기 때문이다.
 * 「홍*동 님이시죠」는 확인이 되지만 「***」는 아무 일도 하지 못한다.
 *
 * 코드 포인트로 세는 것(`[...name]`)은 이 값이 한국어만이 아니기 때문이다. UTF-16
 * 코드 유닛으로 자르면 서로게이트 쌍이 반으로 갈려 깨진 글자가 남는다.
 *
 * 두 글자를 `홍*` 으로 두는 이유: 끝을 남기면 `홍동` → `홍동` 이 되어 아무것도
 * 가리지 않는다.
 */
export function maskRecipientName(name: string): string {
  const characters = [...name.trim()]

  // 한 글자는 가릴 곳이 없다. 통째로 `*` 로 바꾸면 「이름이 있었다」는 사실까지
  // 지워지고, 목록에서 그 줄만 다른 종류로 보인다.
  if (characters.length <= 1) return characters.join('')

  const head = characters.slice(0, 1).join('')

  if (characters.length === 2) return `${head}${MASK}`

  return `${head}${MASK.repeat(characters.length - 2)}${characters.slice(-1).join('')}`
}

/**
 * 목록 한 줄의 제목 — 「울 코트」.
 *
 * **「외 2건」은 붙이지 않는다.** 개수는 `itemCount` 로 따로 나가고 문장은 화면이
 * 만든다 — `orderSummarySchema.headline` 이 구매자 쪽에서 하는 것과 같은 나눔이고,
 * 이유는 그 문장이 로케일마다 다르기 때문이다.
 *
 * 항목이 없는 몫은 빈 문자열이다. 있을 수 없는 상태지만 `null` 을 만들지 않는 것은,
 * 화면이 「제목이 없다」와 「제목을 못 읽었다」를 구분할 이유가 없기 때문이다.
 */
export function sellerOrderHeadline(productNames: readonly string[]): string {
  return productNames.slice(0, 1).join('')
}

/**
 * 뱃지가 세는 상태 — **신규 주문**.
 *
 * 결제는 끝났고 판매자가 아직 확인하지 않은 것 하나뿐이다. `PAYMENT_PENDING` 은
 * 결제를 기다리는 중이라 판매자에게 보여 줄 「새 주문」이 아니고, 그것을 세면
 * 결제창을 열어 놓고 떠난 사람 수가 판매자의 할 일로 보인다.
 */
export const SELLER_ORDER_NEW_STATUSES: readonly OrderStatus[] = ['PAID']

/**
 * 뱃지가 세는 상태 — **처리 대기**.
 *
 * 「판매자가 다음 행동을 해야 하는가」로 고른다. `PAID` 는 확인이, `PREPARING` 은
 * 발송이 남아 있다. `SHIPPED` 는 운송사가 움직이는 중이고 `DELIVERED` 는 구매자의
 * 확정을 기다리므로, 둘 다 판매자가 지금 할 일이 없다 — 그것을 세면 뱃지가 영영
 * 줄지 않고, 줄지 않는 뱃지는 곧 아무도 안 보는 뱃지다.
 *
 * **이 목록이 서버에 있는 이유**는 뱃지를 그리는 자리가 하나가 아니기 때문이다 —
 * 사이드바·대시보드·목록 탭이 각자 `counts` 를 더하면 상태가 하나 늘 때 한 곳만
 * 고쳐진다. 「지금 할 수 있는 것은 서버가 답한다」와 같은 판단이다.
 */
export const SELLER_ORDER_ACTION_REQUIRED_STATUSES: readonly OrderStatus[] = ['PAID', 'PREPARING']

/**
 * 상태 하나와 그 건수. `GROUP BY "status"` 가 돌려주는 줄 그대로다.
 */
export interface SellerOrderStatusCount {
  readonly status: OrderStatus
  readonly count: number
}

/**
 * 0건인 상태도 0을 갖는 표.
 *
 * `Object.fromEntries` 로 만들지 않고 전부 적는 것은 **상태가 하나 늘면 컴파일이
 * 깨져야** 하기 때문이다 (`sellerOrderTransitions` 가 같은 이유로 같은 모양이다).
 * 만들어 낸 표는 새 상태를 조용히 0으로 채우고 지나가는데, 그때 빠지는 것은 숫자가
 * 아니라 **그 상태를 뱃지에 세야 하는지에 대한 결정**이다.
 */
const ZERO_COUNTS: Readonly<Record<OrderStatus, number>> = {
  PAYMENT_PENDING: 0,
  PAYMENT_FAILED: 0,
  PAID: 0,
  PREPARING: 0,
  SHIPPED: 0,
  DELIVERED: 0,
  CONFIRMED: 0,
  CANCELED: 0,
  RETURNED: 0,
}

function sumOf(
  counts: Readonly<Record<OrderStatus, number>>,
  statuses: readonly OrderStatus[],
): number {
  return statuses.reduce((total, status) => total + counts[status], 0)
}

/**
 * 집계 줄들을 뱃지와 탭이 읽는 모양으로 (2장).
 *
 * **없는 상태를 0으로 채우는 것이 이 함수의 일 절반이다.** 안 채우면 「0건」 탭이
 * 숫자를 잃고, 화면은 「아직 못 읽었다」와 「0건이다」를 구분할 수 없게 된다.
 */
export function sellerOrderSummaryOf(rows: readonly SellerOrderStatusCount[]): SellerOrderSummary {
  const counts = { ...ZERO_COUNTS }

  for (const row of rows) counts[row.status] += row.count

  return {
    counts,
    newOrders: sumOf(counts, SELLER_ORDER_NEW_STATUSES),
    actionRequired: sumOf(counts, SELLER_ORDER_ACTION_REQUIRED_STATUSES),
  }
}
