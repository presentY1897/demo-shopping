import type { Metadata } from 'next'

import { ClaimDetailWorkspace } from '@/components/claims/claim-detail-workspace'
import { messagesFor } from '@/messages'

const title = messagesFor().claimDetail.title

export const metadata: Metadata = {
  title,
  description: messagesFor().claimDetail.description,
}

/**
 * `/claims/[id]` — 클레임 하나와 그 처리 (TASK-0070).
 *
 * `params` 를 여기서 `await` 해서 **prop 으로** 넘긴다. 클라이언트 경계가 `useParams()`
 * 로 자기 경로 매개변수를 읽으면 그 화면의 검사는 전부 라우터를 먼저 흉내 내는 데서
 * 시작한다 — 주문 상세와 재고 화면이 같은 이유로 같은 모양이다.
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params

  return <ClaimDetailWorkspace claimId={id} />
}
