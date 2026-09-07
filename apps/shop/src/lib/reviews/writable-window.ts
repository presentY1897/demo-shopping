/**
 * 「리뷰 쓸 수 있는 주문」 한 줄에 남은 기간 (TASK-0083 F7).
 *
 * ## 기한을 화면이 계산하지 않는다
 *
 * 받는 것은 서버가 계산해 내려보낸 `writableUntil` 이다(`reviewableItemSchema`).
 * 화면이 「배송완료 + 30일」을 스스로 세면 그 30이 두 곳에 적히고, 배포 설정으로
 * 기간을 바꾸는 날 **화면만 옛 날짜를 자신 있게** 말한다 — 그리고 그때 화면은
 * 서버가 이미 거절한 항목에 「D-3 남음」을 그린다.
 *
 * 여기서 하는 일은 그 시각을 **오늘로부터 며칠인가**로 옮기는 것뿐이고, 그것은
 * 브라우저의 시계가 있어야 하는 계산이라 서버가 대신할 수 없다.
 *
 * ## 세 갈래인 이유
 *
 * 「3일 남음」과 「오늘까지」와 「지났음」은 사람이 할 일이 다르다. 마지막 날에
 * 「1일 남음」이라고 쓰면 내일도 되는 것처럼 읽히고, 이미 지난 줄에 남은 날을
 * 그리면 목록이 서버가 곧 거절할 일을 권하는 셈이 된다.
 *
 * 지난 줄이 목록에 있을 수 있는 이유는 **목록을 받은 뒤에도 시간이 흐르기**
 * 때문이다 — 서버는 부를 때 쓸 수 있던 것만 담지만(`reviewableListResponseSchema`),
 * 화면은 그것을 열어 둔 채로 자정을 넘길 수 있다.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type WritableWindow =
  /** 기한이 지났다. 서버는 이제 `REVIEW_WINDOW_CLOSED` 로 답한다 */
  | { readonly kind: 'expired' }
  /** 오늘이 마지막 날이다 */
  | { readonly kind: 'lastDay' }
  /** 아직 며칠 남았다 */
  | { readonly kind: 'daysLeft'; readonly days: number }

export function writableWindow(writableUntil: string, now: Date): WritableWindow {
  const remaining = new Date(writableUntil).getTime() - now.getTime()

  if (remaining <= 0) return { kind: 'expired' }

  // 올림이다. 23시간 남은 것은 「0일 남음」이 아니라 오늘까지이고, 25시간 남은 것은
  // 내일까지다 — 사람이 세는 단위가 날이므로 남은 조각도 하루로 센다.
  const days = Math.ceil(remaining / DAY_MS)

  return days === 1 ? { kind: 'lastDay' } : { kind: 'daysLeft', days }
}
