'use client'

import type { ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Divider, EmptyState, Skeleton, ToastProvider, useToast } from '@shopping/ui/components'
import { useCallback } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useDemoAccounts, useDemoPolicy, useDemoStats } from '@/lib/demo/use-demo-console'
import type { DemoConsoleMessages, UserMessages } from '@/messages'

import { DemoAccountsPanel } from './demo-accounts-panel'
import { DemoPolicyPanel } from './demo-policy-panel'
import { DemoStatsPanel } from './demo-stats-panel'

/**
 * `/demo` — 발급 현황과 정리 상태 (TASK-0096).
 *
 * ## 볼 수 있는 자격과 바꿀 수 있는 자격이 **같다**
 *
 * 여섯 문 전부가 `demo.manage` 하나다(`admin-console.controller.ts`). 그래서 이
 * 화면에는 회원 화면 같은 `GuardedButton` 이 없다 — 목록이 보이는 계정은 강제 만료도
 * 정리 실행도 누를 수 있고, 세 관리자 역할이 모두 그 퍼미션을 갖는다.
 *
 * 데모 관리자의 `demo.manage` 는 스코프가 `demo` 로 좁혀져 있지만
 * (`role-permissions.ts` 의 `narrowToDemo`), 이 화면이 다루는 것은 **데모 계정뿐**이라
 * 그 좁힘이 닿지 않는 줄이 없다. 데모 관리자를 위해 만들어진 화면에서 데모 관리자가
 * 막히면 그것이 이상한 일이다.
 *
 * ## 세 섹션이 각자 읽는다
 *
 * 훅이 셋이고 상태도 셋이다. 정책을 못 읽어도 계정 목록과 통계는 그려지고, 그 반대도
 * 마찬가지다 — **실패한 섹션은 빈 섹션이지 오류 페이지가 아니다** (TASK-0092 4.1 과
 * 같은 판단).
 *
 * ## 정리가 돌면 통계도 달라진다
 *
 * 강제 만료와 정리 실행은 활성 계정 수와 정리 실패 수를 함께 바꾼다. 계정 목록만
 * 다시 읽으면 위의 두 숫자가 옛 값으로 남고, 그 어긋남은 조용하다.
 */

export interface DemoConsoleWorkspaceProps {
  readonly messages: DemoConsoleMessages
  /**
   * 역할 이름 — **회원 화면의 카탈로그에서 온다.**
   *
   * 이 화면도 역할을 그리지만(역할별 통계), 두 화면이 같은 역할을 다르게 부르면
   * 그것이 표를 하나로 두는 이유다. 페이지가 그 표를 넘겨준다.
   */
  readonly roleNames: UserMessages['roleNames']
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 만료와 기본 기간을 재는 기준 시각. 검사가 고정된 값을 넣는다. */
  readonly now?: Date
}

export function DemoConsoleWorkspace({
  messages,
  roleNames,
  errors,
  now,
}: DemoConsoleWorkspaceProps) {
  const { ready, can, reason } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.accounts.loadingLabel} lines={8} />

  if (!can('demo.manage')) {
    return <EmptyState description={reason('demo.manage')} title={messages.forbiddenTitle} />
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <DemoSections errors={errors} messages={messages} now={now} roleNames={roleNames} />
    </ToastProvider>
  )
}

function DemoSections({ messages, roleNames, errors, now }: DemoConsoleWorkspaceProps) {
  const policy = useDemoPolicy()
  const accounts = useDemoAccounts()
  const stats = useDemoStats(now)
  const { toast } = useToast()

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const policyState = policy.state

  return (
    <div className="flex flex-col gap-8">
      <DemoPolicyPanel
        busy={policy.busy}
        describe={describe}
        errors={errors}
        failureText={policyState.status === 'error' ? describe(policyState.failure) : undefined}
        messages={messages}
        onReload={policy.reload}
        onSave={policy.save}
        onSaved={() => {
          toast({ title: messages.toast.policySaved, variant: 'success' })
        }}
        policy={policyState.status === 'ready' ? policyState.data : null}
        status={policyState.status}
      />

      <Divider />

      <DemoAccountsPanel
        accounts={accounts}
        describe={describe}
        messages={messages}
        now={(now ?? new Date()).getTime()}
        onSwept={stats.reload}
      />

      <Divider />

      <DemoStatsPanel
        describe={describe}
        messages={messages}
        now={now}
        roleNames={roleNames}
        stats={stats}
      />
    </div>
  )
}
