import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { SettlementListWorkspace } from '@/components/settlements/settlement-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/settlements')

export const metadata: Metadata = {
  title,
  description: messages.settlements.description,
}

/**
 * `/settlements` — 회차별 정산서를 검토하고 승인·지급하는 자리 (TASK-0081).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 */
export default function SettlementsPage() {
  const { settlements, errors } = messagesFor()

  return (
    <>
      <PageHeader description={settlements.description} title={title} />

      <SettlementListWorkspace errors={errors} messages={settlements} />
    </>
  )
}
