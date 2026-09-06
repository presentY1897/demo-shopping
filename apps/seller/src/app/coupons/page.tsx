import type { Metadata } from 'next'

import { CouponListWorkspace } from '@/components/coupons/coupon-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const title = screenTitle('/coupons')

export const metadata: Metadata = {
  title,
  description: messagesFor().couponList.description,
}

/**
 * `/coupons` — 판매자 쿠폰 발행과 부담 누계 (TASK-0074).
 *
 * 아무것도 `await` 하지 않는다. 제목과 정산 안내는 이 서버 컴포넌트의 것이고 줄은
 * 클라이언트 경계가 효과에서 읽는다 — API 가 깨어나는 동안에도 화면의 뼈대가 먼저
 * 도착하고, 그것이 이 목록에 두 상태가 아니라 네 상태가 있는 이유다 (P5).
 */
export default function Page() {
  return <CouponListWorkspace title={title} />
}
