'use client'

import type { Role } from '@shopping/shared'
import { Badge, Button, GuardedButton, Select } from '@shopping/ui/components'
import { ConfirmDialog } from '@shopping/ui/form'
import { useId, useState } from 'react'

import { grantableRoles, isAdminRole } from '@/lib/users/user-console'
import type { UserMessages } from '@/messages'

/**
 * 역할 부여와 회수 (F3 · R1).
 *
 * ## 관리자 역할에는 한 걸음이 더 있다
 *
 * 부여하는 순간 이 콘솔 전체가 열린다. 목록에서 잘못 고른 한 번이 곧 최고관리자 한
 * 명이고, 회수는 되지만 **그 사이에 일어난 일은 되돌아오지 않는다.** 어떤 역할이
 * 그런 역할인지는 `isAdminRole` 이 표로 들고 있다 — `startsWith('ADMIN')` 으로 적으면
 * `DEMO_ADMIN` 이 조용히 빠지고, 그것도 콘솔에 들어오는 역할이다.
 *
 * ## 막힌 버튼은 감추지 않는다 (F8)
 *
 * 부여·회수는 `user.write` 라 최고관리자만 한다. 운영자와 데모 관리자에게 이 버튼들을
 * 감추면 콘솔이 실제보다 적은 기능을 가진 것처럼 보이고, 무엇을 요청해야 하는지도 알
 * 수 없다. 그래서 자리에 그대로 두고 **왜 못 누르는지**를 말한다
 * (`settlement-actions.tsx` 와 같은 규약).
 *
 * ## 이미 가진 역할은 고를 수 없다
 *
 * 서버는 그것을 다시 부여해도 같은 집합으로 답하지만, 눌러도 아무 일도 안 일어나는
 * 항목은 눌러 본 사람에게 고장으로 읽힌다 (`grantableRoles`).
 */

export interface UserRolesPanelProps {
  readonly roles: readonly Role[]
  readonly messages: UserMessages
  readonly busy: boolean
  /** `user.write` 를 가졌는가. 부르는 쪽이 `useAuthorization` 에 물어 넘긴다. */
  readonly canWrite: boolean
  /** 왜 못 하는지, 또는 할 수 있으면 `undefined`. */
  readonly denial: string | undefined
  readonly onGrant: (role: Role) => void
  readonly onRevoke: (role: Role) => void
}

export function UserRolesPanel({
  roles,
  messages,
  busy,
  canWrite,
  denial,
  onGrant,
  onRevoke,
}: UserRolesPanelProps) {
  const copy = messages.roles
  const selectId = useId()

  const [choice, setChoice] = useState<Role | null>(null)
  /** 확인을 기다리는 관리자 역할. `null` 이면 대화상자가 닫혀 있다. */
  const [confirming, setConfirming] = useState<Role | null>(null)

  const available = grantableRoles(roles)

  function grant(role: Role): void {
    if (isAdminRole(role)) {
      setConfirming(role)

      return
    }

    setChoice(null)
    onGrant(role)
  }

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-fg text-sm font-medium">{copy.title}</h3>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      {roles.length === 0 ? (
        <p className="text-fg-subtle text-sm">{copy.none}</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-2">
          {roles.map((role) => (
            <li className="flex items-center gap-1" key={role}>
              <Badge variant="neutral">{messages.roleNames[role]}</Badge>
              {canWrite ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    onRevoke(role)
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {copy.revokeLabel.replace('{role}', messages.roleNames[role])}
                </Button>
              ) : (
                <GuardedButton
                  blocked
                  // 자격이 없으면 `reason` 이 반드시 있다 — 자격을 묻는 함수와 이유를
                  // 묻는 함수가 같은 판정을 지나기 때문이다(`useAuthorization`).
                  // 그래도 그 사실을 타입으로 말할 수는 없으므로 빈 문장 대신
                  // 어느 퍼미션이 필요한지를 남긴다.
                  reason={denial ?? 'user.write'}
                  size="sm"
                  variant="ghost"
                >
                  {copy.revokeLabel.replace('{role}', messages.roleNames[role])}
                </GuardedButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 ? (
        <p className="text-fg-subtle text-sm">{copy.exhausted}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={selectId}>
              {copy.grantLabel}
            </label>
            <Select
              disabled={busy}
              id={selectId}
              onValueChange={(next) => {
                setChoice(next as Role)
              }}
              options={available.map((role) => ({ value: role, label: messages.roleNames[role] }))}
              placeholder={copy.grantPlaceholder}
              value={choice ?? undefined}
            />
          </div>

          {canWrite ? (
            <Button
              disabled={busy || choice === null}
              onClick={() => {
                if (choice !== null) grant(choice)
              }}
              type="button"
              variant="primary"
            >
              {copy.grantSubmit}
            </Button>
          ) : (
            <GuardedButton blocked reason={denial ?? 'user.write'} variant="primary">
              {copy.grantSubmit}
            </GuardedButton>
          )}
        </div>
      )}

      <p className="text-fg-muted text-xs">{copy.adminNotice}</p>

      {confirming === null ? null : (
        <ConfirmDialog
          cancelLabel={copy.confirm.cancel}
          closeLabel={copy.confirm.closeLabel}
          confirmLabel={copy.confirm.confirm}
          description={copy.confirm.description.replace('{role}', messages.roleNames[confirming])}
          onConfirm={() => {
            const role = confirming

            setConfirming(null)
            setChoice(null)
            onGrant(role)
          }}
          onOpenChange={(next) => {
            if (!next) setConfirming(null)
          }}
          open
          title={copy.confirm.title}
        />
      )}
    </section>
  )
}
