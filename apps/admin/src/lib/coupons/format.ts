import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 쿠폰 화면이 숫자와 날짜를 그리는 방식, 한 곳에.
 *
 * `lib/claims/format.ts` · `lib/sellers/format.ts` 와 같은 쌍이고 같은 이유로 있다.
 * **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서 나오고,
 * 그것을 손으로 적는 순간 첫 외화 주문에서 틀린다. 시간대를 넘기는 것도 같은 종류의
 * 규칙이다: 없으면 서버 렌더는 컨테이너의 시간대로, 브라우저는 방문자의 시간대로
 * **같은 순간을 다른 날**로 그린다. 쿠폰에서 그것은 「9월 30일까지」가 사람마다 하루씩
 * 어긋나 보이는 일이다.
 *
 * **시각이 아니라 날짜로 적는다.** 계약이 싣는 것은 순간이지만 발행자가 정한 것은
 * 날짜이고(폼이 날짜를 받는다), 목록에 분 단위까지 그리면 자기가 고르지 않은 정밀도가
 * 화면에 나타난다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

export function couponMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/** 그냥 수 — 발급 장수처럼 통화가 아닌 값에 쓴다. */
export function couponCount(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

export function couponDate(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, timeZone: TIME_ZONE })
}
