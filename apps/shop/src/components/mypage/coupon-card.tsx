import type { UserCoupon } from '@shopping/shared'
import { Badge } from '@shopping/ui/components'
import { formatDate, formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import { daysUntilExpiry, isExpiringSoon } from '@/lib/coupons/expiring'
import type { CouponBoxMessages } from '@/messages'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
/** 시간대를 고정한다. 넘기지 않으면 서버는 UTC, 브라우저는 방문자의 시간대로 찍는다. */
const TIME_ZONE = 'Asia/Seoul'

/**
 * 쿠폰함의 한 장 (TASK-0077 F1 · F2).
 *
 * ## 정책을 다시 묻지 않는다
 *
 * 「가을 쿠폰 · 3,000원 할인 · 9월 30일까지」의 뒤의 둘이 정책에 있고, 계약이 그것을
 * 발급된 장 안에 실어 보낸다(`userCouponSchema.coupon`). 그래서 이 컴포넌트는 왕복
 * 없이 한 줄을 완성한다 — 장마다 한 번씩 더 묻는 목록은 스무 장에서 스무 번 묻는다.
 *
 * ## 만료 임박은 **배지이고 색이다** (F2)
 *
 * 문장만으로는 목록을 훑는 눈에 걸리지 않고, 색만으로는 색을 구분하지 못하는 사람에게
 * 아무 말도 하지 않는다(WCAG 1.4.1). 그래서 남은 날이 적힌 배지이고, 그 배지가
 * `warning` 색을 쓴다 — 두 채널이 같은 사실을 말한다.
 *
 * **지나간 장에는 켜지지 않는다.** 만료 탭의 장에 「곧 만료」를 붙이면 강조가
 * 「서두르세요」가 아니라 「이미 늦었습니다」를 뜻하게 된다 (`isExpiringSoon`).
 *
 * ## 상태마다 마지막 줄이 다르다
 *
 * 쓸 수 있는 장은 **언제까지**인지가, 쓴 장은 **언제 어디에** 썼는지가, 만료된 장은
 * **언제** 사라졌는지가 그 사람이 알고 싶은 것이다. 세 상태에 같은 「9월 30일까지」를
 * 적으면 이미 지난 날짜를 기한처럼 보여 주게 된다.
 */
export function CouponCard({
  coupon,
  copy,
  now,
}: {
  readonly coupon: UserCoupon
  readonly copy: CouponBoxMessages
  /**
   * 「지금」 — 부르는 쪽이 마운트 시점에 한 번 고정한 값이다.
   *
   * 렌더마다 `Date.now()` 를 부르면 목록의 장마다 다른 「지금」으로 남은 날을 세게
   * 되고, 렌더 중에 시계를 읽는 것은 `react-hooks/purity` 가 막는 것이기도 하다.
   */
  readonly now: Date
}) {
  const policy = coupon.coupon
  const expiring = coupon.status === 'ISSUED' && isExpiringSoon(coupon.expiresAt, now)

  return (
    <li className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{copy.issuers[policy.issuerType]}</Badge>
        {/*
          남은 날이 글자에 있고 색이 그 위에 겹친다. 색만으로 말하면 색을 구분하지
          못하는 사람에게 이 강조는 존재하지 않는다 (WCAG 1.4.1).
        */}
        {expiring ? (
          <Badge variant="warning">
            {copy.expiringBadge.replace('{days}', String(daysUntilExpiry(coupon.expiresAt, now)))}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-fg text-base font-semibold">{policy.name}</h3>
        <p className="text-fg text-lg font-bold tabular-nums">{discountOf(coupon, copy)}</p>
      </div>

      <p className="text-fg-muted text-sm tabular-nums">
        {copy.scopes[policy.scopeType]}
        {' · '}
        {policy.minOrderAmount === 0
          ? copy.noMinOrder
          : copy.minOrder.replace(
              '{amount}',
              formatMoney({ amount: policy.minOrderAmount, currency: CURRENCY }),
            )}
      </p>

      <CouponFooter copy={copy} coupon={coupon} />
    </li>
  )
}

/**
 * 「얼마 깎이나」 — 정액과 정률이 다른 문장인 이유는 **단위가 다르기** 때문이다.
 *
 * `FIXED` 의 `discountValue` 는 원이고 `PERCENT` 의 그것은 퍼센트다(계약). 한 문장에
 * `{value}` 를 끼워 넣으면 「10원 할인」과 「3000% 할인」 중 하나가 반드시 나온다.
 *
 * 상한은 **정률에만 붙인다.** 정액의 `maxDiscountAmount` 는 언제나 `null` 이라 뜻이
 * 없고, 있는 것처럼 그리면 없는 조건이 있는 것처럼 보인다.
 */
function discountOf(coupon: UserCoupon, copy: CouponBoxMessages): string {
  const policy = coupon.coupon

  if (policy.discountType === 'FIXED') {
    return copy.discountFixed.replace(
      '{amount}',
      formatMoney({ amount: policy.discountValue, currency: CURRENCY }),
    )
  }

  const percent = copy.discountPercent.replace('{percent}', String(policy.discountValue))

  if (policy.maxDiscountAmount === null) return percent

  const cap = copy.maxDiscount.replace(
    '{amount}',
    formatMoney({ amount: policy.maxDiscountAmount, currency: CURRENCY }),
  )

  return `${percent} · ${cap}`
}

/**
 * 마지막 줄 — 상태가 정한다.
 *
 * 쓴 장이 **주문을 가리키는** 것이 이 갈래의 값어치다. 「이 쿠폰을 어디에 썼더라」는
 * 쿠폰함에 오는 사람이 실제로 묻는 것이고, 계약이 `orderId` 를 그 자리에 싣는다.
 * `null` 인 장이 있을 수 있으므로(상태와 함께 움직이지만 계약이 nullable 이다) 없으면
 * 링크 없는 줄이 된다 — 링크가 없는 줄이지 잘못된 줄이 아니다.
 *
 * 접근성 이름에 쿠폰 이름을 싣는다. 목록의 링크가 전부 「주문 보기」면 링크 목록을
 * 훑는 사람에게 같은 이름이 스무 개 남는다 (WCAG 2.4.4). 보이는 글자가 그 이름 안에
 * 그대로 들어 있으므로 음성 제어도 「주문 보기」로 이 링크를 누를 수 있다 (2.5.3).
 */
function CouponFooter({
  coupon,
  copy,
}: {
  readonly coupon: UserCoupon
  readonly copy: CouponBoxMessages
}) {
  const date = (value: string): string =>
    formatDate(value, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })

  if (coupon.status === 'USED') {
    return (
      <div className="text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {/* 쓴 장에도 만료 시각은 남아 있지만, 그것은 이제 아무 뜻이 없는 날짜다. */}
        <span>{copy.usedAt.replace('{date}', date(coupon.usedAt ?? coupon.expiresAt))}</span>
        {coupon.orderId === null ? null : (
          <Link
            aria-label={copy.usedOrderLink.replace('{name}', coupon.coupon.name)}
            className="text-primary underline"
            href={`/mypage/orders/${coupon.orderId}`}
          >
            {copy.orderLinkText}
          </Link>
        )}
      </div>
    )
  }

  if (coupon.status === 'EXPIRED') {
    return (
      <p className="text-fg-subtle text-sm">
        {copy.expiredAt.replace('{date}', date(coupon.expiresAt))}
      </p>
    )
  }

  return (
    <p className="text-fg-muted text-sm">
      {copy.expiresAt.replace('{date}', date(coupon.expiresAt))}
    </p>
  )
}
