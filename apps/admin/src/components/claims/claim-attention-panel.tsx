'use client'

import type { ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage, platformOwnership } from '@shopping/shared'
import { Badge, linkClassName, Skeleton } from '@shopping/ui/components'
import NextLink from 'next/link'
import { useCallback } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useClaimAttention } from '@/lib/claims/use-claim-attention'
import type { AdminClaimMessages } from '@/messages'

import { FailedRefundSection, OverdueSection } from './attention-sections'

/**
 * 대시보드의 클레임 자리 (F7) — **기한을 넘긴 건과 나가지 못한 환불**.
 *
 * ## 왜 숫자가 아니라 목록인가
 *
 * 「기한 초과 3건」만 있는 패널은 세 번째 화면을 열게 만드는 뱃지다. 여기서 필요한
 * 것은 **무엇이 밀렸는가**이고, 그것은 클레임 화면이 이미 그리는 표이므로 같은
 * 컴포넌트를 몇 줄만 읽어 쓴다.
 *
 * ## 대시보드가 아직 껍데기라는 사실
 *
 * 이 화면의 본체는 TASK-0092 의 것이고, 지금 여기 있는 것은 API 깨우기 패널뿐이다.
 * 그래서 이 패널은 **자기 자리만 차지한다** — 대시보드의 레이아웃을 정하지 않고,
 * 제목과 링크를 갖춘 한 구획으로 서 있다가 진짜 대시보드가 오면 그 격자의 한 칸이
 * 된다.
 *
 * **읽을 수 없는 계정에는 아무것도 그리지 않는다.** 이 패널이 없는 대시보드는
 * 멀쩡하고, 「볼 수 없어요」가 대시보드 한복판에 있는 것은 그 계정이 할 수 있는 일에
 * 대해 아무것도 알려 주지 않는다.
 */

/** 대시보드가 읽는 줄 수. 「무엇이 밀렸나」에 답할 만큼이고 목록을 옮겨 오지는 않는다. */
const PREVIEW_LIMIT = 5

export interface ClaimAttentionPanelProps {
  readonly messages: AdminClaimMessages
  readonly errors: ErrorMessages
}

export function ClaimAttentionPanel({ messages, errors }: ClaimAttentionPanelProps) {
  const { ready, canOn } = useAuthorization()

  if (!ready) return <Skeleton label={messages.attention.loadingLabel} lines={3} />

  // 목록 화면과 **같은 질문**이다 — 이 라우트가 요구하는 것은 `claim.read:any` 이고,
  // 그것을 `platformOwnership` 이 말한다.
  if (!canOn('claim.read', platformOwnership)) return null

  return <AttentionBody errors={errors} messages={messages} />
}

function AttentionBody({ messages, errors }: ClaimAttentionPanelProps) {
  const attention = useClaimAttention(PREVIEW_LIMIT)
  const { attention: copy } = messages

  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const overdueCount = attention.overdue.status === 'ready' ? attention.overdue.claims.length : null
  const failedCount = attention.refunds.status === 'ready' ? attention.refunds.refunds.length : null
  const settled = overdueCount === 0 && failedCount === 0

  return (
    <section
      aria-label={copy.title}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-fg text-lg font-medium">{copy.title}</h2>
          <p className="text-fg-muted text-sm">{copy.description}</p>
        </div>
        <NextLink className={linkClassName()} href="/claims">
          {copy.link}
        </NextLink>
      </header>

      {/*
        숫자는 **읽어 본 뒤에만** 붙인다. 불러오는 중의 0 은 「없다」로 읽히고, 그 0 은
        잠시 뒤 3 으로 바뀐다.
      */}
      <p className="flex flex-wrap items-center gap-2">
        {overdueCount === null ? null : (
          <Badge variant={overdueCount === 0 ? 'neutral' : 'danger'}>
            {copy.overdueCount.replace('{count}', String(overdueCount))}
          </Badge>
        )}
        {failedCount === null ? null : (
          <Badge variant={failedCount === 0 ? 'neutral' : 'danger'}>
            {copy.failedCount.replace('{count}', String(failedCount))}
          </Badge>
        )}
      </p>

      {/*
        둘 다 0 이면 표 두 개 대신 한 문장이다. 빈 표 둘은 대시보드에서 자리만 차지하고,
        「지금 할 일이 없다」는 표가 아니라 문장으로 읽는 것이 빠르다.
      */}
      {settled ? (
        <p className="text-fg-muted text-sm">{copy.allClear}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <OverdueSection
            describe={describe}
            list={messages.list}
            messages={messages.overdue}
            onRetry={attention.reload}
            state={attention.overdue}
            vocabulary={messages.vocabulary}
          />
          <FailedRefundSection
            describe={describe}
            messages={messages.failedRefunds}
            onRetry={attention.reload}
            retryLabel={messages.list.retryLabel}
            state={attention.refunds}
            vocabulary={messages.vocabulary}
          />
        </div>
      )}
    </section>
  )
}
