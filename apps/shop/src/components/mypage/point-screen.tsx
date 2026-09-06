'use client'

import type { PointLedgerEntry, PointSummaryResponse } from '@shopping/shared'
import { Badge, Button, DataList, EmptyState, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { formatDate, formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import type { PointSummaryState } from '@/lib/points/use-points'
import { usePointScreen } from '@/lib/points/use-points'
import type { MyPageMessages, PointScreenMessages } from '@/messages'

import { AccountLoadFailure, AccountLoading, AccountWriteFailure } from './account-notices'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'

/**
 * 시간대를 넘긴다.
 *
 * 넘기지 않으면 서버는 컨테이너의 시간대(UTC)로, 브라우저는 방문자의 시간대로 찍는다 —
 * 새벽에 일어난 적립이 화면마다 다른 날짜가 되는 흔한 원인이다. 원장은 **대사하는
 * 표**이고, 두 사람이 같은 줄을 보며 다른 날짜를 말하면 대사가 되지 않는다.
 */
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/points` — 적립금 (TASK-0077 F4 · F5 · F6).
 *
 * ## 원장을 그대로 보여 준다 (F4)
 *
 * 잔액만 보여 주는 화면은 「왜 줄었지」에 답할 수 없고, 그 답이 줄마다 붙은
 * `balanceAfter` 다 (4장). 그래서 이 화면은 원장을 요약하지 않는다 — 「9월에 3,000원
 * 적립, 2,000원 사용」으로 묶으면 사슬이 끊기고, 사슬이 끊긴 표는 대사할 수 없다.
 *
 * **R1 이 걱정한 「복잡함」은 두 가지로 갚는다.** 유형을 한국어 라벨로 바꾸고, 증감을
 * 색으로 가른다. 색은 배지의 표면색이고 글자는 그 유형의 이름이라, **색을 구분하지
 * 못하는 사람에게도 같은 사실이 전달된다** (WCAG 1.4.1) — 금액의 부호가 세 번째
 * 채널이다.
 *
 * ## 적립 예정이 이 화면의 요점이다 (F6)
 *
 * 적립은 구매확정 시점에 일어나므로(`pricing.md` 5장) 배송이 끝난 주문은 아직 아무것도
 * 적립하지 않았다. 그 사실을 말해 주지 않으면 사는 사람은 「샀는데 왜 적립이 안 됐지」로
 * 읽고, 그 오해는 원장을 아무리 정확히 그려도 풀리지 않는다 — **원장에 그 행이 없기**
 * 때문이다.
 *
 * ## 만료 예정은 **다시 계산하지 않는다**
 *
 * 서버가 30일 창(`POINT_EXPIRING_SOON_DAYS`)을 이미 적용해 `expiringSoon` 으로 보낸다.
 * 화면이 통을 훑어 다시 세면 그 판정이 두 곳에 살고, 둘이 갈리는 날 어느 쪽이 맞는지
 * 아무도 모른다. 쿠폰의 만료 임박이 화면 계산인 것과 다른데, 그쪽은 계약이 보내 주는
 * 값이 `expiresAt` 뿐이라 그렇다.
 *
 * ## 머리와 원장이 따로 실패한다
 *
 * 원장을 못 읽어도 잔액과 적립 예정은 여전히 참이다. 셋을 한 상태로 묶으면 원장 하나가
 * 실패했을 때 화면 전체가 오류가 되고, 「지금 얼마인가」라는 답할 수 있는 질문까지 답을
 * 잃는다.
 */
export function PointScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.points
  const screen = usePointScreen()

  const columns: readonly TableColumn<PointLedgerEntry>[] = [
    {
      key: 'at',
      header: copy.atColumn,
      cell: (row) =>
        formatDate(row.createdAt, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE }),
    },
    {
      key: 'type',
      header: copy.typeColumn,
      // 유형은 이름이고 색은 방향이다. 방향을 유형에서 추측하지 않고 **부호에서**
      // 읽는 이유는 `ADJUST` 가 양방향이기 때문이다 — 조정을 늘 한 색으로 칠하면
      // 회수와 보상이 같은 얼굴을 갖는다.
      cell: (row) => (
        <Badge variant={row.amount >= 0 ? 'success' : 'danger'}>{copy.types[row.type]}</Badge>
      ),
    },
    {
      key: 'amount',
      header: copy.amountColumn,
      numeric: true,
      // 부호가 정보다. `formatMoney` 가 음수를 「-₩2,000」으로 내므로 방향이 글자에도
      // 남고, 그것이 배지 색과 같은 사실을 말하는 세 번째 채널이다.
      cell: (row) => formatMoney({ amount: row.amount, currency: CURRENCY }),
    },
    {
      key: 'balance',
      header: copy.balanceColumn,
      numeric: true,
      // **이 열이 F4 다.** 이것 없이는 「왜 줄었지」에 답할 수 없다.
      cell: (row) => formatMoney({ amount: row.balanceAfter, currency: CURRENCY }),
    },
    {
      key: 'ref',
      header: copy.refColumn,
      cell: (row) => <RefCell copy={copy} row={row} />,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PointHead copy={copy} messages={messages} onRetry={screen.reload} state={screen.summary} />

      <section aria-labelledby="point-ledger-heading" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold" id="point-ledger-heading">
          {copy.ledgerTitle}
        </h2>

        <DataList
          empty={<EmptyState description={copy.emptyBody} title={copy.emptyTitle} />}
          error={
            screen.ledger.status === 'error' ? (
              <AccountLoadFailure
                failure={screen.ledger.failure}
                messages={messages}
                onRetry={screen.reload}
              />
            ) : null
          }
          loading={<AccountLoading label={copy.loadingLabel} />}
          state={stateOf(screen.ledger.status, screen.entries.length)}
        >
          <p className="text-fg-muted text-sm" role="status">
            {copy.countLabel.replace('{count}', String(screen.entries.length))}
          </p>

          {/*
            `Table` 인 이유는 가로 스크롤이다. 다섯 열은 360px 에 들어가지 않고,
            `packages/ui` 의 표는 **자기 안에서** 옆으로 스크롤한다 — 페이지 자체가
            옆으로 밀리지 않는다는 것이 F7 이 재는 것 중 하나다.
          */}
          <Table
            caption={`${copy.ledgerTitle} — ${copy.caption}`}
            captionHidden
            columns={columns}
            rowKey={(row) => String(row.seq)}
            rows={screen.entries}
          />
        </DataList>

        {screen.loadMoreFailure === null ? null : (
          <AccountWriteFailure
            failure={screen.loadMoreFailure}
            messages={messages}
            title={copy.loadMoreFailedTitle}
          />
        )}

        {screen.hasMore ? (
          <Button
            loading={screen.loadingMore}
            onClick={screen.loadMore}
            type="button"
            variant="outline"
          >
            {screen.loadingMore ? copy.loadingMore : copy.loadMore}
          </Button>
        ) : null}
      </section>
    </div>
  )
}

/**
 * 잔액과, 원장에 **아직 행이 없는 둘**.
 *
 * 적립 예정과 만료 예정은 사건이 아니라 예상이라 원장에 줄이 없고, 그래서 표 위에
 * 따로 선다. 표 안에 섞으면 「아직 일어나지 않은 일」이 `balanceAfter` 를 가진 것처럼
 * 보이고, 그 순간 원장은 대사할 수 없는 것이 된다.
 */
function PointHead({
  state,
  copy,
  messages,
  onRetry,
}: {
  readonly state: PointSummaryState
  readonly copy: PointScreenMessages
  readonly messages: MyPageMessages
  readonly onRetry: () => void
}) {
  if (state.status === 'loading') return <AccountLoading label={copy.loadingLabel} rows={1} />

  if (state.status === 'error') {
    return <AccountLoadFailure failure={state.failure} messages={messages} onRetry={onRetry} />
  }

  const { account, pendingEarn, expiringSoon }: PointSummaryResponse = state.summary

  return (
    <section
      aria-labelledby="point-balance-heading"
      className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-fg-muted text-sm font-medium" id="point-balance-heading">
          {copy.balanceLabel}
        </h2>
        <p className="text-fg text-3xl font-bold tabular-nums">
          {formatMoney({ amount: account.balance, currency: CURRENCY })}
        </p>
      </div>

      {/*
        F6. `role="note"` 이지 `alert` 가 아니다 — 잘못된 일이 일어난 것이 아니라 이
        계정의 사실이고, 매번 사람의 하던 일을 끊고 읽어 줄 소식이 아니다.
      */}
      <div
        className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3"
        role="note"
      >
        <p className="text-fg text-sm font-semibold">
          {copy.pendingTitle}
          {pendingEarn === 0 ? null : (
            <span className="tabular-nums">
              {' '}
              {formatMoney({ amount: pendingEarn, currency: CURRENCY })}
            </span>
          )}
        </p>
        {/*
          0원일 때 「0원이 들어올 예정」이라고 적지 않는다. 그것은 사실이지만 사람이
          찾는 답이 아니고, 「기다리는 주문이 없습니다」가 그 답이다.
        */}
        <p className="text-fg-muted text-sm">
          {pendingEarn === 0 ? copy.pendingNone : copy.pendingBody}
        </p>
      </div>

      {expiringSoon === null ? null : (
        <div
          className="border-warning-surface bg-warning-surface flex flex-col gap-1 rounded-md border p-3"
          role="note"
        >
          <p className="text-fg text-sm font-semibold">{copy.expiringTitle}</p>
          <p className="text-fg text-sm tabular-nums">
            {copy.expiringBody
              .replace('{amount}', formatMoney({ amount: expiringSoon.amount, currency: CURRENCY }))
              .replace(
                '{date}',
                formatDate(expiringSoon.at, {
                  locale: LOCALE,
                  style: 'date',
                  timeZone: TIME_ZONE,
                }),
              )}
          </p>
        </div>
      )}
    </section>
  )
}

/**
 * 「이 줄이 무엇 때문인가」 — 주문이면 링크다 (F5).
 *
 * **`refType` 이 `ORDER` 인 줄만 링크를 갖는다.** 참조는 네 가지이고 나머지 셋은
 * 구매자가 열 수 있는 화면을 가리키지 않는다 — 판매자 몫(`SELLER_ORDER`)과
 * 클레임(`CLAIM_REQUEST`)은 id 만으로는 갈 곳이 정해지지 않고, 만료가 가리키는
 * `POINT_TRANSACTION` 은 이 표 자신이다. 그 셋에 링크를 걸면 눌러도 아무 일이 없거나
 * 404 로 가는 링크가 줄마다 생긴다.
 *
 * 사유가 있는 줄은 그 문장이 곧 답이다. `ADJUST` 에는 반드시 있고(계약), 사람이 고친
 * 줄에서 「왜」를 지우면 그 줄은 아무도 설명할 수 없는 잔액 변동이 된다.
 *
 * 접근성 이름에 시각을 싣는다. 표 안의 링크가 전부 「주문 보기」면 링크 목록을 훑는
 * 사람에게 같은 이름이 여럿 남는다 (WCAG 2.4.4).
 */
function RefCell({
  row,
  copy,
}: {
  readonly row: PointLedgerEntry
  readonly copy: PointScreenMessages
}) {
  if (row.refType === 'ORDER' && row.refId !== null) {
    const at = formatDate(row.createdAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })

    return (
      <Link
        aria-label={copy.orderLink.replace('{at}', at)}
        className="text-primary underline"
        href={`/mypage/orders/${row.refId}`}
      >
        {copy.orderLinkText}
      </Link>
    )
  }

  if (row.reason !== null) return <span className="text-fg-muted">{row.reason}</span>

  return <span className="text-fg-subtle">{copy.noRef}</span>
}

/** `DataList` 의 네 상태를, 읽기의 세 상태와 「아무 줄도 없다」에서. */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
