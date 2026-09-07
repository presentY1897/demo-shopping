import type { Notification, NotificationListQueryParams } from '@shopping/shared'

/**
 * 알림함의 순수 판단 — **언제 다시 묻고, 배지에 무엇을 그리는가.**
 *
 * `lib/settlements/settlement-console.ts` 와 같은 자리에 같은 이유로 있다: 여기
 * 있는 것들은 **틀려도 조용하다.** 폴링 조건이 뒤집히면 화면은 멀쩡히 그려지고
 * 달라지는 것은 **배경 탭이 30초마다 서버를 두드리는 일**뿐이며(R1), 배지 문자열이
 * 틀리면 「할 일 0개」가 그려진 채 알림이 쌓인다. 어느 쪽도 빨간 검사를 만들지
 * 않는다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/**
 * 다시 묻는 주기 — 30초 (TASK-0090 4장).
 *
 * 실시간 푸시를 하지 않는다는 결정이 이 숫자를 뜻 있게 만든다. WebSocket 인프라를
 * 더하는 비용 대비 얻는 게 적고, 데모에서 탭 셋을 열어 상태 변화를 보는 시나리오도
 * 이 정도면 자연스럽다.
 */
export const NOTIFICATION_POLL_MS = 30_000

/** 헤더 드롭다운이 한 번에 받는 개수 (TASK-0090 4.5 — `limit=5&unreadOnly=true`). */
export const NOTIFICATION_DROPDOWN_LIMIT = 5

/** 배지에 숫자로 적는 상한. 넘으면 「99+」다. */
export const NOTIFICATION_BADGE_MAX = 99

/** 알림함 전체를 여는 주소. 드롭다운의 「전체 보기」가 가리킨다. */
export const NOTIFICATIONS_HREF = '/notifications'

/**
 * 지금 다시 물어야 하는가 (R1).
 *
 * **탭이 숨으면 멈춘다.** 안 보는 화면을 위해 30초마다 서버를 두드리면, 콘솔을 열어
 * 둔 탭 하나가 하루에 2,880번을 묻는다 — 그리고 이 저장소의 API 는 잠들었다 깨는
 * 무료 인스턴스 위에 있다(TASK-0009 R8).
 *
 * `enabled` 는 「물을 계정이 있는가」다. 로그인 전에 물으면 답은 401 이고, 그 401 은
 * 아무도 볼 수 없는 자리에서 30초마다 되풀이된다.
 */
export function shouldPoll(input: {
  readonly hidden: boolean
  readonly enabled: boolean
}): boolean {
  return input.enabled && !input.hidden
}

/**
 * 배지에 그릴 문자열, 또는 **그리지 않음**.
 *
 * 0 이 `null` 인 것이 이 함수의 판단이다. 「0」을 그리면 배지가 늘 켜져 있게 되고,
 * 늘 켜져 있는 배지는 아무것도 알리지 않는다 — 배지의 뜻은 「지금 할 일이 있다」다.
 *
 * 상한을 두는 이유는 자리다. 세 자리 숫자가 종 위에 얹히면 아이콘이 밀리고, 그
 * 숫자가 148인지 149인지는 읽는 사람에게 같은 뜻이다.
 */
export function badgeLabel(unreadCount: number, overflow: string): string | null {
  if (unreadCount === 0) return null

  return unreadCount > NOTIFICATION_BADGE_MAX
    ? overflow.replace('{max}', String(NOTIFICATION_BADGE_MAX))
    : String(unreadCount)
}

/** 알림함이 지금 무엇을 보고 있는가. */
export interface NotificationQuery {
  /** 안 읽은 것만. 헤더는 언제나 참이고, 페이지는 사람이 토글한다. */
  readonly unreadOnly: boolean
  /** 한 번에 받을 개수. `null` 이면 계약의 기본값에 맡긴다. */
  readonly limit: number | null
}

/**
 * 이것을 계약의 질의로. 커서는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `limit=undefined` 를 만들고, 서버는 그것을 잘못된 숫자로 읽어
 * 400 으로 답한다 (`settlement-console.ts` 의 같은 규약). 「안 읽은 것만」이 꺼져
 * 있을 때도 마찬가지다 — `unreadOnly=false` 를 실어 보낼 이유가 없다.
 */
export function queryOf(query: NotificationQuery): NotificationListQueryParams {
  return {
    ...(query.unreadOnly ? { unreadOnly: true } : {}),
    ...(query.limit === null ? {} : { limit: query.limit }),
  }
}

/**
 * 아직 안 읽은 알림인가.
 *
 * 계약이 「읽었는가」를 시각 한 칸으로 적으므로(`readAt`), 그 판정을 화면마다 쓰지
 * 않고 여기 한 번만 쓴다 — 목록의 강조와 「누르면 읽음 처리할지」가 같은 답을 봐야
 * 한다.
 */
export function isUnread(notification: Notification): boolean {
  return notification.readAt === null
}
