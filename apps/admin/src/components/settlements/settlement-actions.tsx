'use client'

import type { SettlementStatus } from '@shopping/shared'
import { Button, GuardedButton } from '@shopping/ui/components'

import type { SettlementAction } from '@/lib/settlements/transitions'
import { actionsFor, isLocked, permissionFor } from '@/lib/settlements/transitions'
import type { SettlementActionMessages } from '@/messages'

/**
 * 지금 이 정산서에 할 수 있는 일 — **전이표가 정한 것만** (F3 · F4 · F5 · F7).
 *
 * ## 버튼의 목록이 조건문에서 나오지 않는다
 *
 * `actionsFor` 하나가 정한다. 「지급완료된 정산서는 수정할 수 없다」(F5)는 여기
 * 적힌 규칙이 아니라 전이표의 **빈 배열**이고, 그래서 이 컴포넌트에는 `'PAID'` 라는
 * 문자열이 없다 — 표가 바뀌면 화면이 저절로 따라간다.
 *
 * ## 막힌 버튼은 감추지 않는다 (F7)
 *
 * 승인·보류는 `settlement.approve`, 지급은 `settlement.pay` 이고 둘 다 최고
 * 관리자만 갖는다. 운영자와 데모 관리자에게 이 버튼들을 감추면 콘솔이 실제보다 적은
 * 기능을 가진 것처럼 보이고, 무엇을 요청해야 하는지도 알 수 없다. 그래서 자리에
 * 그대로 두고 **왜 못 누르는지**를 말한다 — 회색으로 죽이는 대신 키보드가 닿는
 * 자리에 두는 것이 `GuardedButton` 의 규약이다 (TASK-0023 4장).
 *
 * 「더 할 것이 없다」는 그 규약으로 말할 수 없어서 문장이다. 권한을 얻어도 열리지
 * 않는 자리이기 때문이다.
 */

export interface SettlementActionsProps {
  readonly status: SettlementStatus
  readonly messages: SettlementActionMessages
  readonly busy: boolean
  readonly onSelect: (action: SettlementAction) => void
  /** 이 판단을 할 수 있는가. 부르는 쪽이 `useAuthorization` 에 물어 넘긴다. */
  readonly can: (action: SettlementAction) => boolean
  /** 왜 못 하는지, 또는 할 수 있으면 `undefined`. */
  readonly denial: (action: SettlementAction) => string | undefined
}

export function SettlementActions({
  status,
  messages,
  busy,
  onSelect,
  can,
  denial,
}: SettlementActionsProps) {
  if (isLocked(status)) {
    return (
      <div
        className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3 text-sm"
        role="note"
      >
        <p className="text-fg font-medium">{messages.locked.title}</p>
        <p className="text-fg-muted">{messages.locked.description}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actionsFor(status).map((action) =>
        can(action) ? (
          <Button
            disabled={busy}
            key={action}
            onClick={() => {
              onSelect(action)
            }}
            type="button"
            variant={action === 'hold' ? 'outline' : 'primary'}
          >
            {messages.labels[action]}
          </Button>
        ) : (
          <GuardedButton
            blocked
            key={action}
            // 자격이 없으면 `reason` 이 반드시 있다 — 자격을 묻는 함수와 이유를 묻는
            // 함수가 같은 판정을 지나기 때문이다(`useAuthorization`). 그래도 그
            // 사실을 타입으로 말할 수는 없으므로, 빈 문장 대신 어느 퍼미션이
            // 필요한지를 남긴다.
            reason={denial(action) ?? permissionFor(action)}
            variant={action === 'hold' ? 'outline' : 'primary'}
          >
            {messages.labels[action]}
          </GuardedButton>
        ),
      )}
    </div>
  )
}
