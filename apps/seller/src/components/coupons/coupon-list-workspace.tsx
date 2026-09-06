'use client'

import type { ApiFailure, Coupon, CouponLifecycle, CouponListEntry } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Link,
  Pagination,
  Skeleton,
  Table,
  TableToCards,
} from '@shopping/ui/components'
import type { BadgeVariant, TableColumn } from '@shopping/ui/components'
import { useMinWidth } from '@shopping/ui/layout'
import { useCallback, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import {
  canToggleIssuing,
  couponLiabilityTotals,
  isSellerCouponScopeType,
  isSuspended,
} from '@/lib/coupons/coupon-console'
import { useSellerCoupons } from '@/lib/coupons/use-seller-coupons'
import { count, day, money } from '@/lib/orders/format'
import type { CouponVocabularyMessages, Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { CouponFilters } from './coupon-filters'
import { CouponIssueForm } from './coupon-issue-form'

/**
 * `/coupons` — 내 스토어가 부담하는 쿠폰과, 그것이 지금까지 깎은 금액 (TASK-0074).
 *
 * **부담 구조를 세 곳에서 같은 낱말로 말한다** (R1): 머리말의 정산 안내, 목록 위의
 * 부담 누계, 발행 폼 맨 위의 경고. 한 곳에서만 말하면 그 화면을 지나친 사람에게는
 * 아무 말도 하지 않은 것과 같다.
 *
 * **표와 카드 중 하나만 마운트한다** (설계서 「모바일 전용 UI 패턴」). 미디어 쿼리로
 * 둘 다 그리면 DOM 이 두 배가 되고 접근성 트리도 중복된다 — 열의 정의는 **한 벌**이라
 * 두 모양이 다른 것을 보여 줄 수 없다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목·정산 링크·필터는 이 경계의 바깥에서
 * 만들어져 나가고, 그것이 이 화면에 네 상태가 있는 이유다 (P5 · U1).
 */
export interface CouponListWorkspaceProps {
  readonly title: string
  readonly messages?: Messages
}

/** 데스크톱과 모바일을 가르는 폭. 클레임·주문 목록과 같은 지점이다. */
const TABLE_MIN_WIDTH = 768

/** 정산 화면. M12 가 채우고, 지금은 사이드바와 같은 자리를 가리킨다. */
const SETTLEMENT_HREF = '/settlements'

/** 입점 신청. 스토어가 없는 계정이 여기서 할 수 있는 유일한 다음 걸음이다. */
const APPLY_HREF = '/apply'

export function CouponListWorkspace({ title, messages = messagesFor() }: CouponListWorkspaceProps) {
  const { state } = useAuth()
  const copy = messages.couponList
  const sellerId = state.status === 'signedIn' ? state.user.sellerId : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-fg text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">{copy.description}</p>

        {/*
          **정산 연결 자리** (TASK-0074 5장 5항). 링크와 문장뿐이다 — 언제 얼마가
          차감되는지는 정산(M12)이 소유하는 사실이고, 여기서 설명하면 그쪽이 규칙을
          정하는 날 두 화면이 다른 말을 하게 된다.
        */}
        <div className="border-border bg-surface-muted text-fg flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
          <span className="font-medium">{copy.settlement.title}</span>
          <span className="text-fg-muted">{copy.settlement.body}</span>
          <Link href={SETTLEMENT_HREF}>{copy.settlement.linkLabel}</Link>
        </div>
      </header>

      {/*
        세션을 아직 모른다. 「스토어가 없다」와 **같은 화면을 보여 주면 안 되는** 상태다 —
        묻지도 않고 입점 신청을 권하는 셈이 된다.
      */}
      {state.status === 'checking' ? <Skeleton label={copy.loadingLabel} shape="text" /> : null}

      {/*
        스토어가 없는 계정 (F6 의 반대편). 목록을 **부르지도 않는다** — `sellerId` 없이
        부르면 서버는 그것을 플랫폼 쿠폰 목록으로 읽고 403 을 돌려주므로, 아직 신청하지
        않았을 뿐인 사람이 「권한이 없어요」를 보게 된다.
      */}
      {state.status !== 'checking' && sellerId === null ? (
        <EmptyState
          action={<Link href={APPLY_HREF}>{copy.noStore.applyLabel}</Link>}
          description={copy.noStore.body}
          title={copy.noStore.title}
        />
      ) : null}

      {sellerId === null ? null : <CouponConsole messages={messages} sellerId={sellerId} />}
    </div>
  )
}

/** 마지막 쓰기가 남긴 한 줄. 성공은 알림이고 실패는 경고다. */
type Notice =
  | { readonly kind: 'none' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string }

/**
 * 목록과 발행 폼, 그리고 그 둘이 함께 쓰는 저장소.
 *
 * `sellerId` 가 있는 것이 확실해진 뒤에 마운트된다. 훅 안에서 세션을 읽으면 「스토어가
 * 없을 때는 부르지 않는다」를 훅이 알아야 하고, 그러면 부르지 않는 이유가 훅과 화면
 * 두 곳에 적히게 된다.
 */
function CouponConsole({
  sellerId,
  messages,
}: {
  readonly sellerId: string
  readonly messages: Messages
}) {
  const copy = messages.couponList
  const vocabulary = messages.coupons
  const coupons = useSellerCoupons(sellerId)
  const wide = useMinWidth(TABLE_MIN_WIDTH)

  const [issuing, setIssuing] = useState(false)
  const [notice, setNotice] = useState<Notice>({ kind: 'none' })

  const { state, pagination } = coupons
  const items = state.status === 'ready' ? state.items : []
  const totals = couponLiabilityTotals(items)

  const describe = useCallback(
    (failure: ApiFailure) =>
      failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures }),
    [messages],
  )

  /**
   * 발행 중단·재개.
   *
   * 확인 대화상자를 세우지 않는다. 되돌릴 수 있는 걸음이고(같은 버튼이 되돌린다),
   * 이미 나간 장에는 아무 일도 일어나지 않는다 — 확인을 묻는 것은 **되돌릴 수 없는
   * 일**에 하는 것이고, 아무 데나 붙이면 진짜 물어야 할 자리에서 읽히지 않는다.
   */
  const toggleIssuing = useCallback(
    async (entry: CouponListEntry) => {
      const suspend = !isSuspended(entry.coupon)
      const result = await coupons.setSuspended(entry.coupon.id, suspend)

      setNotice(
        result.ok
          ? {
              kind: 'done',
              text: (suspend ? copy.issuing.suspendedNotice : copy.issuing.resumedNotice).replace(
                '{name}',
                entry.coupon.name,
              ),
            }
          : { kind: 'failed', text: describe(result.failure) },
      )
    },
    [copy.issuing, coupons, describe],
  )

  const onIssued = useCallback(
    (coupon: Coupon) => {
      setIssuing(false)
      setNotice({
        kind: 'done',
        text:
          coupon.code === null
            ? messages.couponForm.issuedNotice.replace('{name}', coupon.name)
            : messages.couponForm.issuedWithCode
                .replace('{name}', coupon.name)
                .replace('{code}', coupon.code),
      })
    },
    [messages.couponForm],
  )

  const columns: readonly TableColumn<CouponListEntry>[] = [
    {
      key: 'name',
      header: copy.table.name,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.coupon.name}</span>
          {row.coupon.code === null ? null : (
            <span className="text-fg-muted text-xs">
              {copy.table.code.replace('{code}', row.coupon.code)}
            </span>
          )}
          {row.coupon.minOrderAmount > 0 ? (
            <span className="text-fg-subtle text-xs">
              {copy.table.minOrder.replace('{amount}', money(row.coupon.minOrderAmount))}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'lifecycle',
      header: copy.table.lifecycle,
      /*
       * **상태를 색만으로 말하지 않는다.** 붉거나 노란 점은 색을 구분하지 못하는
       * 사람에게 아무것도 아니고 흑백 인쇄에서는 사라진다. 배지가 **문장을 들고**
       * 있고 색은 그것을 거들 뿐이다 (설계서 접근성 규칙).
       */
      cell: (row) => (
        <Badge variant={BADGE_VARIANTS[row.lifecycle]}>
          {vocabulary.lifecycleLabels[row.lifecycle]}
        </Badge>
      ),
    },
    {
      key: 'discount',
      header: copy.table.discount,
      cell: (row) => discountLabelOf(row.coupon, vocabulary),
    },
    {
      key: 'scope',
      header: copy.table.scope,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{scopeLabelOf(row.coupon, vocabulary)}</span>
          {row.coupon.scopeType === 'PRODUCT' ? (
            <span className="text-fg-muted text-xs">
              {copy.table.scopeProducts.replace('{count}', String(row.coupon.scopeIds.length))}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'period',
      header: copy.table.period,
      cell: (row) =>
        copy.table.periodRange
          .replace('{from}', day(row.coupon.validFrom))
          .replace('{until}', day(row.coupon.validUntil)),
    },
    {
      key: 'issued',
      header: copy.table.issued,
      cell: (row) => (
        <span className="flex flex-col">
          <span>
            {row.coupon.issueLimit === null
              ? copy.table.issuedUnlimited.replace('{issued}', count(row.coupon.issuedCount))
              : copy.table.issuedOfLimit
                  .replace('{issued}', count(row.coupon.issuedCount))
                  .replace('{limit}', count(row.coupon.issueLimit))}
          </span>
          <span className="text-fg-muted text-xs">
            {copy.table.usedCount.replace('{count}', count(row.stats.usedCount))}
          </span>
        </span>
      ),
    },
    {
      key: 'liability',
      header: copy.table.liability,
      // **이 줄이 판매자에게서 나간 돈이다** (F5). `stats.discountTotal` 은 「이 쿠폰이
      // 지금까지 깎은 금액」이고, 판매자 쿠폰에서 그것은 곧 정산에서 빠지는 금액이다.
      cell: (row) => money(row.stats.discountTotal),
    },
    {
      key: 'actions',
      header: copy.table.actions,
      cell: (row) =>
        canToggleIssuing(row.lifecycle) ? (
          <Button
            loading={coupons.pendingId === row.coupon.id}
            onClick={() => {
              void toggleIssuing(row)
            }}
            size="sm"
            variant="outline"
          >
            {isSuspended(row.coupon) ? copy.issuing.resumeLabel : copy.issuing.suspendLabel}
          </Button>
        ) : (
          <span className="text-fg-muted text-sm">{copy.issuing.ended}</span>
        ),
    },
  ]

  const rows = (
    <>
      {wide ? (
        <Table
          caption={copy.table.caption}
          columns={columns}
          rowKey={(row) => row.coupon.id}
          rows={items}
          stickyHeader
        />
      ) : (
        <TableToCards
          caption={copy.table.caption}
          columns={columns}
          rowKey={(row) => row.coupon.id}
          rows={items}
          titleKey="name"
        />
      )}
      <Pagination
        hasNext={pagination.hasNext}
        hasPrevious={pagination.hasPrevious}
        label={copy.pagination.label}
        nextLabel={copy.pagination.next}
        onNext={pagination.goNext}
        onPrevious={pagination.goPrevious}
        previousLabel={copy.pagination.previous}
        status={copy.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
      />
    </>
  )

  return (
    <>
      {/*
        부담 누계 (F5). 목록 위에 있는 이유는 **줄을 하나씩 읽기 전에** 얼마가 나갔는지
        보이게 하기 위해서다. 「이 페이지의 합계」라고 적어 두는 것은 계약에 발행자별
        누계가 없기 때문이고, 없는 것을 「전체」라고 부르면 두 번째 페이지에서 숫자가
        줄어든다.
      */}
      <section
        aria-label={copy.liability.title}
        className="border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border p-3"
      >
        <h2 className="text-fg-muted text-sm">{copy.liability.title}</h2>
        <p className="text-fg text-xl font-bold">
          {copy.liability.total.replace('{amount}', money(totals.discountTotal))}
        </p>
        <p className="text-fg-muted text-sm">
          {copy.liability.used.replace('{count}', count(totals.usedCount))}
        </p>
        <p className="text-fg-subtle w-full text-xs">{copy.liability.note}</p>
      </section>

      <div className="flex flex-col gap-3">
        <div>
          <Button
            aria-expanded={issuing}
            onClick={() => {
              setIssuing((open) => !open)
            }}
            type="button"
            variant={issuing ? 'ghost' : 'primary'}
          >
            {issuing ? messages.couponForm.closeLabel : messages.couponForm.openLabel}
          </Button>
        </div>

        {issuing ? (
          <CouponIssueForm
            issue={coupons.issue}
            messages={messages}
            onIssued={onIssued}
            sellerId={sellerId}
          />
        ) : null}
      </div>

      {/*
        마지막 쓰기의 결말. 성공은 `status`, 실패는 `alert` — 실패는 사람이 다음에 할
        일을 정해야 하는 소식이라 끼어들어도 되고, 성공은 그렇지 않다.
      */}
      {notice.kind === 'done' ? (
        <p
          className="border-success bg-success-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="status"
        >
          {notice.text}
        </p>
      ) : null}

      {notice.kind === 'failed' ? (
        <p
          className="border-danger bg-danger-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="alert"
        >
          {`${copy.toast.failureTitle} ${notice.text}`}
        </p>
      ) : null}

      <CouponFilters
        disabled={state.status === 'loading'}
        messages={copy}
        onChange={coupons.setFilters}
        value={coupons.filters}
      />

      <DataList
        empty={
          coupons.isFiltered ? (
            <EmptyState
              description={copy.filteredEmpty.description}
              title={copy.filteredEmpty.title}
            />
          ) : (
            <EmptyState description={copy.empty.description} title={copy.empty.title} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={coupons.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        {rows}
      </DataList>

      {/*
        「중단은 회수가 아니다」를 목록 아래에 한 번 더 적는다. 버튼 옆에 붙이면 줄마다
        같은 문장이 반복되고, 보조 기술은 그것을 줄 수만큼 읽는다.
      */}
      <p className="text-fg-subtle text-xs">{copy.issuing.hint}</p>
    </>
  )
}

/**
 * 상태마다의 색.
 *
 * `Record<CouponLifecycle, …>` 이라 계약에 상태가 하나 늘면 여기가 컴파일에서 걸린다 —
 * 색이 없는 배지가 조용히 중립으로 그려지는 것보다 낫다.
 *
 * 강조는 **판매자가 손댈 수 있는 것**에만 준다. 발행 중단은 자기가 멈춰 둔 것이라
 * 경고이고, 소진은 더 낼지 정해야 하는 것이라 주의다. 종료는 아무것도 할 수 없으므로
 * 중립이다 — 셋 다 강조하면 아무것도 강조되지 않는다.
 */
const BADGE_VARIANTS: Readonly<Record<CouponLifecycle, BadgeVariant>> = {
  ENDED: 'neutral',
  SUSPENDED: 'warning',
  SCHEDULED: 'neutral',
  EXHAUSTED: 'warning',
  ACTIVE: 'success',
}

/** 「5,000원」 · 「10%」 · 「10% (최대 3,000원)」. 상한이 없다는 사실도 드러난다. */
function discountLabelOf(coupon: Coupon, vocabulary: CouponVocabularyMessages): string {
  if (coupon.discountType === 'FIXED') {
    return vocabulary.discountFixed.replace('{amount}', money(coupon.discountValue))
  }

  const percent = String(coupon.discountValue)

  return coupon.maxDiscountAmount === null
    ? vocabulary.discountPercent.replace('{percent}', percent)
    : vocabulary.discountPercentCapped
        .replace('{percent}', percent)
        .replace('{cap}', money(coupon.maxDiscountAmount))
}

/**
 * 범위의 이름.
 *
 * 계약의 유니온에는 넷이 있고 이 카탈로그에는 **둘만** 있다 (F1). 판매자 쿠폰이
 * 전체·카테고리를 가질 수 없는 것이 서버와 DB 가 함께 지키는 성질이지만, 그래도
 * 화면이 읽지 못하는 값을 만나면 침묵하는 대신 계약의 값을 그대로 보여 준다 —
 * 빈 칸은 「범위가 없다」로 읽히고, 그것은 어떤 쿠폰에도 참이 아니다.
 */
function scopeLabelOf(coupon: Coupon, vocabulary: CouponVocabularyMessages): string {
  return isSellerCouponScopeType(coupon.scopeType)
    ? vocabulary.scopeTypeLabels[coupon.scopeType]
    : coupon.scopeType
}
