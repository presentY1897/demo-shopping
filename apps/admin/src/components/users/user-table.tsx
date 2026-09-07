'use client'

import type { AdminUserSummary } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { userDateTime } from '@/lib/users/format'
import type { UserMessages } from '@/messages'

/**
 * 회원 목록의 표 — **가려진 값만 있다** (F6).
 *
 * ## 여기에는 이메일 원본이 없다
 *
 * 계약이 `maskedEmail` 과 `maskedName` 만 싣는다(`adminUserSummarySchema`). 그래서
 * 이 컴포넌트에는 가리는 코드도, 가려진 값을 되돌리는 코드도 없다 — 가리는 일이
 * 서버의 것이라야 한 화면이 잊는 날 그 화면만 전부 보여 주는 일이 생기지 않고, 그때
 * 증상은 오류가 아니라 **이미 공개된 개인정보**다 (4.2 · D-246).
 *
 * ## 「데모」와 「정지」는 다른 것을 말한다
 *
 * 하나는 계정이 어떻게 만들어졌는가이고 하나는 지금 로그인할 수 있는가다. 한 칸에
 * 합치면 「데모라서 못 들어온다」로 읽히는데, 데모 계정은 멀쩡히 로그인한다.
 *
 * ## 마지막 로그인은 빈칸이 될 수 있다
 *
 * 발급만 되고 한 번도 안 들어온 계정이 실제로 있다(`lastLoginAt` 이 nullable 이다).
 * 빈칸으로 두면 「기록이 없다」와 「못 읽었다」가 섞이므로 문장을 그린다.
 */

export interface UserTableProps {
  readonly rows: readonly AdminUserSummary[]
  readonly messages: UserMessages
  /** 상세를 여는 첫 걸음. 여는 것이 아니라 **사유를 묻는 창**을 연다 (F7). */
  readonly onOpen: (user: AdminUserSummary) => void
}

export function UserTable({ rows, messages, onOpen }: UserTableProps) {
  const copy = messages.list

  const columns: readonly TableColumn<AdminUserSummary>[] = [
    {
      key: 'account',
      header: copy.columns.account,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-fg font-medium">{row.maskedName}</span>
          <span className="text-fg-subtle text-xs">{row.maskedEmail}</span>
          {row.isDemo ? (
            <span>
              <Badge size="sm" variant="neutral">
                {copy.demoBadge}
              </Badge>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'roles',
      header: copy.columns.roles,
      cell: (row) =>
        row.roles.length === 0 ? (
          <span className="text-fg-subtle">{copy.noRoles}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <Badge key={role} size="sm" variant="neutral">
                {messages.roleNames[role]}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: 'status',
      header: copy.columns.status,
      cell: (row) =>
        row.suspendedAt === null ? (
          <Badge variant="success">{copy.activeBadge}</Badge>
        ) : (
          <Badge variant="danger">{copy.suspendedBadge}</Badge>
        ),
    },
    {
      key: 'createdAt',
      header: copy.columns.createdAt,
      cell: (row) => userDateTime(row.createdAt),
    },
    {
      key: 'lastLoginAt',
      header: copy.columns.lastLoginAt,
      cell: (row) =>
        row.lastLoginAt === null ? (
          <span className="text-fg-subtle">{copy.neverLoggedIn}</span>
        ) : (
          userDateTime(row.lastLoginAt)
        ),
    },
    {
      key: 'open',
      header: copy.columns.open,
      cell: (row) => (
        <Button
          onClick={() => {
            onOpen(row)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {copy.openLabel}
        </Button>
      ),
    },
  ]

  return (
    <Table
      caption={copy.listLabel}
      columns={columns}
      rowKey={(row) => row.id}
      rows={rows}
      sort={null}
    />
  )
}
