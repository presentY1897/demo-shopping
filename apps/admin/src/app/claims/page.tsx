import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { ClaimListWorkspace } from '@/components/claims/claim-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/claims')

export const metadata: Metadata = {
  title,
  description: messages.claims.description,
}

/**
 * `/claims` — 판매자·구매자 분쟁에 관리자가 개입하는 자리 (TASK-0071).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착하고, 그것이 이 목록에 두 상태가 아니라 네 상태가 있는 이유다
 * (TASK-0101 4.3 · P5).
 */
export default function ClaimsPage() {
  const { claims, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={claims.description} title={title} />

      <ClaimListWorkspace errors={errors} messages={claims} notice={errorNotice} />
    </>
  )
}
