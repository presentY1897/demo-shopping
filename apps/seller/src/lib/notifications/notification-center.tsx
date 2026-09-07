'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useAuth } from '@/lib/auth/auth-context'

import { NOTIFICATION_MENU_LIMIT } from './notification-console'
import type { NotificationsController } from './use-notifications'
import { useNotifications } from './use-notifications'

/**
 * 콘솔에 **하나뿐인** 알림 폴링 (TASK-0090 R1).
 *
 * 셸이 이것을 감싸므로 상단바의 종과 그 안에 그려지는 화면이 같은 타이머를 본다.
 * 종은 배지와 드롭다운의 다섯 줄을 여기서 읽고, `/notifications` 는 자기 목록을
 * 따로 들되 **읽음 처리를 한 뒤 여기에 알린다** — 그러지 않으면 방금 「모두 읽음」을
 * 누른 사람의 머리 위에서 배지가 최대 30초 동안 옛 숫자를 말한다.
 *
 * ## 값만 바뀌고 나무는 그대로다
 *
 * **부를 수 없을 때 다른 컴포넌트를 그리지 않는다.** 세션이 도착하면 「부를 수 없다」가
 * 「부를 수 있다」로 바뀌는데, 그때 엘리먼트의 **종류**가 달라지면 리액트는 그 아래를
 * 통째로 버리고 다시 만든다 — 그 아래는 콘솔 전체다. 열려 있던 팝오버가 닫히고,
 * 스크롤과 포커스와 폼의 입력이 사라지고, 목록은 처음부터 다시 불린다. 이 파일이
 * 그것을 실제로 한 번 저질렀고 `console-shell.spec.tsx` 의 다섯 검사가 그것을 잡았다.
 *
 * 그래서 갈래는 **값**에 있다: 컴포넌트는 언제나 {@link NotificationCenter} 하나이고,
 * 부를 수 없는 동안에는 훅이 아무것도 묻지 않으며(`enabled`) 컨텍스트에는 `null` 이
 * 실린다.
 *
 * ## `null` 일 수 있다
 *
 * `useNotificationCenter()` 는 `null` 을 돌려줄 수 있고, 그것이 예외가 아니라 설계다.
 *
 * - **셸 밖**: 로그인 화면과 권한 안내 화면은 셸 없이 그려진다(`console-frame.tsx`).
 * - **부를 수 없는 계정**: 세션을 아직 모르거나, 로그인하지 않았거나, `notification.read`
 *   가 없다. 그때는 **묻지 않는다** — 물으면 401·403 이 돌아오고, 아직 로그인하지
 *   않았을 뿐인 사람 앞에서 그 401 이 30초마다 되풀이된다.
 *
 * 그래서 부르는 쪽은 `center?.refresh()` 로 쓴다. 배지가 없는 화면에서 배지를 갱신할
 * 일이 없는 것은 문제가 아니다.
 */

const NotificationCenterContext = createContext<NotificationsController | null>(null)

export function NotificationCenterProvider({ children }: { readonly children: ReactNode }) {
  const { state } = useAuth()
  const { can, ready } = useAuthorization()

  // 두 물음을 함께 묻는다. `ready` 없이 `can` 만 보면 세션이 도착하기 전의 한 프레임
  // 동안 모든 퍼미션이 `false` 이므로, 「퍼미션이 없다」와 「아직 모른다」가 같은 말이
  // 된다 — 뒤쪽은 물어보지 않을 이유이지 못 물을 이유가 아니다.
  const allowed = ready && state.status === 'signedIn' && can('notification.read')

  return <NotificationCenter allowed={allowed}>{children}</NotificationCenter>
}

/**
 * 훅이 도는 쪽. 별도의 컴포넌트인 이유는 훅을 **조건부로 부를 수 없기** 때문이다 —
 * 위에서 판정하고 여기서 무조건 부르되, 그 판정을 `enabled` 로 넘긴다.
 */
function NotificationCenter({
  allowed,
  children,
}: {
  readonly allowed: boolean
  readonly children: ReactNode
}) {
  const controller = useNotifications({
    enabled: allowed,
    initialFilters: { unreadOnly: true },
    limit: NOTIFICATION_MENU_LIMIT,
    poll: true,
  })

  return (
    <NotificationCenterContext.Provider value={allowed ? controller : null}>
      {children}
    </NotificationCenterContext.Provider>
  )
}

export function useNotificationCenter(): NotificationsController | null {
  return useContext(NotificationCenterContext)
}
