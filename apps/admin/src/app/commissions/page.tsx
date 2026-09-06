import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { CommissionWorkspace } from '@/components/commissions/commission-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/commissions')

export const metadata: Metadata = {
  title,
  description: messages.commissions.description,
}

/**
 * `/commissions` — 플랫폼 수수료율을 정하는 자리 (TASK-0079).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 요율은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 */
export default function CommissionsPage() {
  const { commissions, errors } = messagesFor()

  return (
    <>
      <PageHeader description={commissions.description} title={title} />

      <CommissionWorkspace errors={errors} messages={commissions} />
    </>
  )
}
