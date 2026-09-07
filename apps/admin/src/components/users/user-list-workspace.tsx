'use client'

import type {
  AdjustPointsRequest,
  AdminUserSummary,
  ApiFailure,
  ErrorMessages,
  Role,
} from '@shopping/shared'
import { failureMessage, platformOwnership } from '@shopping/shared'
import {
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useUserAccount, useUsers } from '@/lib/users/use-users'
import type { UserMessages } from '@/messages'

import { UserDetailPanel } from './user-detail-panel'
import { UserFilters } from './user-filters'
import { UserTable } from './user-table'
import { UserViewDialog } from './user-view-dialog'

/**
 * `/users` — 회원을 찾고, 사유를 적고 열어 보고, 조치한다 (TASK-0093).
 *
 * ## 볼 수 있는 자격과 바꿀 수 있는 자격이 **다르다**
 *
 * 목록과 상세는 `user.read` 이고 정지·적립금·역할은 `user.write` 다. 그리고
 * `user.write` 는 **최고관리자만** 갖는다(`role-permissions.ts`) — 운영자는 읽을 수
 * 있고 바꾸지 못하며, 데모 관리자는 그 퍼미션을 아예 갖고 있지 않다 (D-058 · 4.6).
 *
 * 그래서 이 화면에는 신고 화면에 없는 것이 있다: **미리 죽인 버튼.** 어느 줄이 막히는지
 * 미리 알 수 없었던 신고와 달리, 여기서는 계정의 역할만 보면 알 수 있다. 감추지 않고
 * `GuardedButton` 으로 두는 것은 콘솔이 실제보다 적은 기능을 가진 것처럼 보이지 않게
 * 하기 위해서다 (TASK-0023 4장).
 *
 * **그런데도 거절은 온다.** 부팅 갱신이 끝나기 전이나 다른 탭에서 역할이 회수된 뒤에는
 * 살아 있는 버튼이 403 을 받으므로, 거절도 문장으로 받는다 (`refusal-notice.tsx`).
 *
 * ## 읽기의 자격은 이름만으로 부족하다
 *
 * 구매자도 `user.read` 를 갖고 있고 `own` 으로 좁혀져 있을 뿐이다. 서버가 재는 것은
 * 그 **스코프**이고(`assertPlatformRead`), 화면도 같은 질문을 `platformOwnership` 으로
 * 던진다 — 물어봐야 거절당할 계정에게 오류를 그리는 대신 **왜 안 되는지**를 말한다
 * (`dashboard-workspace.tsx` 와 같은 규약).
 *
 * ## 정지·해제 뒤에는 패널을 닫는다
 *
 * 그 둘만 204 라 앉힐 것이 없다. 확인하려고 상세를 다시 열면 **열람 기록이 한 줄
 * 더 늘고**, 화면이 정지 시각을 지어내면 서버가 적은 시각과 달라진다. 목록은 이미
 * `suspendedAt` 을 싣고 있으므로 조용히 다시 읽어 그쪽이 말하게 한다 (4.3).
 */

