import { formatDate } from '@shopping/ui/format'

/**
 * 알림함이 시각을 그리는 방식, 한 곳에.
 *
 * `lib/claims/format.ts` · `lib/reports/format.ts` 와 같은 쌍이고 같은 이유로 있다.
 * 시간대를 넘기지 않으면 서버 렌더는 컨테이너의 시간대로, 브라우저는 방문자의
 * 시간대로 **같은 순간을 다른 날**로 그린다. 알림에서 그것은 「방금 온 것」이
 * 「어제 것」으로 보이는 일이다.
 *
 * **상대 시각(「3분 전」)을 쓰지 않는다.** 그것은 그린 순간에만 맞는 문자열이라
 * 30초마다 다시 묻는 화면에서 목록만 새로 오고 문구는 그대로 남는 자리가 생기고,
 * 서버 렌더와 브라우저의 결과가 다르면 하이드레이션 경고가 된다.
 */

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

export function notificationDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}
