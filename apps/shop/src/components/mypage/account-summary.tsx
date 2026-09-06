'use client'

import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { useAccountSummary } from '@/lib/mypage/use-account-summary'
import type { AccountSummaryMessages } from '@/messages'

const CURRENCY = 'KRW'

/**
 * 마이페이지 머리의 두 숫자 — 적립금 잔액과 쿠폰 수 (TASK-0077).
 *
 * **요약이 하는 일은 「있다」를 말하는 것이다.** 3,200원이 있다는 사실과 쿠폰 세 장이
 * 있다는 사실을 알면 사람은 그 화면으로 간다. 그래서 각 숫자가 곧 링크의 이웃이고,
 * 원장이나 목록은 여기 없다 — 여기서 다 보여 주면 두 화면이 존재할 이유가 없어지고,
 * 그렇다고 조금씩 보여 주면 「전부인가 일부인가」를 아무도 모른다.
 *
 * **적립 예정을 여기서도 말한다** (F6). 이 오해 — 「샀는데 왜 적립이 안 됐지」 — 는
 * 적립금 화면에 들어가야만 풀리면 늦다: 그 사람은 잔액을 보고 이미 그렇게 믿은 뒤다.
 *
 * **쿠폰은 `ISSUED` 만 센다.** 「쿠폰 5장」이 만료된 두 장을 포함하면 그 수는 쓸 수
 * 있는 것의 수가 아니게 되고, 쿠폰함에 들어간 사람은 자기 쿠폰이 줄었다고 읽는다.
 *
 * **둘이 따로 실패한다.** 적립금을 못 읽었다고 쿠폰 수까지 감추면 사람은 자기 쿠폰이
 * 사라졌다고 읽는다 — 그래서 못 읽은 쪽만 문장으로 바뀐다. 0을 그리지 않는 것이
 * 중요한데, 0은 **아는 사실**이고 못 읽은 것은 모르는 것이라 같은 얼굴을 가질 수 없다.
 */
export function AccountSummary({ messages }: { readonly messages: AccountSummaryMessages }) {
  const summary = useAccountSummary()

  return (
    <section aria-labelledby="account-summary-heading" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold" id="account-summary-heading">
        {messages.title}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryFigure
          href="/mypage/points"
          label={messages.pointsLabel}
          link={messages.pointsLink}
        >
          {summary.points.status === 'loading' ? (
            <Waiting label={messages.loadingLabel} />
          ) : summary.points.status === 'error' ? (
            <Unavailable label={messages.unavailable} />
          ) : (
            <>
              <span className="text-fg text-2xl font-bold tabular-nums">
                {formatMoney({
                  amount: summary.points.value.account.balance,
                  currency: CURRENCY,
                })}
              </span>
              {summary.points.value.pendingEarn === 0 ? null : (
                <span className="text-fg-muted text-sm tabular-nums">
                  {messages.pendingLabel.replace(
                    '{amount}',
                    formatMoney({
                      amount: summary.points.value.pendingEarn,
                      currency: CURRENCY,
                    }),
                  )}
                </span>
              )}
            </>
          )}
        </SummaryFigure>

        <SummaryFigure
          href="/mypage/coupons"
          label={messages.couponsLabel}
          link={messages.couponsLink}
        >
          {summary.coupons.status === 'loading' ? (
            <Waiting label={messages.loadingLabel} />
          ) : summary.coupons.status === 'error' ? (
            <Unavailable label={messages.unavailable} />
          ) : (
            <span className="text-fg text-2xl font-bold tabular-nums">
              {messages.couponCount.replace('{count}', String(summary.coupons.value.ISSUED))}
            </span>
          )}
        </SummaryFigure>
      </div>
    </section>
  )
}

/**
 * 숫자 하나와 그 화면으로 가는 링크.
 *
 * `dl`/`dt`/`dd` 로 적지 않는다. 정의 목록의 `div` 안에는 `dt` 와 `dd` 밖에 올 수
 * 없는데(HTML 표준) 이 묶음에는 링크가 하나 더 있고, 그 링크를 `dd` 안에 넣으면 값의
 * 일부가 된다 — 「3,200원 적립금 내역」이 한 값으로 읽힌다. 남는 것은 문단 둘과
 * 링크이고, 그 셋의 관계는 `aria-labelledby` 가 아니라 **눈에 보이는 배치**가 말한다.
 */
function SummaryFigure({
  label,
  link,
  href,
  children,
}: {
  readonly label: string
  readonly link: string
  readonly href: string
  readonly children: ReactNode
}) {
  return (
    <div className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-fg-muted text-sm">{label}</p>
      <div className="flex flex-col gap-1">{children}</div>
      <Link className="text-primary text-sm font-medium underline" href={href}>
        {link}
      </Link>
    </div>
  )
}

/** 아직 오지 않았다. `status` 라 화면을 읽는 사람에게도 기다림이 전해진다. */
function Waiting({ label }: { readonly label: string }) {
  return (
    <span className="text-fg-muted text-sm" role="status">
      {label}
    </span>
  )
}

/** 못 읽었다. 숫자가 아니라 문장인 이유는 이 파일 위쪽 주석에 있다. */
function Unavailable({ label }: { readonly label: string }) {
  return <span className="text-fg-muted text-sm">{label}</span>
}
