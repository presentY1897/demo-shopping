import type { Notification, ReadNotificationsRequest } from '@shopping/shared'

/**
 * 알림함의 순수 판단 — **무엇을 묻고, 언제 다시 묻는가** (TASK-0090).
 *
 * `lib/reviews/review-console.ts` · `lib/questions/question-console.ts` 와 같은
 * 자리에 같은 이유로 있다: 여기 있는 것들은 **틀려도 조용하다.** 폴링이 멈추지
 * 않으면 백그라운드 탭이 30초마다 서버를 두드리는데 화면에는 아무 일도 일어나지
 * 않고(R1), 읽음 요청에서 id 가 빠지면 **누른 하나가 아니라 전부**가 읽음이 된다 —
 * 둘 다 어느 검사도 빨갛게 만들지 않는다.
 *
 * I/O 도 렌더도 없다 (`vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/**
 * 30초 (4장).
 *
 * WebSocket 을 놓지 않기로 한 대신의 값이고, 「데모에서 탭 세 개를 열어 상태 변화를
 * 본다」가 그 기준이다. 더 짧게 하면 무료 인스턴스가 사람 수 × 2배로 두드려 맞고,
 * 더 길게 하면 옆 탭에서 발송 처리를 한 사람이 이쪽 탭을 새로고침하게 된다.
 */
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000

/**
 * 헤더 드롭다운이 보여 주는 줄 수 (4.5).
 *
 * **배지를 위한 라우트가 따로 없다.** 목록이 미읽음 수를 함께 답하므로, 헤더는
 * `limit=5&unreadOnly=true` **한 번**으로 드롭다운의 내용과 배지의 숫자를 같이 얻는다.
 * 따로 두면 알림함을 연 화면이 같은 것을 두 번 묻는다.
 */
export const NOTIFICATION_MENU_LIMIT = 5

/**
 * 배지에 숫자로 적는 상한. 넘으면 「99+」다.
 *
 * 자리 때문이다. 세 자리 숫자가 종 위에 얹히면 아이콘이 밀리고 상단바의 다른 것들이
 * 함께 움직이는데, 그 숫자가 148인지 149인지는 읽는 사람에게 같은 뜻이다.
 */
export const NOTIFICATION_BADGE_MAX = 99

/**
 * 배지에 그릴 문자열, 또는 **그리지 않음**(`null`).
 *
 * 0 이 `null` 인 것이 이 함수의 판단이다. 「0」을 그리면 배지가 늘 켜져 있게 되고,
 * 늘 켜져 있는 배지는 아무것도 알리지 않는다 — 배지의 뜻은 「지금 할 일이 있다」다.
 *
 * **이 문자열은 장식이다.** 종은 이것을 `aria-hidden` 으로 그리고 개수는 버튼의
 * 이름 안에 문장으로 넣는다(`labelWithUnread`) — 거기에는 상한이 없다. 「99+」는
 * 자리를 아끼려고 줄인 그림이지 사실을 줄인 것이 아니다.
 *
 * `overflow` 는 카탈로그의 문장이다(`{max}+`). 「+」를 여기 적으면 이 파일에
 * 사용자에게 보이는 문자열이 하나 생긴다.
 */
export function badgeLabel(unreadCount: number, overflow: string): string | null {
  if (unreadCount === 0) return null

  return unreadCount > NOTIFICATION_BADGE_MAX
    ? overflow.replace('{max}', String(NOTIFICATION_BADGE_MAX))
    : String(unreadCount)
}

/** 아직 읽지 않았는가. 줄의 강조와 「읽음」 버튼의 유무를 가른다. */
export function isUnread(notification: Notification): boolean {
  return notification.readAt === null
}

