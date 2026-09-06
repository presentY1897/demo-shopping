'use client'

import type { ClaimStatus, ClaimType } from '@shopping/shared'
import { claimStatuses, claimTypes } from '@shopping/shared'
import { Button, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { SellerClaimFilters } from '@/lib/claims/use-seller-claims'
import { EMPTY_CLAIM_FILTERS } from '@/lib/claims/use-seller-claims'
import type { ClaimListMessages, ClaimVocabularyMessages } from '@/messages'
import { messagesFor } from '@/messages'

/**
 * 유형과 상태의 축.
 *
 * **단계는 여기 없다.** 위의 탭이 그것을 맡고, 한 조건을 두 자리에서 고를 수 있게
 * 만들면 어느 쪽이 이기는지를 정해야 한다 — 그 규칙은 아무도 기억하지 못한다
 * (`order-filters.tsx` 가 상태 탭에 대해 같은 문장을 적어 두었다).
 *
 * **상태 축이 남아 있는 이유.** 탭은 「내가 뭘 해야 하나」로 셋이지만, 「거절한 건만
 * 모아 보고 싶다」는 그 셋 중 어느 것도 아니다. 계약의 `status` 가 탭과 함께 걸리는
 * 것이 그 답이고, 둘 다 보내면 서버가 둘 다 적용한다.
 */
export interface ClaimFiltersProps {
  readonly value: SellerClaimFilters
  readonly onChange: (filters: SellerClaimFilters) => void
  readonly messages: ClaimListMessages
  readonly vocabulary?: ClaimVocabularyMessages
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

export function ClaimFilters({
  value,
  onChange,
  messages,
  vocabulary = messagesFor().claims,
  disabled = false,
}: ClaimFiltersProps) {
  const typeId = useId()
  const statusId = useId()

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{messages.filters.legend}</legend>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={typeId}>
            {messages.filters.typeLabel}
          </label>
          <Select
            disabled={disabled}
            id={typeId}
            onValueChange={(next) => {
              onChange({ ...value, type: next === ALL ? null : (next as ClaimType) })
            }}
            options={[
              { value: ALL, label: messages.filters.typeAll },
              ...claimTypes.map((type) => ({
                value: type,
                label: vocabulary.typeLabels[type],
              })),
            ]}
            value={value.type ?? ALL}
          />
        </div>

        <div className="flex min-w-48 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={statusId}>
            {messages.filters.statusLabel}
          </label>
          <Select
            disabled={disabled}
            id={statusId}
            onValueChange={(next) => {
              onChange({ ...value, status: next === ALL ? null : (next as ClaimStatus) })
            }}
            options={[
              { value: ALL, label: messages.filters.statusAll },
              // 열 개를 손으로 적지 않는다. 상태가 하나 늘면 이 목록은 저절로 자라고,
              // 문장이 없으면 `Record<ClaimStatus, string>` 이 컴파일로 잡는다.
              ...claimStatuses.map((status) => ({
                value: status,
                label: vocabulary.statusLabels[status],
              })),
            ]}
            value={value.status ?? ALL}
          />
        </div>

        <Button
          onClick={() => {
            // 탭은 남긴다. 「조건 지우기」가 탭까지 되돌리면 판매자는 보고 있던 목록을
            // 잃고, 그것은 지우려던 것이 아니다.
            onChange({ ...EMPTY_CLAIM_FILTERS, tab: value.tab })
          }}
          type="button"
          variant="ghost"
        >
          {messages.filters.reset}
        </Button>
      </fieldset>
    </form>
  )
}
