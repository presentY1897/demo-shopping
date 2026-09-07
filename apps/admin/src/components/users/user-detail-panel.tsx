'use client'

import type {
  AdjustPointsRequest,
  AdjustPointsResponse,
  AdminUserDetail,
  ApiFailure,
  ErrorMessages,
  Role,
} from '@shopping/shared'
import { Badge, Button, Divider } from '@shopping/ui/components'

import { userCount, userDateTime, userMoney } from '@/lib/users/format'
import type { UserWrite } from '@/lib/users/use-users'
import type { UserMessages } from '@/messages'

import { UserPointsPanel } from './user-points-panel'
import { UserRolesPanel } from './user-roles-panel'
import { UserSuspensionPanel } from './user-suspension-panel'

/**
 * 열린 계정 — 가려지지 않은 값과 요약, 그리고 할 수 있는 일 셋 (F2 · F3 · F4 · F5).
 *
 * ## 이 화면은 **다시 읽지 않는다**
 *
 * 이 패널이 그리는 것은 `POST /admin/users/:id/views` 한 번의 답이다. 무엇이
 * 달라졌는지 확인하려고 그 문을 다시 두드리면 **열람 기록이 한 줄 더 는다** — 열람은
 * 상태가 아니라 사건이고, 「한 번 봤다」와 「두 번 봤다」가 다르다는 것이 그 기록의
 * 요점이다 (4.3).
 *
 * 그래서 규칙이 하나다: **서버가 답으로 준 것만 화면에 앉힌다.**
 *
 * | 쓰기 | 답 | 화면이 하는 일 |
 * | --- | --- | --- |
 * | 역할 부여·회수 | 바뀐 뒤의 집합 전체 | 그대로 앉힌다 |
 * | 적립금 조정 | 잔액과 실제 반영액 | 잔액을 그대로 앉힌다 |
 * | 정지·해제 | **204** | 앉힐 것이 없다 — 패널을 닫고 목록이 말하게 한다 |
 *
 * 마지막 줄이 이 파일에서 가장 중요한 판단이다. 정지 시각을 화면이 지어내면(브라우저
 * 시계로 `new Date()`) 그 값은 서버가 적은 시각과 다르고, 그 차이는 아무 데서도
 * 드러나지 않는다.
 *
 * ## 요약은 **숫자만**이다
 *
 * 계약이 그렇게 싣는다(`adminUserStatsSchema`). 주문 목록이나 리뷰 본문까지 여기
 * 있으면 「요약을 보려고 연 화면」이 사실상 그 사람의 전부를 여는 화면이 되고, 열람
 * 기록 하나가 그 전부를 덮는다.
 */

export interface UserDetailPanelProps {
  readonly user: AdminUserDetail
  readonly messages: UserMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly busy: boolean
  /** `user.write` 를 가졌는가. 정지도 적립금도 역할도 그 하나에 걸린다 (4.6). */
  readonly canWrite: boolean
  readonly denial: string | undefined
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onSuspend: (reason: string) => Promise<ApiFailure | null>
  readonly onReinstate: () => Promise<ApiFailure | null>
  readonly onAdjust: (
    request: AdjustPointsRequest,
  ) => Promise<UserWrite<AdjustPointsResponse> | null>
  readonly onGrant: (role: Role) => void
  readonly onRevoke: (role: Role) => void
  readonly describe: (failure: ApiFailure) => string
}

export function UserDetailPanel({
  user,
  messages,
  errors,
  busy,
  canWrite,
  denial,
  onClose,
  onRefresh,
  onSuspend,
  onReinstate,
  onAdjust,
  onGrant,
  onRevoke,
  describe,
}: UserDetailPanelProps) {
  const copy = messages.detail

  return (
    <section
      aria-label={copy.title}
      className="border-border flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-fg text-base font-medium">{copy.title}</h2>
        <Button onClick={onClose} size="sm" type="button" variant="ghost">
          {copy.closeLabel}
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">{copy.emailLabel}</dt>
        <dd className="text-fg">{user.email}</dd>

        <dt className="text-fg-muted">{copy.nameLabel}</dt>
        <dd className="text-fg">{user.name}</dd>

        <dt className="text-fg-muted">{copy.statusLabel}</dt>
        <dd>
          {user.suspendedAt === null ? (
            <Badge variant="success">{copy.statusActive}</Badge>
          ) : (
            <Badge variant="danger">{copy.statusSuspended}</Badge>
          )}
        </dd>

        <dt className="text-fg-muted">{copy.createdAtLabel}</dt>
        <dd className="text-fg">{userDateTime(user.createdAt)}</dd>

        <dt className="text-fg-muted">{copy.lastLoginAtLabel}</dt>
        <dd className="text-fg">
          {user.lastLoginAt === null ? copy.neverLoggedIn : userDateTime(user.lastLoginAt)}
        </dd>
      </dl>

      {/* 데모 계정이라는 사실은 조치를 판단하는 데 필요하다 — 수명이 지나면 이
          계정과 그것이 만든 데이터가 함께 사라지므로, 정지도 적립금도 곧 무의미해진다. */}
      {user.isDemo ? <p className="text-fg-muted text-xs">{copy.demoNotice}</p> : null}

      <Divider />

      <section aria-label={copy.statsTitle} className="flex flex-col gap-2">
        <h3 className="text-fg text-sm font-medium">{copy.statsTitle}</h3>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <dt className="text-fg-muted">{copy.stats.orderCount}</dt>
          <dd className="text-fg">
            {copy.stats.countValue.replace('{count}', userCount(user.stats.orderCount))}
          </dd>

          <dt className="text-fg-muted">{copy.stats.paidAmount}</dt>
          <dd className="text-fg">{userMoney(user.stats.paidAmount)}</dd>

          <dt className="text-fg-muted">{copy.stats.reviewCount}</dt>
          <dd className="text-fg">
            {copy.stats.countValue.replace('{count}', userCount(user.stats.reviewCount))}
          </dd>

          <dt className="text-fg-muted">{copy.stats.questionCount}</dt>
          <dd className="text-fg">
            {copy.stats.countValue.replace('{count}', userCount(user.stats.questionCount))}
          </dd>

          <dt className="text-fg-muted">{copy.stats.pointBalance}</dt>
          <dd className="text-fg">{userMoney(user.stats.pointBalance)}</dd>

          <dt className="text-fg-muted">{copy.stats.couponCount}</dt>
          <dd className="text-fg">
            {copy.stats.countValue.replace('{count}', userCount(user.stats.couponCount))}
          </dd>
        </dl>

        <p className="text-fg-subtle text-xs">{copy.statsNote}</p>
      </section>

      <Divider />

      <UserRolesPanel
        busy={busy}
        canWrite={canWrite}
        denial={denial}
        messages={messages}
        onGrant={onGrant}
        onRevoke={onRevoke}
        roles={user.roles}
      />

      <Divider />

      <UserSuspensionPanel
        busy={busy}
        canWrite={canWrite}
        denial={denial}
        describe={describe}
        errors={errors}
        messages={messages}
        onRefresh={onRefresh}
        onReinstate={onReinstate}
        onSuspend={onSuspend}
        user={user}
      />

      <Divider />

      <UserPointsPanel
        balance={user.stats.pointBalance}
        busy={busy}
        canWrite={canWrite}
        denial={denial}
        describe={describe}
        errors={errors}
        messages={messages}
        onAdjust={onAdjust}
        onRefresh={onRefresh}
      />
    </section>
  )
}
