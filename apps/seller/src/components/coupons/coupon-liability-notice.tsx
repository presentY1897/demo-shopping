import type { CouponLiability } from '@/lib/coupons/coupon-console'
import { count, money } from '@/lib/orders/format'
import type { CouponWarningMessages } from '@/messages'

/**
 * 발행 폼 맨 위에 서 있는 경고 (TASK-0074 4장 · F2 · F3).
 *
 * **이 화면이 존재하는 이유가 이 상자다.** 판매자가 부담 구조를 모르고 쿠폰을 뿌리는
 * 일이 실제로 흔하고(R1), 그래서 「정산에서 차감됩니다」와 **지금 입력한 값으로 계산한
 * 숫자**가 발행 버튼보다 위에 있다. 아래로 내리면 스크롤 밖으로 나가고, 스크롤 밖의
 * 경고는 읽히지 않는다.
 *
 * **`aria-live` 를 늘 마운트해 둔다.** 숫자가 바뀔 때 *알려지려면* 살아 있는 영역이
 * 먼저 있어야 한다 — 말할 것이 생긴 순간 DOM 에 추가된 라이브 영역은 브라우저마다
 * 다르게 읽히고, 대개 읽히지 않는다 (`store-profile-fields.tsx` 가 같은 이유로 같은
 * 모양이다).
 *
 * **경계가 없을 때 숫자를 적지 않는다.** 상한 없는 정률 쿠폰의 최대 부담은 큰 수가
 * 아니라 없는 수이고, 0원이나 「—」 를 적으면 그것이 곧 「이만큼만 나가겠구나」가
 * 된다. 판정은 `estimateCouponLiability` 가 하고 여기서는 그리기만 한다.
 */
export function CouponLiabilityNotice({
  liability,
  messages,
}: {
  readonly liability: CouponLiability
  readonly messages: CouponWarningMessages
}) {
  return (
    <div className="border-warning bg-warning-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm">
      <p className="font-medium">
        {/* 글자 하나짜리 그림. 보조 기술에는 「경고 기호」가 아니라 옆의 문장이 읽혀야 한다. */}
        <span aria-hidden="true">⚠ </span>
        {messages.title}
      </p>
      <p className="text-fg-muted">{messages.body}</p>
      <p aria-live="polite">{sentenceOf(liability, messages)}</p>
    </div>
  )
}

/** 세 갈래에 각각 다른 문장. 접으면 「모름」과 「경계 없음」이 같은 말이 된다. */
function sentenceOf(liability: CouponLiability, messages: CouponWarningMessages): string {
  if (liability.kind === 'unknown') return messages.unknown
  if (liability.kind === 'unbounded') return messages.unbounded[liability.reason]

  return `${messages.estimateLabel}: ${messages.estimate
    .replace('{count}', count(liability.issueLimit))
    .replace('{perVoucher}', money(liability.perVoucher))
    .replace('{total}', money(liability.total))}`
}
