import type { Metadata } from 'next'

import { SettlementDetailWorkspace } from '@/components/settlements/settlement-detail-workspace'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.settlements.detail.title,
  description: messages.settlements.description,
}

/**
 * `/settlements/[id]` — 정산서 한 장과 그 계산 근거 (TASK-0081).
 *
 * `params` 를 여기서 `await` 해서 **prop 으로** 넘긴다. 클라이언트 경계가
 * `useParams()` 로 자기 경로 매개변수를 읽으면 그 화면의 검사는 전부 라우터를 먼저
 * 흉내 내는 데서 시작한다 (`app/claims/[id]/page.tsx` 와 같은 이유로 같은 모양이다).
 */
export default async function SettlementDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const { settlements, errors } = messagesFor()

  return <SettlementDetailWorkspace errors={errors} messages={settlements} settlementId={id} />
}
