'use client'

import { failureMessage } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Skeleton, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { formatDate, formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import type { CardTransaction } from '@/lib/cards/cards-api'
import { useCardLedger } from '@/lib/cards/use-card-ledger'
import type { IssuedCard } from '@/lib/payment/payment-api'
import type { CardLedgerMessages, MyPageMessages } from '@/messages'

const CURRENCY = 'KRW'

/**
 * 시간대를 넘긴다.
 *
 * 넘기지 않으면 서버는 컨테이너의 시간대(UTC)로, 브라우저는 방문자의 시간대로
 * 찍는다 — 새벽에 일어난 승인이 화면마다 다른 날짜가 되는 흔한 원인이다. 이 화면은
 * 클라이언트 컴포넌트지만 값을 고정해 두는 편이 낫다: 원장은 **대사하는 표**이고,
 * 두 사람이 같은 줄을 보며 다른 날짜를 말하면 대사가 되지 않는다.
 */
const TIME_ZONE = 'Asia/Seoul'
const LOCALE = 'ko-KR'

/**
 * 카드 한 장의 사용 내역 (TASK-0058 F3 · F4).
 *
 * **이 표가 이 화면의 존재 이유다.** 2장이 「환불이 잘 됐는지 잔액으로 확인」이라고
 * 적은 동선이 여기서 끝난다 — 승인이 있고, 그 뒤에 환불이 있고, 각 줄 옆에 그 직후의
 * 잔액이 있어서 「돌아왔다」가 추론이 아니라 **읽기**가 된다.
 *
 * **누적 사용과 사용 가능이 둘 다 있다.** 서버가 주는 것은 `balanceAfter`(그 시점의
 * 사용액) 하나지만, 사람이 「얼마 남았나」로 생각하므로 한도에서 뺀 값을 나란히
 * 놓는다. 목록 카드가 보여 주는 「사용 가능」과 마지막 줄의 그것이 같은 숫자여야
 * 한다는 점이 이 표를 **대사 가능한** 것으로 만든다.
 *
 * **주문 링크는 `orderId` 로 건다** (4.2). 원장 행이 들고 있는 것은 결제 id 지만
 * 서버가 주문번호와 주문 id 를 함께 실어 보내므로, 화면이 결제 id 로 다시 물어보는
 * 왕복이 줄마다 붙지 않는다. 주문이 없는 줄은 링크 대신 문장이다.
 *
 * `Table` 인 이유는 가로 스크롤이다. 여섯 열은 360px 에 들어가지 않고,
 * `packages/ui` 의 표는 **자기 안에서** 옆으로 스크롤하며 첫 열을 붙들어 둔다 —
 * 페이지 자체가 옆으로 밀리지 않는다는 것이 F7 이 재는 것 중 하나다.
 */
export function CardLedger({
  card,
  copy,
  messages,
  headingId,
}: {
  readonly card: IssuedCard
  readonly copy: CardLedgerMessages
  readonly messages: MyPageMessages
  /** 이 영역의 제목 id. 카드의 「사용 내역」 버튼이 `aria-controls` 로 가리킨다. */
  readonly headingId: string
}) {
  const ledger = useCardLedger(card.id)
  const rows = ledger.state.status === 'ready' ? ledger.state.rows : []
  const title = copy.title.replace('{brand}', card.brand)

  const columns: readonly TableColumn<CardTransaction>[] = [
    {
      key: 'at',
      header: copy.atColumn,
      cell: (row) =>
        formatDate(row.createdAt, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE }),
    },
    { key: 'kind', header: copy.kindColumn, cell: (row) => copy.kinds[row.kind] },
    {
      key: 'amount',
      header: copy.amountColumn,
      numeric: true,
      // 부호가 정보다. `formatMoney` 가 음수를 「-₩150,000」으로 내므로 방향이
      // 글자에 남고, 승인과 환불이 같은 열에서 서로 다른 사건으로 읽힌다.
      cell: (row) => formatMoney({ amount: row.amount, currency: CURRENCY }),
    },
    {
      key: 'used',
      header: copy.usedColumn,
      numeric: true,
      cell: (row) => formatMoney({ amount: row.balanceAfter, currency: CURRENCY }),
    },
    {
      key: 'available',
      header: copy.availableColumn,
      numeric: true,
      // 서버가 주지 않는 열이다. 한도에서 뺀 값이고, 목록 카드의 「사용 가능」과
      // 같은 뺄셈이라(`availableCredit`) 마지막 줄과 카드가 같은 숫자를 보인다.
      cell: (row) =>
        formatMoney({ amount: card.creditLimit - row.balanceAfter, currency: CURRENCY }),
    },
    {
      key: 'order',
      header: copy.orderColumn,
      cell: (row) => <OrderCell copy={copy} row={row} />,
    },
  ]

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 pt-2">
      {/*
        `h3` 다. 위에 카드의 `h2` 가 있고 그 위에 화면의 `h1` 이 있으므로 단계가
        비지 않는다 — 건너뛴 제목 단계는 axe `heading-order` 가 잡는 실제 결함이다.
      */}
      <h3 className="text-fg text-sm font-semibold" id={headingId}>
        {title}
      </h3>

      <DataList
        empty={<EmptyState description={copy.emptyBody} title={copy.emptyTitle} />}
        error={
          <ErrorState
            description={
              ledger.state.status === 'error'
                ? failureMessage(ledger.state.failure, messages)
                : undefined
            }
            onRetry={ledger.reload}
            retryLabel={copy.retryLabel}
            title={copy.failedTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={stateOf(ledger.state.status, rows.length)}
      >
        <Table
          caption={`${title} — ${copy.caption}`}
          captionHidden
          columns={columns}
          rowKey={(row) => row.id}
          rows={rows}
        />
      </DataList>
    </section>
  )
}

/**
 * 「이 결제가 이 주문」 (4장).
 *
 * `/mypage/orders/[id]` 는 `docs/design/pages.md` 가 이미 소유한 주소이고 M09 가
 * 그 화면을 만든다. **그때까지 이 링크는 갈 곳이 없다** — 그것을 알면서도 거는
 * 이유는, 이 줄이 그 주문을 가리킬 수 있는 유일한 자리이기 때문이다. 결제 화면의
 * 「카드 발급받기」가 `/mypage` 로 가는 것과 다른 판단인데(TASK-0050 4.6), 거기서
 * 목적지는 「카드를 만들 수 있는 어딘가」라 마이페이지가 실제로 그 일을 하고, 여기서
 * 목적지는 **이 주문 하나**라 대신할 주소가 없다.
 *
 * 접근성 이름에 주문번호를 넣는다. 표 안의 링크가 전부 「주문 보기」면 링크 목록을
 * 훑는 사람에게 여섯 개의 같은 이름이 남는다.
 */
function OrderCell({
  row,
  copy,
}: {
  readonly row: CardTransaction
  readonly copy: CardLedgerMessages
}) {
  if (row.orderId === null || row.orderNumber === null) {
    return <span className="text-fg-subtle">{copy.noOrder}</span>
  }

  return (
    <Link
      aria-label={copy.orderLink.replace('{number}', row.orderNumber)}
      className="text-primary underline"
      href={`/mypage/orders/${row.orderId}`}
    >
      {row.orderNumber}
    </Link>
  )
}

/** `DataList` 의 네 상태를, 읽기의 세 상태와 「아무 줄도 없다」에서. */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
