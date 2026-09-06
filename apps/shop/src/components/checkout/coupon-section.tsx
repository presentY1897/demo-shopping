'use client'

import type { ApplicableCoupon } from '@shopping/shared'
import { Button } from '@shopping/ui/components'
import { formatDate, formatMoney } from '@shopping/ui/format'

import { isChoosable } from '@/lib/checkout/coupon-selection'
import type { CheckoutCouponsState } from '@/lib/checkout/use-checkout'
import type { CheckoutCouponMessages } from '@/messages'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

export interface CouponSectionProps {
  readonly coupons: CheckoutCouponsState
  /** 지금 고른 장들. 체크가 켜지는 근거이자 다음 요청의 쿼리다. */
  readonly selection: readonly string[]
  /** 서버가 **실제로** 깎아 준 금액. `checkout.totalCouponDiscountAmount` 다. */
  readonly discount: number
  /** 그중 몇 장이 적용됐나. `checkout.appliedCoupons` 의 길이. */
  readonly appliedCount: number
  readonly repricing: boolean
  readonly rejected: boolean
  readonly messages: CheckoutCouponMessages
  readonly onChoose: (userCouponId: string) => void
  readonly onRecommend: () => void
}

/**
 * 쿠폰 (TASK-0075).
 *
 * **못 쓰는 쿠폰을 숨기지 않는다** (F2 · 계약의 `couponApplicabilityFaults`).
 * 목록에서 빼면 「분명히 쿠폰이 있었는데 없어졌다」가 되고, 그 사람이 다음에 할
 * 일을 화면이 말해 줄 수 없다. 그래서 보여 주되 고르지 못하게 하고 **이유를 그
 * 옆에 적는다** — 결제수단이 정지된 카드를 다루는 방식과 같고(TASK-0023 4장),
 * 여기서 이유가 여섯 가지인 것은 사람이 할 일이 여섯 가지로 다르기 때문이다:
 * 더 담으면 되는 사람과, 다음 달을 기다리면 되는 사람과, 무엇을 해도 안 되는
 * 사람에게 같은 문장을 보이면 계약이 여섯으로 나눈 일이 화면에서 다시 하나로
 * 뭉개진다.
 *
 * **깎이는 금액을 화면이 세지 않는다.** 줄마다 적힌 것은 서버가 답한
 * `discountAmount` 이고, 고른 뒤의 합계도 서버가 다시 매긴 주문서에서 온다 —
 * 브라우저에서 세면 「보여 준 금액과 결제되는 금액이 다르다」가 되는 날이 오고,
 * 그날 어느 쪽이 맞는지는 아무도 말할 수 없다. 「최대 할인 적용」이 조합을
 * 계산하지 않고 `recommendation.userCouponIds` 를 그대로 고르는 것도 같은 이유다.
 *
 * **중복 규칙은 여기 없다.** 두 번째 플랫폼 쿠폰이 첫 번째를 밀어내는 일은
 * `coupon-selection.ts` 가 정하고, 이 컴포넌트는 그 결과를 체크로 그린다 —
 * 규칙이 화면 안에 있으면 그것을 검사하려고 매번 렌더러를 세워야 한다.
 *
 * **라디오가 아니라 체크박스다.** 한 장만 고르는 것이 아니라 자리마다 한 장이라
 * (플랫폼 하나 + 판매자마다 하나) 여러 개가 동시에 켜지고, 고른 것을 **끄는**
 * 일도 있어야 한다. 라디오는 그 둘 다 못 한다.
 */
export function CouponSection({
  coupons,
  selection,
  discount,
  appliedCount,
  repricing,
  rejected,
  messages,
  onChoose,
  onRecommend,
}: CouponSectionProps) {
  return (
    <section aria-label={messages.title} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.title}</h2>

      {coupons.status === 'loading' ? (
        <p className="text-fg-muted text-sm">{messages.loading}</p>
      ) : null}

      {/*
        쿠폰함을 못 읽었다고 주문서를 오류 화면으로 바꾸지 않는다 — 배송지·카드와
        같은 판단이고(`use-address-book.ts`), 문장이 「쿠폰 없이 주문할 수 있어요」로
        끝나는 것이 그 판단의 사용자 쪽 얼굴이다.
      */}
      {coupons.status === 'failed' ? (
        <p className="text-fg-muted text-sm">{messages.failed}</p>
      ) : null}

      {coupons.status === 'ready' ? (
        <Choices
          coupons={coupons.coupons}
          messages={messages}
          onChoose={onChoose}
          onRecommend={onRecommend}
          recommended={coupons.recommendation}
          selection={selection}
        />
      ) : null}

      <Status
        appliedCount={appliedCount}
        discount={discount}
        messages={messages}
        rejected={rejected}
        repricing={repricing}
      />
    </section>
  )
}

