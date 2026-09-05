import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 콘솔이 숫자와 시각을 그리는 방식, 한 곳에.
 *
 * **「원」을 붙이지 않는다** (설계서 공통 규칙). 기호도 자릿수도 통화 코드에서 나오고,
 * 그것을 손으로 적는 순간 첫 외화 주문에서 틀린다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다. 없으면 서버는 컨테이너의 시간대로,
 * 브라우저는 방문자의 시간대로 **같은 시각을 다르게** 그린다 — 주문일시가 하루씩
 * 어긋나 보이는 흔한 원인이 그것이다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** 이 데모의 판매자는 한국에 있다. 다국어가 붙으면 사용자 설정에서 온다. */
export const CONSOLE_TIME_ZONE = 'Asia/Seoul'

export function money(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

export function dateTime(isoString: string): string {
  return formatDate(isoString, {
    locale: LOCALE,
    style: 'dateTime',
    timeZone: CONSOLE_TIME_ZONE,
  })
}

export function day(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'date', timeZone: CONSOLE_TIME_ZONE })
}
