import { formatDate, formatMoney } from '@shopping/ui/format'

import { RATE_PERCENT_DECIMALS } from './rate-bp'

/**
 * 수수료 화면이 숫자와 시각을 그리는 방식, 한 곳에.
 *
 * `lib/coupons/format.ts` · `lib/claims/format.ts` 와 같은 쌍이고 같은 이유로 있다.
 * **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서
 * 나온다. 시간대를 넘기는 것도 같은 종류의 규칙이다: 없으면 서버 렌더는 컨테이너의
 * 시간대로, 브라우저는 방문자의 시간대로 **같은 순간을 다른 날**로 그린다. 이력에서
 * 그것은 「언제 바뀌었나」가 사람마다 하루씩 어긋나 보이는 일이다.
 *
 * **이력은 날짜가 아니라 시각까지 적는다.** 요율은 하루에 두 번 바뀔 수 있고
 * (그리고 서버는 같은 순간의 재수정을 한 줄로 접는다), 날짜만 적으면 같은 날의 두
 * 줄이 구분되지 않는다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

export function commissionMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

export function commissionDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}

/**
 * 요율 하나를 읽는 문자열로 — `350` → `3.5%`.
 *
 * **기호를 손으로 붙이지 않는다.** `Intl` 의 백분율 서식이 기호의 자리와 사이의
 * 공백까지 로케일에서 가져오고, `%` 를 문자열에 적는 순간 그것이 카탈로그를 지나지
 * 않은 한국어가 된다 (CLAUDE.md 6장 — 문구 하드코딩 금지).
 *
 * 나눗셈이 여기 있어도 되는 이유는 **이 값이 어디로도 나가지 않기** 때문이다. 화면에
 * 그릴 문자열을 만드는 마지막 단계이고, `Intl` 이 소수점 아래 둘째 자리에서 끊으므로
 * 부동소수의 꼬리는 서식에 닿지 못한다. 요청으로 나가는 값은 언제나 `rate-bp.ts` 의
 * 정수 연산에서 온다.
 */
export function commissionPercent(rateBp: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    maximumFractionDigits: RATE_PERCENT_DECIMALS,
  }).format(rateBp / 10_000)
}
