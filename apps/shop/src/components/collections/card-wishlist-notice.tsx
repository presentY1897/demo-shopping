'use client'

import { messagesFor } from '@/messages'

/**
 * 목록의 하트를 누른 것이 **실패했을 때** 남는 한 줄 (TASK-0086 F2).
 *
 * 담겼다·빠졌다는 여기 없다. 카드의 하트가 `aria-pressed` 로 그것을 직접 말하게
 * 되었고(4.6), 같은 사실을 문장으로 한 번 더 말하면 스크린 리더는 한 번의 클릭에
 * 두 번 말한다. **실패는 다르다** — 되돌아간 하트는 「원래 그랬던 것」과 구별되지
 * 않으므로 `aria-pressed` 가 실패를 말할 방법이 없고, 아무 줄도 붙이지 않으면 사람은
 * 자기가 잘못 눌렀다고 읽는다.
 *
 * 실패하지 않았을 때도 자리를 지운 채 **비워 둔다.** `role="status"` 는 DOM 에 먼저
 * 있어야 뒤에 들어온 글을 읽어 주고, 자리를 두면 실패할 때 격자가 밀리지 않는다.
 *
 * 문구를 `messagesFor()` 에서 직접 읽는다. 이 줄이 놓이는 곳이 홈과 검색과 카테고리와
 * 브랜드관 넷이고, 그 넷이 쓰는 컴포넌트는 각자 다른 슬라이스를 받고 있다 — 넷 모두에
 * 프롭을 하나씩 더 꿰는 것보다 카탈로그를 여기서 한 번 여는 편이 낫다. 헤더의
 * 카테고리 메뉴가 같은 이유로 같은 일을 한다 (`shop-header.tsx`).
 */
export function CardWishlistNotice({ failed }: { readonly failed: boolean }) {
  const copy = messagesFor().collections.wishlist

  return (
    <p className="text-danger min-h-5 text-xs" role="status">
      {failed ? copy.failedNotice : ''}
    </p>
  )
}
