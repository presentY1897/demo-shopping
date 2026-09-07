'use client'

import type { ErrorMessages } from '@shopping/shared'
import { Tabs } from '@shopping/ui/components'

import { StoreMetricsWorkspace } from '@/components/stores/store-metrics-workspace'
import type { ErrorNoticeMessages, SellerReviewMessages, StoreMessages } from '@/messages'

import { SellerReviewWorkspace } from './seller-review-workspace'

/**
 * `/sellers` 의 두 탭 — **심사**와 **지표** (TASK-0094).
 *
 * ## 왜 한 라우트에 둘인가
 *
 * 사이드바에 「판매자 관리」가 하나이고, 두 탭이 답하는 것은 그 하나의 서로 다른 절반이다:
 * 「이 신청을 승인할까」와 「어느 스토어를 봐야 하나」. 라우트를 둘로 나누면 메뉴가 둘이
 * 되고, 그러면 방금 승인한 스토어의 지표를 보러 가는 길이 사이드바를 한 번 거친다.
 *
 * 계약에서 두 질문의 경로가 갈려 있는 것(`admin/sellers` 와 `admin/stores`)과 화면이
 * 한 라우트인 것은 어긋나지 않는다 — 갈린 이유는 **URL 이 `:id` 와 이름을 구별하지
 * 못해서**이지 두 화면이어야 해서가 아니다 (TASK-0094 4.3).
 *
 * ## 탭을 바꿔야 두 번째 목록을 읽는다
 *
 * 라딕스는 **활성 패널만 마운트한다.** 그래서 심사 큐를 보러 온 사람이 스토어 지표
 * 집계를 함께 기다리는 일이 없고 — 그 집계는 스토어마다 매출·클레임·상품을 세는
 * 질의다 (4.4) — 지표 탭을 연 사람도 심사 큐를 다시 읽지 않는다.
 *
 * `activationMode="manual"` 인 것도 같은 이유다. 자동이면 화살표로 탭을 지나가기만
 * 해도 그 집계가 한 번씩 돈다.
 *
 * ## 자격이 탭마다 다르다
 *
 * 심사는 `seller.approve`, 지표는 `seller.read:any` 다. 그래서 게이트는 이 파일이 아니라
 * **각 패널 안**에 있다 — 여기서 한 번에 막으면 한쪽만 가진 계정에게 볼 수 있는 절반까지
 * 가려진다.
 */

export interface SellerConsoleTabsProps {
  readonly messages: SellerReviewMessages
  readonly stores: StoreMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** Copy for a failure nobody on this screen can fix (TASK-0117 4.4). */
  readonly notice: ErrorNoticeMessages
}

export function SellerConsoleTabs({ messages, stores, errors, notice }: SellerConsoleTabsProps) {
  return (
    <Tabs
      activationMode="manual"
      aria-label={messages.description}
      items={[
        {
          value: 'review',
          label: messages.title,
          content: <SellerReviewWorkspace errors={errors} messages={messages} notice={notice} />,
        },
        {
          value: 'stores',
          label: stores.tabLabel,
          content: (
            <div className="flex flex-col gap-4">
              <p className="text-fg-muted text-sm">{stores.description}</p>

              <StoreMetricsWorkspace
                errors={errors}
                messages={stores}
                statusLabels={messages.statusLabels}
              />
            </div>
          ),
        },
      ]}
    />
  )
}
