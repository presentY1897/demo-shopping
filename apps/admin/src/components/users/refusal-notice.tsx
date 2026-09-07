'use client'

import { Button } from '@shopping/ui/components'

import type { UserRefusal } from '@/lib/users/user-console'
import type { UserMessages } from '@/messages'

/**
 * 거절 하나를 **문장으로** 세운다 (F8).
 *
 * 버튼을 미리 막는 것(`GuardedButton`)만으로는 부족하다. 부팅 갱신이 끝나기 전이나
 * 다른 탭에서 역할이 회수된 뒤에는 살아 있는 버튼이 403 을 받고, 그때 화면이 아무
 * 말도 하지 않으면 사람은 같은 버튼을 몇 번이고 다시 누른다. **거절은 실제로 오고,
 * 온 거절은 읽을 수 있어야 한다.**
 *
 * 카탈로그의 `FORBIDDEN` 은 「권한이 없어요」 한 줄이라 어느 자격이 모자란지 말하지
 * 못한다. 그것을 말할 수 있는 것은 이 화면뿐이라 문장이 여기 있다
 * (`report-handle-dialog.tsx` 가 같은 자리에 같은 것을 둔다).
 */

export interface RefusalNoticeProps {
  readonly refusal: UserRefusal
  readonly messages: UserMessages
  readonly title: string
  /** 「목록 새로고침」. 남이 먼저 바꿔 놓았을 때의 다음 행동이다. */
  readonly onRefresh: () => void
  readonly refreshLabel: string
}

export function RefusalNotice({
  refusal,
  messages,
  title,
  onRefresh,
  refreshLabel,
}: RefusalNoticeProps) {
  return (
    <div
      className="border-danger bg-danger-surface text-fg flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
      role="alert"
    >
      <p className="font-medium">{title}</p>
      <p>{messages.refusals[refusal]}</p>
      {/*
        「다시 누르기」가 답인 거절은 하나도 없다. 다만 남이 먼저 바꿔 놓은 경우에는
        다음 행동이 **다시 읽는 것**이라 그 버튼을 함께 내민다.
      */}
      {refusal === 'stale' ? (
        <Button onClick={onRefresh} size="sm" type="button" variant="outline">
          {refreshLabel}
        </Button>
      ) : null}
    </div>
  )
}
