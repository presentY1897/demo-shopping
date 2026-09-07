import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 데모 관리 화면이 값을 그리는 방식, 한 곳에.
 *
 * `lib/dashboard/format.ts` · `lib/users/format.ts` 와 같은 쌍이고 같은 이유로 있다.
 * **「원」을 붙이지 않는다** (설계서 공통 규칙) — 가상 카드 한도는 금액이고, 기호도
 * 자릿수도 통화 코드에서 나온다.
 *
 * 시간대를 넘기는 것이 이 화면에서 특히 중요하다. 「언제 만료되나」와 「언제 정리가
 * 실패했나」를 아홉 시간 어긋나게 그리면, 운영자는 이미 지난 시각을 보고 「아직
 * 남았다」고 판단한다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/dashboard/format.ts` 의 시간대와 같다. */
const TIME_ZONE = 'Asia/Seoul'

/** 발급 시각 · 만료 예정 · 정리 실패 시각. 여기서는 분까지가 뜻이 있다. */
export function demoDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}

/** 통계 표의 하루. 계약이 싣는 것은 **KST 달력 날짜**라 시각이 없다. */
export function demoDay(date: string): string {
  return formatDate(date, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })
}

/** 발급 건수 · 활성 계정 수. 세 자리 구분이 없으면 옆의 금액과 다른 종류로 보인다. */
export function demoCount(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

/** 가상 카드 한도. 정책 화면에서 지금 값이 얼마인지 사람이 읽는 자리다. */
export function demoMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}
