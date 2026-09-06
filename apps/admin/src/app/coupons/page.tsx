import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { PlatformCouponWorkspace } from '@/components/coupons/platform-coupon-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/coupons')

export const metadata: Metadata = {
  title,
  description: messages.coupons.description,
}

/**
 * `/coupons` — 플랫폼이 부담하는 쿠폰을 내고 관리하는 자리 (TASK-0073).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착하고, 그것이 이 목록에 두 상태가 아니라 네 상태가 있는 이유다
 * (TASK-0101 4.3 · P5).
 */
export default function CouponsPage() {
  const { coupons, errors } = messagesFor()

  return (
    <>
      <PageHeader description={coupons.description} title={title} />

      <PlatformCouponWorkspace errors={errors} messages={coupons} />
    </>
  )
}
