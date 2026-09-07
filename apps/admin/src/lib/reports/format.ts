import { formatDate } from '@shopping/ui/format'

/**
 * 신고 화면이 시각을 그리는 방식, 한 곳에.
 *
 * `lib/claims/format.ts` · `lib/settlements/format.ts` 와 같은 쌍이고 같은 이유로
 * 있다. 시간대를 넘기지 않으면 서버 렌더는 컨테이너의 시간대로, 브라우저는 방문자의
 * 시간대로 **같은 순간을 다른 날**로 그린다. 신고에서 그것은 「언제 들어온 신고인가」가
 * 하루씩 어긋나 보이는 일이고, 대기 줄을 오래된 것부터 훑는 사람에게 그 하루는 순서를
 * 바꾼다.
 *
 * **금액이 없다.** 이 화면에 돈이 나오지 않기 때문이고, 쓰지 않는 포맷터를 미리 두면
 * 다음 사람은 그것이 **왜** 안 불리는지를 먼저 알아내야 한다.
 */

const LOCALE = 'ko-KR'

/** `lib/claims/format.ts` 의 `CONSOLE_TIME_ZONE` 과 같은 시간대다. */
const TIME_ZONE = 'Asia/Seoul'

/** 신고가 **언제** 들어왔고 **언제** 처리됐나. 여기서는 분까지가 뜻이 있다. */
export function reportDateTime(isoString: string): string {
  return formatDate(isoString, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })
}
