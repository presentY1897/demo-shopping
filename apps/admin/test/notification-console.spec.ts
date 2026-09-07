/**
 * 알림함이 그리기 **전에** 하는 판단들 (TASK-0090).
 *
 * 따로 재는 이유는 틀렸을 때 조용하기 때문이다. 폴링 조건이 뒤집혀도 화면은 멀쩡히
 * 그려지고 달라지는 것은 **배경 탭이 30초마다 서버를 두드리는 일**뿐이며(R1), 배지
 * 문자열이 틀리면 「할 일 0개」가 그려진 채 알림이 쌓인다 (F3).
 *
 * `vitest.config.mjs` 가 이 모듈을 분기 100% 로 묶어 두는 이유가 같다.
 */

import { notificationTypes } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { notificationSearch } from '@/lib/notifications/console-api'
import { notificationDateTime } from '@/lib/notifications/format'
import {
  badgeLabel,
  isUnread,
  NOTIFICATION_BADGE_MAX,
  NOTIFICATION_DROPDOWN_LIMIT,
  NOTIFICATION_POLL_MS,
  queryOf,
  shouldPoll,
} from '@/lib/notifications/notification-console'
import { messagesFor } from '@/messages'

import { notification } from './support/notifications'

const { notifications: copy } = messagesFor()

describe('언제 다시 묻는가 (F8 · R1)', () => {
  it('asks every thirty seconds, as 4장 settled', () => {
    expect(NOTIFICATION_POLL_MS).toBe(30_000)
  })

  it('polls a visible tab that has somebody signed in', () => {
    expect(shouldPoll({ hidden: false, enabled: true })).toBe(true)
  })

  /**
   * 안 보는 화면을 위해 30초마다 두드리면 탭 하나가 하루에 2,880번을 묻는다. 이
   * 저장소의 API 는 잠들었다 깨는 무료 인스턴스 위에 있다 (TASK-0009 R8).
   */
  it('stops while the tab is hidden', () => {
    expect(shouldPoll({ hidden: true, enabled: true })).toBe(false)
  })

  /** 로그인 전의 401 은 아무도 볼 수 없는 자리에서 30초마다 되풀이된다. */
  it('asks nothing at all when there is nobody to ask for', () => {
    expect(shouldPoll({ hidden: false, enabled: false })).toBe(false)
    expect(shouldPoll({ hidden: true, enabled: false })).toBe(false)
  })
})

describe('배지 (F3)', () => {
  /**
   * 「0」을 그리면 배지가 늘 켜져 있게 되고, 늘 켜져 있는 배지는 아무것도 알리지
   * 않는다.
   */
  it('draws nothing when there is nothing to do', () => {
    expect(badgeLabel(0, copy.badgeOverflow)).toBeNull()
  })

  it('draws the count while it fits', () => {
    expect(badgeLabel(3, copy.badgeOverflow)).toBe('3')
    expect(badgeLabel(NOTIFICATION_BADGE_MAX, copy.badgeOverflow)).toBe('99')
  })

  it('stops counting past the ceiling rather than pushing the bell aside', () => {
    expect(badgeLabel(NOTIFICATION_BADGE_MAX + 1, copy.badgeOverflow)).toBe('99+')
    expect(badgeLabel(4_812, copy.badgeOverflow)).toBe('99+')
  })
})

describe('질의', () => {
  /** 헤더는 `limit=5&unreadOnly=true` 한 번으로 목록과 배지를 함께 얻는다 (4.5). */
  it('asks the way the header does', () => {
    expect(queryOf({ unreadOnly: true, limit: NOTIFICATION_DROPDOWN_LIMIT })).toEqual({
      unreadOnly: true,
      limit: 5,
    })
    expect(notificationSearch({ unreadOnly: true, limit: 5 })).toBe('?unreadOnly=true&limit=5')
  })

  /**
   * 값이 없는 축은 **키 자체가 없어야** 한다. `unreadOnly=false` 를 실어 보낼 이유가
   * 없고, `limit=undefined` 는 서버가 잘못된 숫자로 읽어 400 으로 답한다.
   */
  it('leaves both axes out when the page is looking at everything', () => {
    expect(queryOf({ unreadOnly: false, limit: null })).toEqual({})
    expect(notificationSearch({})).toBe('')
  })

  it('carries a cursor when there is one', () => {
    expect(notificationSearch({ cursor: 'next' })).toBe('?cursor=next')
  })
})

describe('읽음', () => {
  it('reads the contract’s one timestamp as the whole answer', () => {
    expect(isUnread(notification({ readAt: null }))).toBe(true)
    expect(isUnread(notification({ readAt: '2026-09-06T02:00:00.000Z' }))).toBe(false)
  })
})

describe('문구', () => {
  /**
   * 관리자가 받지 않는 유형에도 이름이 있다. 받는 사람의 역할이 유형에 묻어
   * 있지만(`notifications.ts`) 그것은 서버의 규약이고, 이름 없는 유형이 화면에
   * 나타나는 길을 열어 둘 이유는 없다.
   */
  it('names every notification type the contract can send', () => {
    for (const type of notificationTypes) expect(copy.typeLabels[type]).not.toBe('')
  })

  it('draws an instant in the console’s time zone', () => {
    expect(notificationDateTime('2026-09-05T15:30:00.000Z')).toBe('2026. 9. 6. AM 12:30')
  })
})
