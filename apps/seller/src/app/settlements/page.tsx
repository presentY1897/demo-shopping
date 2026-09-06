import type { Metadata } from 'next'

import { SettlementListWorkspace } from '@/components/settlements/settlement-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const title = screenTitle('/settlements')

export const metadata: Metadata = {
  title,
  description: messagesFor().settlementList.description,
}

/**
 * `/settlements` — 정산 예정 금액과 회차별 정산서 (TASK-0082).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 숫자는
 * 클라이언트 경계가 효과에서 읽는다 — API 가 깨어나는 동안에도 화면의 뼈대가 먼저
 * 도착하고, 그것이 이 화면에 두 상태가 아니라 네 상태가 있는 이유다 (P5).
 */
export default function Page() {
  return <SettlementListWorkspace title={title} />
}