/** 고를 것이 있는 화면 — 추천 버튼과 목록. */
function Choices({
  coupons,
  selection,
  recommended,
  messages,
  onChoose,
  onRecommend,
}: {
  readonly coupons: readonly ApplicableCoupon[]
  readonly selection: readonly string[]
  readonly recommended: {
    readonly userCouponIds: readonly string[]
    readonly discountAmount: number
  }
  readonly messages: CheckoutCouponMessages
  readonly onChoose: (userCouponId: string) => void
  readonly onRecommend: () => void
}) {
  if (coupons.length === 0) return <p className="text-fg-muted text-sm">{messages.none}</p>

  const usable = coupons.filter((coupon) => isChoosable(coupon))
  const unusable = coupons.filter((coupon) => !isChoosable(coupon))

  return (
    <div className="flex flex-col gap-3">
      {/*
        추천이 비어 있으면 버튼도 없다. 「최대 할인 적용」을 눌러 아무 일도 일어나지
        않는 것은, 쓸 쿠폰이 없다는 사실을 가장 알아보기 어렵게 말하는 방법이다.
      */}
      {recommended.userCouponIds.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onRecommend} size="sm" type="button" variant="outline">
            {messages.recommend}
          </Button>
          <span className="text-fg-subtle text-xs tabular-nums">
            {messages.recommendAmount.replace(
              '{amount}',
              formatMoney({ amount: recommended.discountAmount, currency: CURRENCY }),
            )}
          </span>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        {/*
          `legend` 가 없으면 체크박스들이 「무엇을 고르는 것인지」 없이 접근성
          트리에 놓인다. 화면에는 제목이 이미 있으므로 `sr-only` 다 — 배송지·결제수단과
          같은 모양이다.
        */}
        <legend className="sr-only">{messages.choose}</legend>

        {usable.map((coupon) => (
          <Choice
            chosen={selection.includes(coupon.userCoupon.id)}
            coupon={coupon}
            key={coupon.userCoupon.id}
            messages={messages}
            onChoose={onChoose}
          />
        ))}

        {unusable.length === 0 ? null : (
          <>
            <p className="text-fg-subtle pt-1 text-xs font-medium">{messages.unusableTitle}</p>
            {unusable.map((coupon) => (
              <Choice
                chosen={false}
                coupon={coupon}
                key={coupon.userCoupon.id}
                messages={messages}
                onChoose={onChoose}
              />
            ))}
          </>
        )}
      </fieldset>
    </div>
  )
}

/**
 * 쿠폰 한 줄.
 *
 * 쓸 수 있는 것과 없는 것이 **같은 모양**인 이유는 둘 다 이 사람이 가진 쿠폰이기
 * 때문이다. 다른 것은 체크할 수 있는지와 마지막 줄에 무엇이 적히는지뿐이다 —
 * 못 쓰는 쿠폰을 다른 모양으로 그리면 그것이 쿠폰이 아닌 무엇처럼 보인다.
 */
function Choice({
  coupon,
  chosen,
  messages,
  onChoose,
}: {
  readonly coupon: ApplicableCoupon
  readonly chosen: boolean
  readonly messages: CheckoutCouponMessages
  readonly onChoose: (userCouponId: string) => void
}) {
  const { userCoupon, fault } = coupon
  const usable = fault === null

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        checked={chosen}
        className="accent-accent mt-1 size-4"
        disabled={!usable}
        name="checkout-coupon"
        onChange={() => {
          onChoose(userCoupon.id)
        }}
        type="checkbox"
        value={userCoupon.id}
      />
      <span className="min-w-0">
        <span className={usable ? 'text-fg block font-medium' : 'text-fg-muted block'}>
          {userCoupon.coupon.name}
        </span>
        {usable ? (
          <span className="text-fg-subtle block tabular-nums">
            {messages.discount.replace(
              '{amount}',
              formatMoney({ amount: coupon.discountAmount, currency: CURRENCY }),
            )}
            {' · '}
            {messages.expiresAt.replace(
              '{date}',
              formatDate(userCoupon.expiresAt, {
                locale: LOCALE,
                style: 'date',
                timeZone: TIME_ZONE,
              }),
            )}
          </span>
        ) : (
          // 사유가 곧 다음에 할 일이다. 「사용할 수 없는 쿠폰입니다」 하나로 답하는
          // 화면은 더 담으면 되는 사람과 기다리면 되는 사람 모두에게 틀린 말을 한다.
          <span className="text-fg-muted block">{messages.faults[fault]}</span>
        )}
      </span>
    </label>
  )
}

/**
 * 지금 어떤 상태인가 — 한 줄로.
 *
 * **영역이 늘 있고 문장만 바뀐다.** 실패했을 때 비로소 나타나는 `aria-live` 는
 * 브라우저가 구독할 시점에 이미 내용이 들어 있어서 읽히지 않는 일이 잦다
 * (`payment-section.tsx` 의 `Result` 와 같은 이유).
 *
 * 순서가 곧 우선순위다. 다시 계산하는 중이면 그것이 지금 유일하게 참인 사실이고,
 * 되돌린 직후라면 그 사실이 합계보다 먼저 알려져야 한다 — 합계는 화면에 그대로
 * 남아 있지만 「왜 내가 고른 것이 풀렸는가」는 이 줄에만 있다.
 */
function Status({
  repricing,
  rejected,
  appliedCount,
  discount,
  messages,
}: {
  readonly repricing: boolean
  readonly rejected: boolean
  readonly appliedCount: number
  readonly discount: number
  readonly messages: CheckoutCouponMessages
}) {
  return (
    <p
      aria-live="polite"
      className={rejected ? 'text-danger pt-2 text-sm' : 'text-fg-muted pt-2 text-sm'}
    >
      {sentenceOf({ appliedCount, discount, messages, rejected, repricing })}
    </p>
  )
}

function sentenceOf({
  repricing,
  rejected,
  appliedCount,
  discount,
  messages,
}: {
  readonly repricing: boolean
  readonly rejected: boolean
  readonly appliedCount: number
  readonly discount: number
  readonly messages: CheckoutCouponMessages
}): string {
  if (repricing) return messages.repricing
  if (rejected) return messages.rejected
  if (appliedCount === 0) return ''

  return messages.applied
    .replace('{count}', String(appliedCount))
    .replace('{amount}', formatMoney({ amount: discount, currency: CURRENCY }))
}