export interface UserListWorkspaceProps {
  readonly messages: UserMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function UserListWorkspace({ messages, errors }: UserListWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!canOn('user.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('user.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <UserConsole errors={errors} messages={messages} />
    </ToastProvider>
  )
}

function UserConsole({ messages, errors }: UserListWorkspaceProps) {
  const users = useUsers()
  const account = useUserAccount()
  const { toast } = useToast()
  const { can, reason } = useAuthorization()

  /** 사유를 묻는 창이 열려 있는가 — 그리고 어느 줄에 대해서인가. */
  const [viewing, setViewing] = useState<AdminUserSummary | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const canWrite = can('user.write')
  const denial = reason('user.write')

  const { state, pagination, filters } = users
  const rows = state.status === 'ready' ? state.users : []
  const opened = account.state.status === 'open' ? account.state.user : null

  /** 사유를 받아 실제로 여는 자리. 성공하면 `null`, 아니면 그 실패를 창이 그린다. */
  async function open(reasonText: string): Promise<ApiFailure | null> {
    if (viewing === null) return null

    const result = await account.open(viewing.id, reasonText)

    // 이미 도는 중이었다 — 아무것도 보내지 않았고, 말할 것도 없다.
    if (result === null) return null

    if (!result.ok) return result.failure

    setViewing(null)

    return null
  }

  async function suspend(reasonText: string): Promise<ApiFailure | null> {
    if (opened === null) return null

    const result = await account.suspend(opened.id, reasonText)

    if (result === null) return null

    if (!result.ok) return result.failure

    // 204 다. 앉힐 것이 없으므로 패널을 닫고 목록이 말하게 한다.
    account.close()
    users.refresh()
    toast({ title: messages.toast.suspended, variant: 'success' })

    return null
  }

  async function reinstate(): Promise<ApiFailure | null> {
    if (opened === null) return null

    const result = await account.reinstate(opened.id)

    if (result === null) return null

    if (!result.ok) return result.failure

    account.close()
    users.refresh()
    toast({ title: messages.toast.reinstated, variant: 'success' })

    return null
  }

  async function changeRole(role: Role, revoking: boolean): Promise<void> {
    if (opened === null) return

    const result = revoking
      ? await account.revoke(opened.id, role)
      : await account.grant(opened.id, role)

    if (result?.ok !== true) {
      // 역할은 폼이 아니라 버튼이라 칸에 붙일 자리가 없다. 목록도 함께 바뀌므로
      // 조용히 다시 읽고, 무슨 일이 있었는지는 토스트가 말한다.
      if (result !== null) toast({ title: describe(result.failure), variant: 'danger' })

      return
    }

    users.refresh()
    toast({
      title: (revoking ? messages.toast.revoked : messages.toast.granted).replace(
        '{role}',
        messages.roleNames[role],
      ),
      variant: 'success',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <UserFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={users.setFilters}
        roleNames={messages.roleNames}
        value={filters}
      />

      {/* 별이 박힌 문자열이 고장으로 읽히지 않게, 그리고 검색이 원본을 찾는다는
          사실을 알 수 있게 (F6 · 4.2). */}
      <p className="text-fg-muted text-xs">{messages.list.maskedNotice}</p>

      <DataList
        empty={
          users.narrowed ? (
            <EmptyState
              description={messages.list.filteredEmptyDescription}
              title={messages.list.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              description={messages.list.emptyDescription}
              title={messages.list.emptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={users.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <UserTable messages={messages} onOpen={setViewing} rows={rows} />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      {/* 답을 기다리는 동안에도 무언가는 보여야 한다. 창은 이미 닫혔고 패널은 아직
          없는 순간이 그 자리다. */}
      {account.state.status === 'opening' ? (
        <Skeleton label={messages.detail.loadingLabel} lines={6} />
      ) : null}

      {opened === null ? null : (
        <UserDetailPanel
          busy={account.busy}
          canWrite={canWrite}
          denial={denial}
          describe={describe}
          errors={errors}
          messages={messages}
          onAdjust={(request: AdjustPointsRequest) => account.adjust(opened.id, request)}
          onClose={account.close}
          onGrant={(role) => {
            void changeRole(role, false)
          }}
          onRefresh={users.refresh}
          onReinstate={reinstate}
          onRevoke={(role) => {
            void changeRole(role, true)
          }}
          onSuspend={suspend}
          user={opened}
        />
      )}

      {viewing === null ? null : (
        <UserViewDialog
          describe={describe}
          errors={errors}
          messages={messages}
          onCancel={() => {
            setViewing(null)
          }}
          onConfirm={open}
          target={viewing}
        />
      )}
    </div>
  )
}

/**
 * `2 페이지 · 20명`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (`reports` 화면과 같은
 * 방식).
 */
function pageStatus(messages: UserMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
