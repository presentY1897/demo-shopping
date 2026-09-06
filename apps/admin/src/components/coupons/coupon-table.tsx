'use client'

import type { CouponListEntry, CouponLifecycle } from '@shopping/shared'
import type { BadgeVariant, TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { couponCount, couponDate, couponMoney } from '@/lib/coupons/format'
import { mayBulkIssue, usageRate } from '@/lib/coupons/platform-coupons'
import type { PlatformCouponMessages } from '@/messages'

/**
 * 발행한 쿠폰들 — 한 줄에 **정책과 현황과 상태**가 함께 선다.
 *
 * **이름이 행 머리다.** `Table` 이 첫 열을 고정한 채 나머지를 옆으로 굴리므로
 * (TASK-0016 4장), 그 칸이 스크롤 밖으로 나가면 그 행이 무엇에 대한 행인지 알 수
 * 없게 된다 — 숫자만 남은 줄에서 「240 / 1,000장」은 아무것도 말하지 않는다.
 *
 * **부담과 대상을 색이 아니라 문장으로 말한다** (F2 · F7). 「플랫폼 부담」은 모든
 * 줄에 붙는다 — 이 목록에 플랫폼 쿠폰만 있으므로 한 번만 적으면 될 것 같지만, 그
 * 사실을 아는 사람은 이미 아는 사람이고 이 화면은 **정산에서 판매자에게 차감되지
 * 않는다**는 것을 처음 보는 사람에게 말해야 한다. 「체험용」은 그 옆에 서는 다른
 * 종류의 사실이다: 방문자의 관리자가 낸 쿠폰이라 체험 계정에게만 나간다 (D-224).
 *
 * **못 누르는 자리에는 버튼 대신 문장이 선다.** 회색 버튼은 키보드가 건너뛰므로
 * 「왜 못 누르는지」가 읽히지 않는다 (TASK-0063 4.1 · 이 콘솔의 다른 자리와 같은 규칙).
 * 여기서 그 판단은 계정이 아니라 **줄 자신이 들고 있는 상태**라 화면이 답할 수 있다 —
 * 권한에 대한 질문이었다면 눌러 보기 전에는 답할 수 없었을 것이다.
 *
 * 그 자리가 둘이고 문장도 둘이다. 끝난 쿠폰은 아무것도 할 수 없고(발급된 장은 그대로
 * 유효하다), **중단된 쿠폰은 지급만** 못 한다 — 재개하면 이어서 나가므로 그 버튼은
 * 남아 있어야 하고, 옆의 문장이 다음에 할 일을 가리킨다.
 */

export interface CouponTableProps {
  readonly rows: readonly CouponListEntry[]
  readonly caption: string
  readonly messages: PlatformCouponMessages
  /** 지금 서버의 답을 기다리는 쿠폰. 그 줄의 버튼만 잠긴다 (U3). */
  readonly pendingId: string | null
  readonly onToggleSuspended: (entry: CouponListEntry) => void
  readonly onBulkIssue: (entry: CouponListEntry) => void
}

/** 상태마다 뱃지의 색. 색은 문장을 거들 뿐이고, 문장은 언제나 함께 있다. */
const LIFECYCLE_VARIANTS: Readonly<Record<CouponLifecycle, BadgeVariant>> = {
  ENDED: 'neutral',
  SUSPENDED: 'warning',
  SCHEDULED: 'primary',
  EXHAUSTED: 'neutral',
  ACTIVE: 'success',
}

export function CouponTable({
  rows,
  caption,
  messages,
  pendingId,
  onToggleSuspended,
  onBulkIssue,
}: CouponTableProps) {
  const { list } = messages
  const { columns: headers, values } = list

  const columns: readonly TableColumn<CouponListEntry>[] = [
    {
      key: 'name',
      header: headers.name,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{row.coupon.name}</span>
          {/* 코드가 없는 쿠폰은 지급으로만 나간다. 빈칸으로 두면 코드가 있는데 화면이
              못 그린 것처럼 읽힌다. */}
          <span className="text-fg-subtle text-xs">
            {row.coupon.code === null
              ? values.noCode
              : values.code.replace('{code}', row.coupon.code)}
          </span>
        </span>
      ),
    },
    {
      key: 'burden',
      header: headers.burden,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant="primary">{messages.burden.badge}</Badge>
          {row.coupon.audience === 'DEMO' ? (
            <Badge variant="warning">{messages.audienceLabels.DEMO}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'discount',
      header: headers.discount,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{discountOf(row, messages)}</span>
          {row.coupon.minOrderAmount === 0 ? null : (
            <span className="text-fg-subtle text-xs">
              {values.minimum.replace('{amount}', couponMoney(row.coupon.minOrderAmount))}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'period',
      header: headers.period,
      cell: (row) =>
        values.period
          .replace('{from}', couponDate(row.coupon.validFrom))
          .replace('{until}', couponDate(row.coupon.validUntil)),
    },
    {
      key: 'issued',
      header: headers.issued,
      numeric: true,
      cell: (row) =>
        row.coupon.issueLimit === null
          ? values.issuedUnlimited.replace('{issued}', couponCount(row.coupon.issuedCount))
          : values.issued
              .replace('{issued}', couponCount(row.coupon.issuedCount))
              .replace('{limit}', couponCount(row.coupon.issueLimit)),
    },
    {
      key: 'used',
      header: headers.used,
      numeric: true,
      // 사용률이 숫자 옆에 붙는다. 「120장」만으로는 그것이 많은지 적은지 알 수 없고,
      // 분모는 같은 줄의 발급 수다.
      cell: (row) =>
        values.used
          .replace('{used}', couponCount(row.stats.usedCount))
          .replace('{rate}', String(usageRate(row))),
    },
    {
      key: 'discountTotal',
      header: headers.discountTotal,
      numeric: true,
      cell: (row) => couponMoney(row.stats.discountTotal),
    },
    {
      key: 'lifecycle',
      header: headers.lifecycle,
      cell: (row) => (
        <Badge variant={LIFECYCLE_VARIANTS[row.lifecycle]}>
          {messages.lifecycleLabels[row.lifecycle]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: headers.actions,
      cell: (row) =>
        row.lifecycle === 'ENDED' ? (
          <span className="text-fg-muted text-xs">{list.actions.ended}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            <Button
              disabled={pendingId === row.coupon.id}
              onClick={() => {
                onToggleSuspended(row)
              }}
              size="sm"
              variant="outline"
            >
              {row.coupon.suspendedAt === null ? list.actions.suspend : list.actions.resume}
            </Button>
            {mayBulkIssue(row.lifecycle) ? (
              <Button
                disabled={pendingId === row.coupon.id}
                onClick={() => {
                  onBulkIssue(row)
                }}
                size="sm"
                variant="ghost"
              >
                {list.actions.bulkIssue}
              </Button>
            ) : (
              <span className="text-fg-muted text-xs">{list.actions.suspendedNoIssue}</span>
            )}
          </span>
        ),
    },
  ]

  return (
    <Table
      caption={caption}
      columns={columns}
      pinFirstColumn
      rowKey={(row) => row.coupon.id}
      rows={rows}
      // 정렬 축은 커서의 첫 칸이다. 화면이 한 페이지만 다시 정렬하면 그것은 정렬처럼
      // 보이기 때문에 정렬이 없는 것보다 나쁘다.
      sort={null}
    />
  )
}

/** `10% · 최대 5,000원` 또는 `3,000원`. 유형이 값의 단위를 정한다. */
function discountOf(entry: CouponListEntry, messages: PlatformCouponMessages): string {
  const { coupon } = entry

  if (coupon.discountType === 'FIXED') return couponMoney(coupon.discountValue)

  const percent = `${String(coupon.discountValue)}%`

  return coupon.maxDiscountAmount === null
    ? percent
    : `${percent} · ${messages.list.values.ceiling.replace('{amount}', couponMoney(coupon.maxDiscountAmount))}`
}
