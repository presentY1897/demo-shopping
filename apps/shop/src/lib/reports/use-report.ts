'use client'

import type { ApiFailure, ReportTargetType } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useState } from 'react'

import type { ReportDraft } from './report-draft'
import { reportRequest } from './report-draft'
import { createReport } from './reports-api'

/**
 * 신고 한 건을 보낸다 (TASK-0091 F1 · F2).
 *
 * ## 접수된 뒤에는 다시 보낼 수 없다
 *
 * 같은 사람이 같은 대상을 두 번 신고할 수 없고(`REPORT_ALREADY_FILED`), 그것을
 * 화면이 **먼저** 안다 — 접수하고 나면 이 훅은 `done` 이 되고 다이얼로그는 버튼
 * 대신 「접수했습니다」를 그린다. 두 번째 클릭이 400 을 받아 오게 두면 사람은 자기가
 * 무언가 잘못했다고 읽는다.
 *
 * ## 거절 셋은 서로 다른 말이다
 *
 * 자기 글을 신고할 수 없다(`REPORT_OWN_CONTENT`)는 것과 이미 신고했다는 것과 서버가
 * 답하지 않았다는 것은 사람이 할 일이 전부 다르다. 그래서 실패는 `ApiFailure` 그대로
 * 나가고, 문장은 화면이 자기 카탈로그에서 고른다 (TASK-0117 4.2).
 */

export type ReportStep =
  | { readonly status: 'idle' }
  | { readonly status: 'sending' }
  | { readonly status: 'done' }
  | { readonly status: 'failed'; readonly failure: ApiFailure }

export interface ReportSubmission {
  readonly step: ReportStep
  readonly send: (
    draft: ReportDraft & { readonly reason: NonNullable<ReportDraft['reason']> },
  ) => void
  /** 다이얼로그를 닫았다 다시 열 때. 지난 실패가 남아 있으면 안 된다. */
  readonly reset: () => void
}

export function useReport(targetType: ReportTargetType, targetId: string): ReportSubmission {
  const [step, setStep] = useState<ReportStep>({ status: 'idle' })

  const send = useCallback(
    (draft: ReportDraft & { readonly reason: NonNullable<ReportDraft['reason']> }) => {
      setStep({ status: 'sending' })

      async function post(): Promise<void> {
        try {
          await createReport(reportRequest(targetType, targetId, draft))
          setStep({ status: 'done' })
        } catch (error) {
          setStep({ status: 'failed', failure: apiFailure(error) })
        }
      }

      void post()
    },
    [targetId, targetType],
  )

  const reset = useCallback(() => {
    // 접수된 것은 되돌리지 않는다. 다시 열어도 이미 신고한 대상이다.
    setStep((current) => (current.status === 'done' ? current : { status: 'idle' }))
  }, [])

  return { reset, send, step }
}
