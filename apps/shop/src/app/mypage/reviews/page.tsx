import { RequireSignIn } from '@/components/auth/require-sign-in'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { ReviewableList } from '@/components/reviews/reviewable-list'
import { messagesFor } from '@/messages'

/**
 * 리뷰 쓰기 (TASK-0083 F6 · F7).
 *
 * 껍데기는 서버에서 그려지고 목록은 클라이언트 컴포넌트다 — 제목과 내비게이션이 화면에
 * 있는 동안 목록이 아직 오는 중일 수 있고, 이 프로젝트의 무료 요금제 API 에서 그 사이가
 * 길다 (TASK-0101).
 *
 * 색인되지 않는다 — `/mypage` 레이아웃이 `robots` 를 이미 걸어 두었고, 그것이 레이아웃에
 * 있는 이유가 정확히 이 경우다: 나중에 생긴 라우트가 한 줄을 잊어서 누군가의 주문 내역이
 * 검색 결과에 뜨는 일.
 */
export default function ReviewsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="reviews"
      description={copy.reviews.description}
      nav={copy.nav}
      title={copy.reviews.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <ReviewableList messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
