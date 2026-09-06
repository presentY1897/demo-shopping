import { RequireSignIn } from '@/components/auth/require-sign-in'
import { CouponBox } from '@/components/mypage/coupon-box'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/**
 * 쿠폰함 (TASK-0077).
 *
 * 껍데기는 서버에서 그려지고 목록은 클라이언트 컴포넌트다 — 제목과 내비게이션이 화면에
 * 있는 동안 쿠폰이 아직 오는 중일 수 있고, 이 프로젝트의 무료 요금제 API 에서 그 사이가
 * 길다 (TASK-0101).
 *
 * 색인되지 않는다 — `/mypage` 레이아웃이 `robots` 를 이미 걸어 두었고, 그것이 레이아웃에
 * 있는 이유가 정확히 이 경우다: 나중에 생긴 라우트가 한 줄을 잊어서 누군가의 쿠폰함이
 * 검색 결과에 뜨는 일.
 */
export default function CouponsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="coupons"
      description={copy.coupons.description}
      nav={copy.nav}
      title={copy.coupons.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <CouponBox messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
