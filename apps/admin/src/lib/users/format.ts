import { currencyFractionDigits, formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 회원 화면이 값을 그리는 방식, 한 곳에.
 *
 * `lib/dashboard/format.ts` · `lib/reports/format.ts` 와 같은 쌍이고 같은 이유로
 * 있다. **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서
 * 나오고, 그것을 손으로 적는 순간 카탈로그를 지나지 않은 한국어가 화면에 생긴다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다. 없으면 서버 렌더는 컨테이너의 시간대로,
 * 브라우저는 방문자의 시간대로 **같은 순간을 다른 날**로 그린다. 이 화면에서 그것은
 * 「언제 가입했나」와 「언제 정지됐나」를 하루씩 어긋나게 만든다.
 *
 * **가려진 값을 여기서 만들지 않는다** (F6 · 4.2). 마스킹은 서버의 일이고
 * (`personal-data.ts`), 목록의 한 줄은 이미 가려진 문자열을 받아 그대로 그린다 —
 * 화면마다 가리게 두면 한 화면이 잊는 날 그 화면만 전부 보여 주고, 그때 증상은
 * 오류가 아니라 **이미 공개된 개인정보**다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `lib/dashboard/format.ts` 의 시간대와 같다. */
const TIME_ZONE = 'Asia/Seoul'

/** 가입 시각 · 마지막 로그인 · 정지 시각. 여기서는 분까지가 뜻이 있다. */
export function userDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}

/** 결제 합계와 적립금 잔액. */
export function userMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/** 주문 수 · 리뷰 수 · 쿠폰 수. 세 자리 구분이 없으면 옆의 금액과 다른 종류로 보인다. */
export function userCount(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

/**
 * 조정 금액 — **부호를 반드시 그린다** (F5).
 *
 * 부호가 이 화면에서 **금액의 절반**이다. 「50,000원 조정했어요」는 지급인지 차감인지
 * 말하지 않고, 그 문장을 읽는 사람은 원장을 열어 보기 전까지 어느 쪽인지 알 수 없다.
 *
 * 조건문으로 「+」를 붙이지 않는다 — 서식기가 로케일의 부호를 알고, 손으로 붙이면
 * 0에 「+」가 붙는 자리가 하나 생긴다. `formatMoney` 를 쓰지 못하는 것은 그쪽이
 * `signDisplay` 를 받지 않기 때문이고(`packages/ui/src/format/money.ts`), 자릿수만은
 * 같은 함수에 물어 두 곳이 KRW 를 다르게 그리지 않게 한다.
 */
export function userSignedMoney(amount: number): string {
  const digits = currencyFractionDigits(CURRENCY, LOCALE)

  return new Intl.NumberFormat(LOCALE, {
    currency: CURRENCY,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    signDisplay: 'always',
    style: 'currency',
  }).format(amount / 10 ** digits)
}
