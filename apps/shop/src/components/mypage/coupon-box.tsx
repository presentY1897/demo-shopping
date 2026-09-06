'use client'

import type { UserCouponStatus } from '@shopping/shared'
import { userCouponStatuses } from '@shopping/shared'
import { Badge, Button, DataList, EmptyState, Tabs } from '@shopping/ui/components'
import Link from 'next/link'
import { useState } from 'react'

import type { CouponBox as CouponBoxConsole } from '@/lib/coupons/use-coupon-box'
import { useCouponBox } from '@/lib/coupons/use-coupon-box'
import type { MyPageMessages } from '@/messages'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountNotice,
  AccountWriteFailure,
} from './account-notices'
import { CouponCard } from './coupon-card'
import { CouponClaimForm } from './coupon-claim-form'

/**
 * `/mypage/coupons` — 쿠폰함 (TASK-0077 F1 · F2 · F3).
 *
 * ## 탭이 곧 서버의 질의다
 *
 * 셋은 화면의 분류가 아니라 `status` 그대로다(계약). 받은 것 위에서 거르는 길도
 * 있었지만, 그러면 커서가 「전부」의 커서가 되어 **탭마다 남은 장이 있는지**를 말할 수
 * 없다 — 주문 내역이 필터를 서버로 옮긴 것과 같은 판단이다(TASK-0063 2장).
 *
 * ## 배지의 수는 탭이 아니라 **계정의 사실**이다
 *
 * `counts` 가 `status` 로 좁혀도 달라지지 않는 것이 계약이고, 그 덕분에 탭 셋이 자기
 * 수를 따로 묻지 않는다. 따로 물었다면 화면 하나가 네 번 묻고, 그 넷은 서로 다른
 * 순간의 답이라 「사용 가능 3장」인데 그 탭에 두 장만 있는 화면이 만들어진다.
 *
 * ## 코드 등록이 목록 **위**에 있다
 *
 * 사람이 이 화면에 오는 이유가 둘이다 — 받으러 왔거나 확인하러 왔다. 버튼 뒤에 접어
 * 두면 그중 앞의 절반이 한 번의 클릭 뒤로 밀린다. 카드 지갑에서 발급 폼이 버튼 뒤에
 * 있는 것과 다른 판단인데, 거기서 발급은 확인을 하기 위한 준비물이지 목적이 아니었다.
 *
 * ## 「더 보기」가 버튼 하나인 이유
 *
 * 상품 목록의 무한 스크롤을 따르지 않는다. 그쪽은 둘러보는 화면이라 스크롤이 곧
 * 「계속」이지만, 쿠폰함은 **찾으러 온 화면**이다 — 「그 쿠폰이 아직 있나」를 확인하러
 * 온 사람에게 목록이 저절로 자라는 것은 도움이 아니라 끝을 없애는 일이고, 탭을 옮기면
 * 그 자란 목록이 통째로 버려진다.
 */
export function CouponBox({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.coupons
  const box = useCouponBox()

  /**
   * 「지금」을 마운트 시점에 한 번 고정한다 (F2).
   *
   * 렌더마다 `Date.now()` 를 부르면 만료 임박의 경계가 렌더 사이에 움직이고, 검사가
   * 경계를 고를 수도 없다 — 순수 함수 쪽이 시각을 인자로 받는 것과 같은 이유다
   * (QUALITY-GATES 6장). 주문 내역이 「최근 3개월」의 시작을 같은 방식으로 고정한다.
   */
  const [now] = useState(() => new Date())
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <CouponClaimForm
        copy={copy.claim}
        messages={messages}
        onSubmit={async (code) => {
          const result = await box.claim(code)

          // 어느 쿠폰이 들어왔는지까지 말한다. 「받았습니다」만으로는 목록에서 새 장을
          // 짚을 수 없고, 그 사람이 확인하러 온 것이 정확히 그 한 장이다.
          if (result.ok)
            setNotice(copy.claim.claimedNotice.replace('{name}', result.coupon.coupon.name))

          return result
        }}
      />

      {notice === null ? null : <AccountNotice>{notice}</AccountNotice>}

      <Tabs
        activationMode="manual"
        aria-label={copy.tabsLabel}
        items={userCouponStatuses.map((status) => ({
          value: status,
          label: <TabLabel copy={copy} count={box.counts?.[status] ?? null} status={status} />,
          content: <CouponPanel box={box} messages={messages} now={now} />,
        }))}
        onValueChange={(value) => {
          box.select(value as UserCouponStatus)
        }}
        value={box.tab}
      />
    </div>
  )
}

