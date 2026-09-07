'use client'

import type { Role } from '@shopping/shared'
import { roles } from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { UserFilters as Filters } from '@/lib/users/user-console'
import { EMPTY_USER_FILTERS, USER_SEARCH_MAX } from '@/lib/users/user-console'
import type { UserListMessages, UserMessages } from '@/messages'

/**
 * 네 축과 되돌리기 하나 (F1).
 *
 * ## 검색은 **누른 뒤에** 나간다
 *
 * 셀렉트 셋은 고르는 즉시 나가지만 검색어는 그렇지 않다. 글자마다 보내면 「hong」을
 * 치는 사이에 요청이 네 번 나가고 그중 셋은 아무도 보지 않을 답이며, 서버 쪽 조건은
 * `ILIKE '%…%'` 라 그 셋이 싸지도 않다(`admin-user.service.ts`). 그래서 이 칸은
 * **초안**을 들고 있고, 제출이 그것을 필터로 옮긴다.
 *
 * 「조건 지우기」가 초안도 함께 비운다. 필터만 비우고 칸에 글자를 남기면 화면이 자기
 * 상태를 두 가지로 말하게 된다.
 *
 * **다섯 역할을 손으로 적지 않는다.** 계약에 역할이 하나 늘면 이 목록은 저절로 자라고,
 * 이름이 없으면 `Record<Role, string>` 이 컴파일로 잡는다 (`report-filters.tsx` 와
 * 같은 규약).
 */

export interface UserFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: UserListMessages
  readonly roleNames: UserMessages['roleNames']
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

const YES = 'YES'

const NO = 'NO'

/** 셋 중 하나를 참·거짓·전체로. 셀렉트가 문자열만 다루기 때문에 한 번 옮긴다. */
function toTriState(value: string): boolean | null {
  if (value === YES) return true

  return value === NO ? false : null
}

function fromTriState(value: boolean | null): string {
  if (value === null) return ALL

  return value ? YES : NO
}

export function UserFilters({
  value,
  onChange,
  messages,
  roleNames,
  disabled = false,
}: UserFiltersProps) {
  const searchId = useId()
  const hintId = useId()
  const roleId = useId()
  const demoId = useId()
  const suspendedId = useId()

  /**
   * 아직 보내지 않은 검색어.
   *
   * 밖에서 들어온 값을 효과로 따라가지 **않는다.** `q` 를 바꾸는 길이 이 컴포넌트의
   * 제출과 「조건 지우기」 둘뿐이고 둘 다 여기서 초안을 함께 손보므로, 동기화 효과는
   * 할 일이 없는 채로 렌더를 한 번 더 돌게 만들 뿐이다.
   */
  const [draft, setDraft] = useState(value.q)

  const { filters } = messages

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        onChange({ ...value, q: draft })
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{filters.legend}</legend>

        <div className="flex min-w-64 grow flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={searchId}>
            {filters.searchLabel}
          </label>
          <Input
            aria-describedby={hintId}
            disabled={disabled}
            id={searchId}
            maxLength={USER_SEARCH_MAX}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            placeholder={filters.searchPlaceholder}
            type="search"
            value={draft}
          />
          <p className="text-fg-subtle text-xs" id={hintId}>
            {filters.searchHint}
          </p>
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={roleId}>
            {filters.roleLabel}
          </label>
          <Select
            disabled={disabled}
            id={roleId}
            onValueChange={(next) => {
              onChange({ ...value, role: next === ALL ? null : (next as Role) })
            }}
            options={[
              { value: ALL, label: filters.roleAll },
              ...roles.map((role) => ({ value: role, label: roleNames[role] })),
            ]}
            value={value.role ?? ALL}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={demoId}>
            {filters.demoLabel}
          </label>
          <Select
            disabled={disabled}
            id={demoId}
            onValueChange={(next) => {
              onChange({ ...value, isDemo: toTriState(next) })
            }}
            options={[
              { value: ALL, label: filters.demoAll },
              { value: YES, label: filters.demoOnly },
              { value: NO, label: filters.realOnly },
            ]}
            value={fromTriState(value.isDemo)}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={suspendedId}>
            {filters.suspendedLabel}
          </label>
          <Select
            disabled={disabled}
            id={suspendedId}
            onValueChange={(next) => {
              onChange({ ...value, suspended: toTriState(next) })
            }}
            options={[
              { value: ALL, label: filters.suspendedAll },
              { value: YES, label: filters.suspendedOnly },
              { value: NO, label: filters.activeOnly },
            ]}
            value={fromTriState(value.suspended)}
          />
        </div>

        <Button disabled={disabled} type="submit" variant="primary">
          {filters.searchSubmit}
        </Button>

        <Button
          onClick={() => {
            setDraft('')
            onChange(EMPTY_USER_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>
    </form>
  )
}
