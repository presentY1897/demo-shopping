/**
 * 최근 본 상품 (TASK-0087 F6 · F7).
 *
 * **API 대역은 `test/support/community.ts` 다** — `@shopping/api-mocks` 에 이 라우트의
 * 핸들러가 아직 없고, 그것을 더하는 일은 이 갈래의 소유가 아니다. 대역의 답은 계약
 * 스키마를 지난다.
 *
 * **이 파일이 확인하는 것 넷으로 줄이면**:
 *
 * ① **비로그인 이력이 브라우저에 남는다** — 상품 상세를 열면 적히고, 스트립이 그것을 그린다.
 * ② **로그인하면 합쳐지고 사본이 지워진다** (F6). 왕복은 하나이고, 보낸 것은 계약이 받는 모양이다.
 * ③ **지금 보고 있는 상품은 스트립에 없다.** 「최근 본 상품」의 맨 앞이 지금 보는 상품이면 안 된다.
 * ④ **개별·전체 삭제가 로그인 여부와 무관하게 동작한다** (F7).
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RecentScreen } from '@/components/collections/recent-screen'
import { RecentlyViewedStrip } from '@/components/collections/recently-viewed-strip'
import { RECENT_STORAGE_KEY } from '@/lib/collections/use-recently-viewed'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import {
  MOCK_DETAIL_PRODUCT_ID,
  MOCK_RECENT,
  MOCK_SOLD_OUT_PRODUCT_ID,
  resetCommunityStores,
  stubCommunityApi,
} from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()
const strip = messages.collections.recent
const page = messages.mypage.recent

let stub: CommunityApiStub

/** 브라우저에 이력을 심는다 — 로그인하지 않고 둘러본 사람의 상태. */
function seedLocal(items: readonly unknown[]): void {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items))
}

beforeEach(() => {
  localStorage.clear()
  resetDensity()
  resetCommunityStores()
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('스트립', () => {
  it('draws nothing at all when there is no history', async () => {
    renderWithAuth(<RecentlyViewedStrip copy={strip} />)

    // 「최근 본 상품이 없습니다」를 홈에 그리면 처음 온 사람의 첫 화면에 빈 상자가
    // 하나 는다 — 그것은 안내가 아니라 아직 아무것도 하지 않았다는 지적이다.
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: strip.listLabel })).toBeNull()
    })
    expect(screen.queryByText(strip.title)).toBeNull()
  })

  it('draws the browser’s own history for a visitor, and says where it lives', async () => {
    seedLocal(MOCK_RECENT)
    renderWithAuth(<RecentlyViewedStrip copy={strip} />)

    const list = await screen.findByRole('list', { name: strip.listLabel })

    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    // 말하지 않으면 다른 기기에서 로그인한 사람이 「이력이 사라졌다」고 읽는다.
    expect(screen.getByText(strip.localNotice)).toBeVisible()
  })

  it('leaves out the product being looked at', async () => {
    seedLocal(MOCK_RECENT)
    renderWithAuth(<RecentlyViewedStrip copy={strip} exclude={MOCK_DETAIL_PRODUCT_ID} />)

    const list = await screen.findByRole('list', { name: strip.listLabel })

    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).queryByText('울 블렌드 코트')).toBeNull()
  })

  it('reads the account’s history once signed in, and does not mention the browser', async () => {
    renderWithAuth(<RecentlyViewedStrip copy={strip} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: strip.listLabel })

    expect(screen.queryByText(strip.localNotice)).toBeNull()
  })
})

describe('F6 로그인 시 병합', () => {
  it('sends the browser’s history in one round trip and clears the copy', async () => {
    seedLocal([
      {
        ...MOCK_RECENT[0],
        // 서버가 들고 있는 것보다 **더 최근**이다. 병합에서 이 값이 이겨야 한다.
        viewedAt: '2026-09-06T00:00:00.000Z',
      },
    ])

    renderWithAuth(<RecentlyViewedStrip copy={strip} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: strip.listLabel })
    await waitFor(() => {
      expect(stub.writes).toHaveLength(1)
    })

    // 왕복은 하나다 — 답이 합쳐진 목록 전체라 보내고 나서 다시 읽지 않는다.
    expect(stub.writes).toEqual([
      { items: [{ productId: MOCK_DETAIL_PRODUCT_ID, viewedAt: '2026-09-06T00:00:00.000Z' }] },
    ])
    expect(
      stub.requests.filter(
        (one) => one.method === 'GET' && one.url.pathname.endsWith('/me/recently-viewed'),
      ),
    ).toEqual([])

    // 남겨 두면 다음 로그인 때 같은 이력이 다시 올라가고, 그때 그것은 「방금 본 것」이
    // 아니라 옛 기록이라 순서를 망친다.
    await waitFor(() => {
      expect(localStorage.getItem(RECENT_STORAGE_KEY)).toBeNull()
    })
    expect(stub.state.recent[0]?.viewedAt).toBe('2026-09-06T00:00:00.000Z')
  })

  it('just reads when the browser has nothing to hand over', async () => {
    renderWithAuth(<RecentlyViewedStrip copy={strip} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: strip.listLabel })

    // 빈 배열을 보내면 계약이 400 으로 답하고, 그 400 은 아무 일도 없었다는 사실을
    // 실패처럼 보이게 한다.
    expect(stub.writes).toEqual([])
    expect(
      stub.requests.some(
        (one) => one.method === 'GET' && one.url.pathname.endsWith('/me/recently-viewed'),
      ),
    ).toBe(true)
  })
})

describe('F7 삭제', () => {
  it('removes one row and empties the list for a signed-in shopper', async () => {
    const user = userEvent.setup()

    renderAccountScreen(<RecentScreen messages={messages.mypage} />, { session: sessionBuyer })

    const list = await screen.findByRole('list', { name: page.listLabel })

    await user.click(
      screen.getByRole('button', { name: page.removeLabel.replace('{name}', '울 블렌드 코트') }),
    )

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(stub.state.recent.map((item) => item.productId)).toEqual([MOCK_SOLD_OUT_PRODUCT_ID])

    await user.click(screen.getByRole('button', { name: page.clearLabel }))

    expect(await screen.findByText(page.emptyTitle)).toBeVisible()
    expect(stub.state.recent).toEqual([])
  })

  it('lets a visitor clear the history that only their browser has', async () => {
    const user = userEvent.setup()

    seedLocal(MOCK_RECENT)
    renderAccountScreen(<RecentScreen messages={messages.mypage} />)

    await screen.findByRole('list', { name: page.listLabel })

    // 화면이 로그인 유도로 덮여 있었다면, 비로그인 이력을 지울 자리가 어디에도 없다.
    expect(screen.getByText(page.localNotice)).toBeVisible()

    await user.click(screen.getByRole('button', { name: page.clearLabel }))

    expect(await screen.findByText(page.emptyTitle)).toBeVisible()
    expect(localStorage.getItem(RECENT_STORAGE_KEY)).toBeNull()
  })
})