/**
 * 탭 하나의 이름과 수.
 *
 * 수가 아직 없으면 배지를 그리지 않는다. 0을 그리면 「아직 안 왔다」와 「없다」가 같은
 * 화면이 되고, 첫 렌더에서 세 탭이 전부 「0장」이라고 말하게 된다 — 그것은 쿠폰을 가진
 * 사람에게도 보이는 거짓말이다.
 */
function TabLabel({
  status,
  count,
  copy,
}: {
  readonly status: UserCouponStatus
  readonly count: number | null
  readonly copy: MyPageMessages['coupons']
}) {
  return (
    <span className="flex items-center gap-1.5">
      {copy.tabs[status]}
      {count === null ? null : (
        <Badge size="sm" variant="neutral">
          {copy.tabBadge.replace('{count}', String(count))}
        </Badge>
      )}
    </span>
  )
}

/**
 * 한 탭의 목록 — 네 상태 전부 (U1 · P5).
 *
 * 빈 상태가 탭마다 다르다. 쓸 쿠폰이 없는 사람은 받으러 가야 하고, 쓴 적이 없는
 * 사람에게는 할 일이 없으며, 만료된 쿠폰이 없는 것은 **좋은 소식**이다 — 한 문장으로
 * 덮으면 그 셋 중 둘에게 틀린 말을 한다. 갈 곳을 권하는 것도 첫 번째 탭뿐인 이유가
 * 같다: 「사용함」 탭이 비었다고 상품을 보러 보내는 것은 아무 답도 아니다.
 */
function CouponPanel({
  box,
  messages,
  now,
}: {
  readonly box: CouponBoxConsole
  readonly messages: MyPageMessages
  readonly now: Date
}) {
  const copy = messages.coupons
  const empty = copy.empty[box.tab]

  return (
    <div className="flex flex-col gap-4">
      <DataList
        empty={
          <EmptyState
            action={
              box.tab === 'ISSUED' ? (
                <Link className="text-primary text-sm font-medium underline" href="/search">
                  {copy.emptyAction}
                </Link>
              ) : undefined
            }
            description={empty.body}
            title={empty.title}
          />
        }
        error={
          box.state.status === 'error' ? (
            <AccountLoadFailure
              failure={box.state.failure}
              messages={messages}
              onRetry={box.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} />}
        state={stateOf(box.state.status, box.items.length)}
      >
        <p className="text-fg-muted text-sm" role="status">
          {copy.countLabel.replace('{count}', String(box.items.length))}
        </p>

        <ul aria-label={copy.listLabel} className="grid gap-3">
          {box.items.map((coupon) => (
            <CouponCard copy={copy} coupon={coupon} key={coupon.id} now={now} />
          ))}
        </ul>
      </DataList>

      {box.loadMoreFailure === null ? null : (
        <AccountWriteFailure
          failure={box.loadMoreFailure}
          messages={messages}
          title={copy.loadMoreFailedTitle}
        />
      )}

      {box.hasMore ? (
        <Button loading={box.loadingMore} onClick={box.loadMore} type="button" variant="outline">
          {box.loadingMore ? copy.loadingMore : copy.loadMore}
        </Button>
      ) : null}
    </div>
  )
}

/** `DataList` 의 네 상태를, 읽기의 세 상태와 「이 탭에 아무 장도 없다」에서. */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
