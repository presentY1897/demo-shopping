import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 대시보드가 숫자와 시각을 그리는 방식, 한 곳에.
 *
 * `lib/claims/format.ts` · `lib/coupons/format.ts` · `lib/settlements/format.ts` 와
 * 같은 쌍이고 같은 이유로 있다. **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도
 * 자릿수도 통화 코드에서 나오고, 그것을 손으로 적는 순간 카탈로그를 지나지 않은
 * 한국어가 화면에 생긴다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다. 없으면 서버 렌더는 컨테이너의 시간대로,
 * 브라우저는 방문자의 시간대로 **같은 순간을 다른 날**로 그린다. 이 화면에서 그것은
 * 두 가지를 한꺼번에 망친다 — 추이 표의 하루가 밀리고, 「배치가 마지막으로 돈 시각」이
 * 아홉 시간 어긋난다. 뒤엣것은 「멈췄나」를 눈으로 판단하는 자리라 더 나쁘다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

export function dashboardMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/**
 * 그냥 수 — 주문 수 · 가입 수 · 처리 대기 건수.
 *
 * `String(n)` 으로 적지 않는 이유는 자릿수다. 이 화면은 거래액 옆에 주문 수를 나란히
 * 놓으므로, 한쪽만 세 자리 구분이 없으면 두 수가 같은 종류로 보이지 않는다.
 */
export function dashboardCount(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

/** 추이 표의 하루. 계약이 싣는 것은 **KST 달력 날짜**라 시각이 없다. */
export function dashboardDay(date: string): string {
  return formatDate(date, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })
}

/** 배치가 **언제** 마지막으로 돌았나. 여기서는 분까지가 뜻이 있다. */
export function dashboardDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}
