/**
 * 알림함의 순수 판단 (TASK-0090 F4 · R1).
 *
 * `vitest.config.mjs` 가 `lib/notifications/notification-console.ts` 를 **분기 100%**
 * 로 잡고 있고, 이 파일이 그 문턱을 채우는 유일한 곳이다. 이유는 저 모듈의 머리말이
 * 적고 있다: 폴링이 멈추지 않으면 백그라운드 탭이 30초마다 서버를 두드리는데 화면에는
 * 아무 일도 일어나지 않고, 읽음 요청에서 id 가 빠지면 **누른 하나가 아니라 전부**가
 * 읽음이 된다 — 둘 다 어느 검사도 빨갛게 만들지 않는다.
 */

import type { Notification } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  badgeLabel,
  EMPTY_NOTIFICATION_FILTERS,
  isNarrowed,
  isUnread,
  NOTIFICATION_BADGE_MAX,
  NOTIFICATION_MENU_LIMIT,
  NOTIFICATION_POLL_INTERVAL_MS,
  notificationSearch,
  pollDelay,
  readRequest,
} from '@/lib/notifications/notification-console'

const notification = {
  body: '주문 20260904-000123 · 128,000원',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9001',
  link: '/orders/019596d0-1f1c-7c2e-9a0e-4a5a3a2fa001',
  readAt: null,
  title: '새 주문이 들어왔어요',
  type: 'SELLER_ORDER',
} satisfies Notification

function paramsOf(search: string): URLSearchParams {
  return new URL(`http://api.test.invalid/x${search}`).searchParams
}

describe('미읽음 판정', () => {
  it('is about readAt and nothing else', () => {
    expect(isUnread(notification)).toBe(true)
    expect(isUnread({ ...notification, readAt: '2026-09-04T03:00:00.000Z' })).toBe(false)
  })
})

describe('필터', () => {
  it('starts wide open', () => {
    expect(isNarrowed(EMPTY_NOTIFICATION_FILTERS)).toBe(false)
  })

  it('counts the one axis it has as narrowed', () => {
    expect(isNarrowed({ unreadOnly: true })).toBe(true)
  })
})

describe('질의 문자열', () => {
  it('asks for nothing at all on the first unfiltered page', () => {
    // `?` 하나만 붙이면 같은 목록이 두 주소를 갖는다.
    expect(notificationSearch(EMPTY_NOTIFICATION_FILTERS, null, null)).toBe('')
  })

  it('carries every axis the caller set', () => {
    const params = paramsOf(notificationSearch({ unreadOnly: true }, 'cursor-page-2', 5))

    expect(params.get('unreadOnly')).toBe('true')
    // 커서는 불투명하다. 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
    expect(params.get('cursor')).toBe('cursor-page-2')
    expect(params.get('limit')).toBe('5')
  })

  it('is the one request the header needs — the list and the badge together (4.5)', () => {
    const params = paramsOf(notificationSearch({ unreadOnly: true }, null, NOTIFICATION_MENU_LIMIT))

    expect(params.get('limit')).toBe(String(NOTIFICATION_MENU_LIMIT))
    expect(params.has('cursor')).toBe(false)
  })
})

describe('읽음 요청 (F4)', () => {
  it('names the one row when one row was pressed', () => {
    expect(readRequest(notification.id)).toEqual({ ids: [notification.id] })
  })

  it('names nothing when "모두 읽음" was pressed — that is what "전부" means', () => {
    // 보이는 것만 읽으면 배지가 0이 되지 않고, 사람은 같은 버튼을 다시 누른다.
    expect(readRequest(null)).toEqual({})
  })
})

describe('배지 (F3)', () => {
  const OVERFLOW = '{max}+'

  it('draws nothing at zero — a badge that is always on says nothing', () => {
    expect(badgeLabel(0, OVERFLOW)).toBeNull()
  })

  it('draws the number while it fits', () => {
    expect(badgeLabel(3, OVERFLOW)).toBe('3')
    expect(badgeLabel(NOTIFICATION_BADGE_MAX, OVERFLOW)).toBe(String(NOTIFICATION_BADGE_MAX))
  })

  it('caps the drawing, not the fact', () => {
    // 148인지 149인지는 읽는 사람에게 같은 뜻이고, 정확한 수는 버튼의 이름이 든다.
    expect(badgeLabel(NOTIFICATION_BADGE_MAX + 1, OVERFLOW)).toBe(
      `${String(NOTIFICATION_BADGE_MAX)}+`,
    )
  })
})

describe('폴링 (R1)', () => {
  it('runs at the interval 4장 fixed, when the screen wants it and the tab is up', () => {
    expect(pollDelay({ enabled: true, visible: true })).toBe(NOTIFICATION_POLL_INTERVAL_MS)
    expect(NOTIFICATION_POLL_INTERVAL_MS).toBe(30_000)
  })

  it('stops when the tab is hidden', () => {
    // 아무도 보지 않는 화면을 위해 서버를 두드리는 일이고, 무료 인스턴스에서 그것은
    // 실제로 비용이다.
    expect(pollDelay({ enabled: true, visible: false })).toBeNull()
  })

  it('stops on a screen that did not ask for it', () => {
    // 알림함 페이지다. 종이 이미 돌고 있으므로 두 번째 타이머는 같은 것을 두 번 묻는다.
    expect(pollDelay({ enabled: false, visible: true })).toBeNull()
    expect(pollDelay({ enabled: false, visible: false })).toBeNull()
  })
})
