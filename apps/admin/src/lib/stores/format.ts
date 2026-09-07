import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 스토어 지표를 그리는 방식, 한 곳에 (TASK-0094 F1).
 *
 * `lib/users/format.ts` · `lib/settlements/format.ts` 와 같은 쌍이고 같은 이유로
 * 있다. **「원」을 붙이지 않는다** (설계서 공통 규칙) — 기호도 자릿수도 통화 코드에서
 * 나오고, 그것을 손으로 적는 순간 카탈로그를 지나지 않은 한국어가 화면에 생긴다.
 *
 * ## 100배 정수를 되돌리는 나눗셈이 **이 파일에만 있다**
 *
 * 계약은 클레임률도 평점도 정수 100배로 싣는다 — 3.5% 가 `350`, 4.2점이 `420` 이다
 * (`adminSellerMetricsSchema`). 소수를 실으면 화면마다 반올림이 달라지고 두 화면이
 * 같은 스토어를 다른 수로 그리기 때문인데, **되돌리는 쪽이 여러 곳에 흩어지면 같은
 * 일이 그대로 일어난다.** 그래서 나누는 자리는 {@link fromHundredths} 하나다.
 *
 * ## 두 지표 모두 「없다」가 0과 다르다
 *
 * 클레임률은 주문이 없으면 `null` 이다 — 0이 아니다. 「클레임이 한 건도 없는 좋은
 * 스토어」와 「아직 아무것도 안 판 스토어」는 다른 사실이고, 0으로 그리면 신규 스토어가
 * 클레임률 정렬의 맨 위에 앉는다 (4.5). 평점도 같은 성질이라 여기서 같은 판정을
 * 한다: 리뷰가 한 건도 없는 스토어의 `ratingAvg` 는 0으로 오는데, 그것을 「0.0점」으로
 * 그리면 **가장 나쁜 스토어처럼 보인다.**
 *
 * 두 함수 다 `null` 을 돌려주고 **문장은 만들지 않는다.** 「판매 없음」은 한국어라
 * 카탈로그의 것이다 (CLAUDE.md 6장).
 */

const LOCALE = 'ko-KR'

const CURRENCY = 'KRW'

/** `lib/users/format.ts` 의 시간대와 같다. */
const TIME_ZONE = 'Asia/Seoul'

/** 계약이 싣는 정수의 배율. 3.5% 가 `350`, 4.2점이 `420` 이다. */
const HUNDREDTHS = 100

/** 퍼센트 서식기는 **비율**을 받는다 — 3.5% 는 0.035 다. */
const PERCENT_SCALE = 100

/** ×100 정수를 실제 값으로. **이 나눗셈은 여기 한 번만 있다.** */
function fromHundredths(value: number): number {
  return value / HUNDREDTHS
}

const PERCENT = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: 'percent',
})

const RATING = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

const COUNT = new Intl.NumberFormat(LOCALE)

/**
 * 클레임률, 또는 **한 건도 팔지 않은 스토어의 `null`** (4.5).
 *
 * 0%를 그리지 않는 것이 이 함수의 전부다. 0으로 그리면 클레임률 낮은 순의 맨 위가
 * 신규 스토어로 채워지고, 그것을 보러 온 사람은 정작 봐야 할 스토어를 못 본다.
 */
export function storeClaimRate(claimRateBp: number | null): string | null {
  return claimRateBp === null ? null : PERCENT.format(fromHundredths(claimRateBp) / PERCENT_SCALE)
}

/**
 * 평점, 또는 **리뷰가 한 건도 없는 스토어의 `null`**.
 *
 * `ratingAvg` 는 리뷰가 없어도 0으로 온다(`admin-seller.service.ts` 의 `COALESCE`).
 * 그 0을 그대로 그리면 아무도 평가한 적 없는 스토어가 **0.0점짜리 스토어**로 서고,
 * 그것은 클레임률의 0%와 정확히 같은 종류의 거짓말이다.
 */
export function storeRating(ratingAvg: number, ratingCount: number): string | null {
  return ratingCount === 0 ? null : RATING.format(fromHundredths(ratingAvg))
}

/** 매출. 정수(원 단위)이고 통화 정보는 서식기가 붙인다. */
export function storeMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

/** 주문 수 · 클레임 수 · 상품 수 · 팔로워 수. 세 자리 구분이 없으면 옆의 금액과 종류가 달라 보인다. */
export function storeCount(value: number): string {
  return COUNT.format(value)
}

/** 개설일. 스토어가 언제 생겼는지에 시각까지는 뜻이 없다. */
export function storeDate(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, timeZone: TIME_ZONE })
}

/**
 * 이력이 움직인 순간 — **분까지.**
 *
 * 한 트랜잭션 안에서 두 번 옮기면 시각이 같을 수 있고, 그때 순서를 말하는 것은 표의
 * 줄 순서다(서버가 `id` 를 함께 보고 정렬한다). 날짜만 그리면 같은 날 안의 순서가
 * 화면에서 사라진다.
 */
export function storeDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}
