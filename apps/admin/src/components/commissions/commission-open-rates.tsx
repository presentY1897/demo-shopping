'use client'

import type { CommissionRate } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Table } from '@shopping/ui/components'

import type { CategoryChoice } from '@/lib/attributes/categories'
import { commissionDateTime, commissionPercent } from '@/lib/commissions/format'
import type {
  CategoryScopedRate,
  OpenCommissionRates,
  SellerScopedRate,
} from '@/lib/commissions/scopes'
import { categoryTargetName, sellerTargetName } from '@/lib/commissions/targets'
import type { SellerChoice } from '@/lib/commissions/use-sellers'
import type { CommissionMessages } from '@/messages'

/**
 * 지금 적용되는 요율 — **세 절이 곧 우선순위의 역순**이다 (F1 · F2 · F3).
 *
 * 한 표로 그리면 「이 스토어에는 결국 몇 퍼센트가 붙나」에 화면이 답하지 못한다.
 * 판매자 개별율이 카테고리 기본율을 이기고 카테고리가 전역을 이긴다는 사실은
 * 목록의 **구조**로 서야 읽히고, 그 위의 한 줄이 그 순서를 말로도 적는다.
 *
 * ## 전역이 표가 아닌 이유
 *
 * 많아야 하나이기 때문이다(`CommissionRate_open_global_key`). 한 줄짜리 표는 머리글
 * 넷과 값 넷으로 이루어진, 읽는 데 더 오래 걸리는 문장이다. 그리고 **없을 때가 더
 * 중요하다** — 그 자리에 「0%」가 아니라 「아직 정하지 않았습니다, 지금은 기본
 * 요율 X가 적용됩니다」가 서야 한다. 폴백을 0으로 읽으면 설정을 잊은 플랫폼이
 * 조용히 아무것도 받지 않는 것처럼 보인다.
 */

export interface CommissionOpenRatesProps {
  readonly rates: OpenCommissionRates
  /** 아무 요율도 없을 때 실제로 쓰이는 값. 서버가 함께 보낸다. */
  readonly fallbackRateBp: number
  readonly categories: readonly CategoryChoice[]
  readonly sellers: readonly SellerChoice[]
  readonly messages: CommissionMessages
}

export function CommissionOpenRates({
  rates,
  fallbackRateBp,
  categories,
  sellers,
  messages,
}: CommissionOpenRatesProps) {
  const copy = messages.open

  /** 세 절이 공유하는 뒤쪽 세 칸 — 요율·적용 시작·바꾼 사람. */
  const tail: readonly TableColumn<CommissionRate>[] = [
    {
      key: 'rate',
      header: copy.columns.rate,
      numeric: true,
      cell: (rate) => <span className="font-medium">{commissionPercent(rate.rateBp)}</span>,
    },
    {
      key: 'since',
      header: copy.columns.since,
      cell: (rate) => commissionDateTime(rate.validFrom),
    },
    {
      // 이메일이다. 이력과 같은 값을 같은 칸 이름으로 그린다 (F5).
      key: 'changedBy',
      header: copy.columns.changedBy,
      cell: (rate) => rate.createdBy.email,
    },
  ]

  const categoryColumns: readonly TableColumn<CategoryScopedRate>[] = [
    {
      key: 'target',
      header: copy.columns.target,
      cell: (rate) => categoryTargetName(categories, rate.categoryId, copy),
    },
    ...tail,
  ]

  const sellerColumns: readonly TableColumn<SellerScopedRate>[] = [
    {
      key: 'target',
      header: copy.columns.target,
      cell: (rate) => sellerTargetName(sellers, rate.sellerId, copy),
    },
    ...tail,
  ]

  return (
    <section aria-label={copy.title} className="flex flex-col gap-4">
      <h2 className="text-fg text-base font-medium">{copy.title}</h2>

      <p
        className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm"
        role="note"
      >
        {copy.priorityNotice}
      </p>

      <section aria-label={copy.globalTitle} className="flex flex-col gap-2">
        <h3 className="text-fg text-sm font-medium">{copy.globalTitle}</h3>

        {rates.global === null ? (
          <p className="text-fg-muted text-sm">
            {copy.globalUnset.replace('{rate}', commissionPercent(fallbackRateBp))}
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">{copy.columns.rate}</dt>
            <dd className="text-fg font-medium">{commissionPercent(rates.global.rateBp)}</dd>
            <dt className="text-fg-muted">{copy.columns.since}</dt>
            <dd className="text-fg">{commissionDateTime(rates.global.validFrom)}</dd>
            <dt className="text-fg-muted">{copy.columns.changedBy}</dt>
            <dd className="text-fg">{rates.global.createdBy.email}</dd>
          </dl>
        )}
      </section>

      <section aria-label={copy.categoryTitle} className="flex flex-col gap-2">
        <h3 className="text-fg text-sm font-medium">{copy.categoryTitle}</h3>

        {rates.category.length === 0 ? (
          <p className="text-fg-muted text-sm">{copy.categoryEmpty}</p>
        ) : (
          <Table
            caption={copy.categoryListLabel}
            columns={categoryColumns}
            rowKey={(rate) => rate.id}
            rows={rates.category}
          />
        )}
      </section>

      <section aria-label={copy.sellerTitle} className="flex flex-col gap-2">
        <h3 className="text-fg text-sm font-medium">{copy.sellerTitle}</h3>

        {rates.seller.length === 0 ? (
          <p className="text-fg-muted text-sm">{copy.sellerEmpty}</p>
        ) : (
          <Table
            caption={copy.sellerListLabel}
            columns={sellerColumns}
            rowKey={(rate) => rate.id}
            rows={rates.seller}
          />
        )}
      </section>
    </section>
  )
}
