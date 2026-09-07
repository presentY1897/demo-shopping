'use client'

import type { AdminDemoAccount } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { cleanupFailureOf, expiryStatus } from '@/lib/demo/demo-console'
import { demoDateTime } from '@/lib/demo/format'
import type { DemoAccountsMessages } from '@/messages'

/**
 * 데모 계정 목록의 표 (F1 · F4).
 *
 * ## 만료가 네 가지다
 *
 * 「사용 중 · 곧 만료 · 만료됨 · 만료 시각 없음」이 서로 다른 행동을 부른다
 * (`expiryStatus`). 특히 마지막은 빈칸으로 두면 「못 읽었다」와 섞이는데, 계약이
 * `expiresAt` 을 nullable 로 싣고 목록의 조건도 `isDemo` 하나라 실제로 온다.
 *
 * ## 정리 실패는 **칸**이다
 *
 * 시각과 이유가 짝이고(`cleanupFailureOf`), 다음 주기가 성공하면 그 칸은 그냥
 * 비워진다 — 표로 쌓아 두면 이미 정리된 계정의 옛 실패가 영영 남는다 (4.3).
 *
 * ## 계정을 가리키는 것은 **id 뿐**이다
 *
 * 계약이 데모 계정에는 이메일도 이름도 싣지 않는다(`adminDemoAccountSchema`). 이
 * 화면이 하는 일은 발급·만료·정리를 보는 것이지 사람을 보는 것이 아니고, 사람을
 * 봐야 하면 `/users` 가 사유를 받고 연다 (TASK-0093 4.1).
 */

export interface DemoAccountTableProps {
  readonly rows: readonly AdminDemoAccount[]
  readonly messages: DemoAccountsMessages
  /** 이 순간을 기준으로 만료를 재는가. 검사가 고정된 시각을 넣는다. */
  readonly now: number
  readonly busy: boolean
  readonly onExpire: (account: AdminDemoAccount) => void
}

export function DemoAccountTable({ rows, messages, now, busy, onExpire }: DemoAccountTableProps) {
  const columns: readonly TableColumn<AdminDemoAccount>[] = [
    {
      key: 'account',
      header: messages.columns.account,
      cell: (row) => <span className="text-fg font-mono text-2xs">{row.userId}</span>,
    },
    {
      key: 'roles',
      header: messages.columns.roles,
      cell: (row) =>
        row.roles.length === 0 ? (
          <span className="text-fg-subtle">{messages.noRoles}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <Badge key={role} size="sm" variant="neutral">
                {role}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: 'createdAt',
      header: messages.columns.createdAt,
      cell: (row) => demoDateTime(row.createdAt),
    },
    {
      key: 'expiresAt',
      header: messages.columns.expiresAt,
      cell: (row) => <ExpiryCell account={row} messages={messages} now={now} />,
    },
    {
      key: 'cleanup',
      header: messages.columns.cleanup,
      cell: (row) => <CleanupCell account={row} messages={messages} />,
    },
    {
      key: 'actions',
      header: messages.columns.actions,
      cell: (row) => (
        <Button
          disabled={busy}
          onClick={() => {
            onExpire(row)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {messages.expireLabel}
        </Button>
      ),
    },
  ]

  return (
    <Table
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => row.userId}
      rows={rows}
      sort={null}
    />
  )
}

/** 언제까지인가, 그리고 그것이 지금 어떤 상태인가. 둘 다 있어야 판단이 된다. */
function ExpiryCell({
  account,
  messages,
  now,
}: {
  readonly account: AdminDemoAccount
  readonly messages: DemoAccountsMessages
  readonly now: number
}) {
  const status = expiryStatus(account.expiresAt, now)

  return (
    <div className="flex flex-col gap-1">
      <Badge
        size="sm"
        variant={status === 'live' ? 'success' : status === 'endingSoon' ? 'warning' : 'neutral'}
      >
        {messages.expiryLabels[status]}
      </Badge>
      {account.expiresAt === null ? null : (
        <span className="text-fg-subtle text-xs">{demoDateTime(account.expiresAt)}</span>
      )}
    </div>
  )
}

/** 정리가 실패한 상태인가 — 시각과 이유의 짝으로 (4.3). */
function CleanupCell({
  account,
  messages,
}: {
  readonly account: AdminDemoAccount
  readonly messages: DemoAccountsMessages
}) {
  const failure = cleanupFailureOf(account)

  if (failure === null) return <span className="text-fg-subtle">{messages.cleanupNone}</span>

  return (
    <div className="flex flex-col gap-1">
      <Badge size="sm" variant="danger">
        {messages.cleanupFailedAt.replace('{datetime}', demoDateTime(failure.at))}
      </Badge>
      {/* 이유 없는 실패는 화면이 말할 것이 없다. 그래서 짝으로 읽고 함께 그린다. */}
      <span className="text-fg-subtle max-w-80 text-xs whitespace-pre-wrap">{failure.reason}</span>
    </div>
  )
}
