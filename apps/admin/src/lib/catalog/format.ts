import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 전체 상품·주문 화면이 값을 그리는 방식, 한 곳에 (TASK-0095).
 *
 * `lib/users/format.ts` · `lib/stores/format.ts` 와 같은 쌍이고 같은 이유로 있다.
 * **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서 나오고,
 * 그것을 손으로 적는 순간 카탈로그를 지나지 않은 한국어가 화면에 생긴다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다. 없으면 서버 렌더는 컨테이너의 시간대로,
 * 브라우저는 방문자의 시간대로 **같은 순간을 다른 날**로 그린다. 이 화면에서 그것은
 * 「언제 주문했나」를 하루씩 어긋나게 만들고, 기간 검색의 경계에서 CS 가 찾는 주문을
 * 목록 밖으로 밀어낸다 — 서버는 `Asia/Seoul` 로 자른다
 * (`admin-catalog.service.ts` 의 `AT TIME ZONE`).
 *
 * **가려진 이름을 여기서 만들지 않는다.** 마스킹은 서버의 일이고(`personal-data.ts`),
 * 목록의 한 줄은 이미 가려진 문자열을 받아 그대로 그린다 — 화면마다 가리게 두면 한
 * 화면이 잊는 날 그 화면만 전부 보여 주고, 그때 증상은 오류가 아니라 **이미 공개된
 * 개인정보**다 (4.3 · TASK-0093 4.2).
 */

const LOCALE = 'ko-KR'

const CURRENCY = 'KRW'

/** `lib/users/format.ts` 의 시간대와 같다. 서버가 기간을 자르는 시간대이기도 하다. */
const TIME_ZONE = 'Asia/Seoul'

const COUNT = new Intl.NumberFormat(LOCALE)

/** 결제 금액 · 취소 금액 · 상품 가격. */
export function catalogMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/** 재고 · 옵션 수 · 묶음 수. */
export function catalogCount(value: number): string {
  return COUNT.format(value)
}

/** 주문 시각 · 결제 시각. 여기서는 분까지가 뜻이 있다. */
export function catalogDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}

/**
 * 승인 시각, 또는 **아직 승인되지 않은 결제의 `null`**.
 *
 * `approvedAt` 은 nullable 이다(`adminOrderPaymentSchema`) — 승인 전에 끊긴 결제 시도가
 * 실제로 남는다. 빈칸으로 두면 「승인된 적 없음」과 「못 읽었다」가 섞이므로, 문장을
 * 고르는 일은 부르는 쪽에 넘긴다 (한국어는 카탈로그의 것이다).
 */
export function catalogApprovedAt(isoString: string | null): string | null {
  return isoString === null ? null : catalogDateTime(isoString)
}

/**
 * 판매가, 또는 **값이 정해지지 않은 상품의 `null`**.
 *
 * `minPrice` 는 살아 있는 조합에서 파생되는 값이라 조합이 없는 초안에서는 `null` 이다
 * (`productSummarySchema`). 0원으로 그리면 **공짜로 파는 상품**이 목록에 서고, 그것은
 * 관리자가 가장 먼저 눌러 볼 줄이다.
 */
export function catalogPrice(minPrice: number | null): string | null {
  return minPrice === null ? null : catalogMoney(minPrice)
}
