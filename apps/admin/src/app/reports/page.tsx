import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { ReportListWorkspace } from '@/components/reports/report-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/reports')

export const metadata: Metadata = {
  title,
  description: messages.reports.description,
}

/**
 * `/reports` — 들어온 신고를 검토하고 숨김·삭제·반려로 처리하는 자리 (TASK-0091).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 */
export default function ReportsPage() {
  const { reports, errors } = messagesFor()

  return (
    <>
      <PageHeader description={reports.description} title={title} />

      <ReportListWorkspace errors={errors} messages={reports} />
    </>
  )
}