/** 알림함이 좁혀 놓았는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export interface NotificationFilters {
  readonly unreadOnly: boolean
}

export const EMPTY_NOTIFICATION_FILTERS: NotificationFilters = { unreadOnly: false }

export function isNarrowed(filters: NotificationFilters): boolean {
  return filters.unreadOnly
}

/**
 * `?unreadOnly=true&cursor=…&limit=5`.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `cursor=undefined` 를 만들고, 서버는 그것을 커서로 읽어
 * 존재하지 않는 페이지를 답한다 — 빈 목록으로.
 *
 * `limit` 은 **드롭다운만** 싣는다. 알림함 페이지는 서버의 기본 개수를 그대로 쓰고,
 * 드롭다운은 상단바에 다섯 줄만 들어가므로 자기 몫을 말해야 한다.
 */
export function notificationSearch(
  filters: NotificationFilters,
  cursor: string | null,
  limit: number | null,
): string {
  const params = new URLSearchParams()

  if (filters.unreadOnly) params.set('unreadOnly', 'true')
  if (cursor !== null) params.set('cursor', cursor)
  if (limit !== null) params.set('limit', String(limit))

  const search = params.toString()

  // 아무 축도 없는 첫 페이지. `?` 하나만 붙이면 경로가 지저분해지는 것이 아니라
  // 캐시 키가 갈린다 — 같은 목록이 두 주소를 갖는다.
  return search === '' ? '' : `?${search}`
}

/**
 * `POST /me/notifications/read` 의 몸통 (F4).
 *
 * **id 를 주지 않으면 전부다.** 계약이 「개별」과 「전체」를 한 라우트로 둔 판단이
 * 여기서 한 함수가 되는데, 그 이유는 두 호출이 한 글자 차이이기 때문이다 —
 * `{ ids: [id] }` 와 `{}` — 그리고 그 한 글자가 「이 줄만 읽음」과 「알림함 전체
 * 읽음」을 가른다.
 *
 * **빈 배열을 만들 수 있는 길을 두지 않는다.** `ids` 의 계약은 `min(1)` 이라 빈
 * 배열은 400 이고, 「선택한 것 읽음」 같은 조작이 없으므로 이 함수가 받는 것은
 * 언제나 id 하나이거나 아무것도 아니다.
 */
export function readRequest(id: string | null): ReadNotificationsRequest {
  return id === null ? {} : { ids: [id] }
}

/* ----------------------------------------------------------------- 폴링 -- */

/**
 * 폴링을 켤 조건 (R1).
 *
 * `enabled` 는 **이 화면이 폴링을 원하는가**다. 상단바의 종만 `true` 이고 알림함
 * 페이지는 `false` 인데, 이유가 둘이다: 종은 모든 화면에 있으므로 알림함에서도
 * 이미 돌고 있어 두 번째 타이머는 같은 것을 두 번 묻는 것이고, 커서로 넘긴
 * 목록의 줄이 읽는 사람 밑에서 조용히 바뀌는 것은 도움이 아니라 방해다.
 *
 * `visible` 은 **탭이 보이는가**다. 백그라운드 탭의 폴링은 아무도 보지 않는 화면을
 * 위해 서버를 두드리는 일이고, 무료 인스턴스에서 그것은 실제로 비용이다.
 */
export interface PollingState {
  readonly enabled: boolean
  readonly visible: boolean
}

/**
 * 다음 폴링까지 몇 밀리초, 또는 **멈춤**(`null`).
 *
 * 간격을 그대로 돌려주는 대신 「멈춤」을 값으로 표현하는 이유는 부르는 쪽이
 * `if (delay === null) return` 하나로 타이머를 걸지 *않을* 수 있기 때문이다.
 * 조건을 훅 안의 `if` 로 흩어 두면 「탭이 숨었을 때 멈춘다」가 렌더링 코드 속의
 * 불리언 하나가 되어, 그것이 뒤집혀도 검사가 없다.
 */
export function pollDelay(state: PollingState): number | null {
  return state.enabled && state.visible ? NOTIFICATION_POLL_INTERVAL_MS : null
}
