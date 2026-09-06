import { formatDate, formatMoney } from '@shopping/ui/format'

/**
 * 클레임 화면이 숫자와 시각을 그리는 방식, 한 곳에.
 *
 * **「원」을 붙이지 않는다** (설계서 공통 규칙). 기호도 자릿수도 통화 코드에서 나오고,
 * 그것을 손으로 적는 순간 첫 외화 주문에서 틀린다.
 *
 * 시간대를 넘기는 것도 같은 종류의 규칙이다 — 없으면 서버 렌더는 컨테이너의
 * 시간대로, 브라우저는 방문자의 시간대로 **같은 시각을 다르게** 그린다. 기한이 하루씩
 * 어긋나 보이는 흔한 원인이 그것이고, 이 화면에서 그것은 「지연」의 정의가 흔들리는
 * 일이다. `lib/sellers/format.ts` 가 같은 쌍을 같은 이유로 넘긴다.
 */

const CURRENCY = 'KRW'

const LOCALE = 'ko-KR'

/** `claim-console.ts` 의 {@link CONSOLE_UTC_OFFSET} 과 같은 시간대다. */
export const CONSOLE_TIME_ZONE = 'Asia/Seoul'

export function claimMoney(amount: number): string {
  return formatMoney({ amount, currency: CURRENCY }, { locale: LOCALE })
}

export function claimDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: CONSOLE_TIME_ZONE })
}

/**
 * 계정 id 의 앞부분.
 *
 * 목록은 **이름이 아니라 id** 를 받는다(`adminClaimListItemSchema` — 목록에
 * 개인정보를 싣지 않는다). 서른여섯 자를 그대로 칸에 넣으면 다른 열을 전부 밀어내므로
 * 앞을 보여 주고, **전체 값은 버튼의 접근 가능한 이름과 `title` 에 남는다** — 줄인
 * 값만 남기면 그것으로는 아무것도 조회할 수 없다.
 */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
