/**
 * 헤더가 알림을 **언제** 다시 묻는가 (TASK-0090 4장 · F8 · R1).
 *
 * ## 30초인 이유는 그것이 대안의 값이기 때문이다
 *
 * 4장이 WebSocket 을 범위 밖으로 두면서 「30초 폴링으로 충분하다」를 근거로 삼았다.
 * 그러니 이 숫자는 취향이 아니라 **그 판단의 값**이고, 한 곳에만 있어야 한다 —
 * 화면마다 적으면 「실시간이 아니어도 되는 간격」이 화면마다 달라진다.
 *
 * ## 멈추는 조건이 둘인 이유
 *
 * R1 이 「탭이 백그라운드면 폴링 중단」을 요구한다. 탭 스무 개를 열어 둔 사람에게
 * 30초마다 스무 번의 요청은 무료 요금제 API 가 감당할 이유가 없는 부하이고, **보이지
 * 않는 탭의 배지는 아무도 보지 않는다.**
 *
 * 로그인하지 않은 사람에게 멈추는 것은 부하가 아니라 **답이 없기** 때문이다.
 * `GET /me/notifications` 는 세션을 요구하므로, 익명인 채로 30초마다 묻는 것은 401 을
 * 30초마다 받는 일이다.
 *
 * ## 순수한 함수 하나인 이유
 *
 * 「지금 폴링해야 하나」는 **틀려도 조용한** 판단이다. 숨은 탭에서 멈추지 않아도
 * 화면은 멀쩡하고, 익명일 때 멈추지 않아도 배지는 그냥 안 보인다 — 둘 다 빨간 검사를
 * 만들지 않는다. 그래서 이 판단은 훅이 아니라 부르는 것만으로 검사할 수 있는 함수다.
 */

/** 폴링 주기 (TASK-0090 4장). */
export const NOTIFICATION_POLL_MS = 30_000

/** 헤더의 드롭다운이 한 번에 받아 오는 수. 목록 전체는 `/mypage/notifications` 다. */
export const NOTIFICATION_MENU_LIMIT = 5

export type PollDecision =
  /** 지금 묻는다. `intervalMs` 뒤에 다시 묻는다 */
  | { readonly kind: 'poll'; readonly intervalMs: number }
  /** 묻지 않는다. 이유가 둘이고, 둘은 다시 시작하는 조건이 다르다 */
  | { readonly kind: 'idle'; readonly reason: 'hidden' | 'signedOut' }

export function pollDecision({
  hidden,
  signedIn,
}: {
  /** `document.visibilityState === 'hidden'`. */
  readonly hidden: boolean
  readonly signedIn: boolean
}): PollDecision {
  // 로그인 여부를 먼저 본다. 익명이면서 숨은 탭에게 「숨어서 멈췄다」고 답하면,
  // 탭이 다시 보이는 순간 폴링이 살아나 401 을 받는다.
  if (!signedIn) return { kind: 'idle', reason: 'signedOut' }
  if (hidden) return { kind: 'idle', reason: 'hidden' }

  return { kind: 'poll', intervalMs: NOTIFICATION_POLL_MS }
}
