import { formatDate, formatMoney } from '@shopping/ui/format'

import { inclusiveEnd } from './settlement-console'

/**
 * 정산 화면이 숫자와 시각을 그리는 방식, 한 곳에.
 *
 * `lib/commissions/format.ts` · `lib/claims/format.ts` 와 같은 쌍이고 같은 이유로
 * 있다. **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서
 * 나오고, 손으로 적는 순간 그것이 카탈로그를 지나지 않은 한국어가 된다. 음수의
 * 부호와 그 자리도 `Intl` 이 정한다: 차감 줄과 마이너스 지급액이 이 화면에는 실제로
 * 나타나고(`settlementSchema` — 지난 회차의 반품이 이번 주 판매보다 크면 그렇다),
 * 「-₩120,000」인지 「₩-120,000」인지는 로케일의 답이지 우리의 답이 아니다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다. 없으면 서버 렌더는 컨테이너의
 * 시간대로, 브라우저는 방문자의 시간대로 **같은 순간을 다른 날**로 그린다. 정산에서
 * 그것은 회차의 경계가 하루씩 어긋나 보이는 일이고, 회차는 월요일 자정에 시작하므로
 * 어긋나면 **일요일**이 된다 — 가장 틀려 보이는 자리다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

export function settlementMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/** 회차의 경계에 쓴다. 시각은 언제나 자정이라 적을 이유가 없다. */
export function settlementDay(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })
}

/** 승인·보류·지급이 **언제** 있었나. 여기서는 분까지가 뜻이 있다. */
export function settlementDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}

/**
 * `8월 24일 ~ 8월 30일` — 회차 하나를 한 문장으로.
 *
 * 문장의 틀은 앱의 카탈로그가 준다(`{start}` · `{end}`). **끝은 포함하는 날**로
 * 그린다 — 계약의 `periodEnd` 는 다음 회차의 시작과 맞물린 열린 끝이라, 그대로
 * 그리면 이웃한 두 회차가 같은 날을 공유하는 것처럼 보인다 ({@link inclusiveEnd}).
 */
export function settlementPeriod(periodStart: string, periodEnd: string, template: string): string {
  return template
    .replace('{start}', settlementDay(periodStart))
    .replace('{end}', settlementDay(inclusiveEnd(periodEnd)))
}
