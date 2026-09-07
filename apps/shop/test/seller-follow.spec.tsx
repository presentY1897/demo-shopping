/**
 * 판매자 팔로우 (TASK-0089 F1 · F2 · F3).
 *
 * **API 대역은 `test/support/community.ts` 다** — `@shopping/api-mocks` 에 이 라우트의
 * 핸들러가 아직 없다.
 *
 * **이 파일이 확인하는 것 넷으로 줄이면**:
 *
 * ① **팔로우 여부는 페이지가 없는 문에서 온다** (F1 · 4.4). 목록으로 하면 한 쪽에 안
 *    들어가는 사람의 화면이 조용히 틀린다.
 * ② **팔로워 수는 화면이 들고 온 것으로 그리고, 누르면 답이 그것을 덮는다** (F3 · 4.3).
 *    화면이 ±1 을 하면 두 탭에서 누른 사람의 화면이 서로 다른 수를 그린다.
 * ③ **수를 넘길 수 없는 화면은 그리지 않는다.** 0을 그리면 브랜드에 대한 거짓말이다.
 * ④ **로그인하지 않은 사람은 401 을 만나지 않는다.** 그 자리는 버튼이 아니라 링크다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { FOLLOW_LIST_MAX_LIMIT } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FollowButton } from '@/components/collections/follow-button'
import { FollowingScreen } from '@/components/collections/following-screen'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import {
  MOCK_SELLER_ID,
  bulkFollows,
  resetCommunityStores,
  stubCommunityApi,
} from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const OTHER_SELLER_ID = '019596d0-1f1c-7c2e-9a0e-200000000009'

/** 브랜드관이 넘겨 주는 수. 공개 응답이 언제나 싣는다 (4.3). */
const PAGE_COUNT = 128

const messages = messagesFor()
const copy = messages.collections.follow
const page = messages.mypage.following

let stub: CommunityApiStub

beforeEach(() => {
  localStorage.clear()
  resetDensity()
  resetCommunityStores()
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 · F3 팔로우 버튼', () => {
  it('sends a visitor to sign-in rather than to a 401', async () => {
    renderWithAuth(<FollowButton copy={copy} sellerId={MOCK_SELLER_ID} />)

    expect(await screen.findByRole('link', { name: copy.signIn })).toBeVisible()
  })

  it('knows it is following, and draws the count the page carried (F3)', async () => {
    renderWithAuth(
      <FollowButton copy={copy} followerCount={PAGE_COUNT} sellerId={MOCK_SELLER_ID} />,
      { session: sessionBuyer },
    )

    const pressed = await screen.findByRole('button', { name: copy.following })

    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(copy.followerCount.replace('{count}', '128'))).toBeVisible()
  })

  it('knows a store past the list’s first page, which is where this broke (F1)', async () => {
    // 목록은 한 쪽이 100곳까지다. 이 사람은 150곳을 팔로우했고, 묻는 가게는 그 뒤에
    // 있다 — 표를 목록으로 채우던 시절 이 버튼은 「팔로우」라고 그려졌고, 누르면
    // **팔로우가 끊겼다** (4.4).
    const follows = bulkFollows(FOLLOW_LIST_MAX_LIMIT + 50)
    const beyond = follows.at(-1)!.sellerId

    stub = stubCommunityApi({ follows })
    renderWithAuth(<FollowButton copy={copy} sellerId={beyond} />, { session: sessionBuyer })

    expect(await screen.findByRole('button', { name: copy.following })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(stub.requests.some((one) => one.url.pathname.endsWith('/me/follows/ids'))).toBe(true)
    expect(stub.requests.some((one) => one.url.pathname.endsWith('/me/follows'))).toBe(false)
  })

  it('draws the count for a brand nobody here follows, because it is public (F3)', async () => {
    renderWithAuth(
      <FollowButton copy={copy} followerCount={PAGE_COUNT} sellerId={OTHER_SELLER_ID} />,
      { session: sessionBuyer },
    )

    await screen.findByRole('button', { name: copy.follow })

    // 「팔로우한 뒤에야 나타나는 수」는 F3 을 지킨 것이 아니라 물어볼 수 없게 만든
    // 것이었다 (4.3). 아직 안 누른 사람이 바로 이 수를 근거로 쓰는 사람이다.
    expect(screen.getByText(copy.followerCount.replace('{count}', '128'))).toBeVisible()
  })

  it('draws no count on a screen that cannot carry one', async () => {
    renderWithAuth(<FollowButton copy={copy} sellerId={OTHER_SELLER_ID} />, {
      session: sessionBuyer,
    })

    await screen.findByRole('button', { name: copy.follow })

    // 상품 상세의 판매자는 이름과 id 뿐이다. 그 자리에 0을 그리면 팔로워가 백 명인
    // 브랜드에 대한 거짓말이 된다.
    expect(screen.queryByText(/팔로워/)).toBeNull()
  })

  it('takes the count from the answer rather than counting itself (F3)', async () => {
    const user = userEvent.setup()

    renderWithAuth(
      <FollowButton copy={copy} followerCount={PAGE_COUNT} sellerId={OTHER_SELLER_ID} />,
      { session: sessionBuyer },
    )

    await user.click(await screen.findByRole('button', { name: copy.follow }))

    // 답이 말한 수가 페이지가 들고 온 수를 덮는다 — 누른 뒤에도 128 이면 사람은
    // 팔로우가 안 됐다고 읽는다.
    expect(await screen.findByRole('button', { name: copy.following })).toBeVisible()
    expect(screen.getByText(copy.followerCount.replace('{count}', '1'))).toBeVisible()
  })

  it('rolls back and says so when the toggle is refused', async () => {
    const user = userEvent.setup()

    renderWithAuth(
      <FollowButton copy={copy} followerCount={PAGE_COUNT} sellerId={MOCK_SELLER_ID} />,
      { session: sessionBuyer },
    )

    await screen.findByRole('button', { name: copy.following })
    stub.state.refuseNextWrite = { status: 500, code: 'INTERNAL_ERROR', message: '서버 오류' }

    await user.click(screen.getByRole('button', { name: copy.following }))

    expect(await screen.findByText(copy.failedNotice)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.following })).toBeVisible()
    expect(screen.getByText(copy.followerCount.replace('{count}', '128'))).toBeVisible()
  })
})

describe('팔로우 목록', () => {
  it('lists the brands and their follower counts', async () => {
    renderAccountScreen(<FollowingScreen messages={messages.mypage} />, { session: sessionBuyer })

    const list = await screen.findByRole('list', { name: page.listLabel })

    expect(within(list).getByRole('link', { name: '루미크' })).toHaveAttribute(
      'href',
      `/brands/${MOCK_SELLER_ID}`,
    )
    expect(within(list).getByText(page.followerCount.replace('{count}', '128'))).toBeVisible()
  })

  it('takes a row out once the toggle answers 「해제됨」', async () => {
    const user = userEvent.setup()

    renderAccountScreen(<FollowingScreen messages={messages.mypage} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: page.listLabel })
    await user.click(
      screen.getByRole('button', { name: page.unfollowLabel.replace('{brand}', '루미크') }),
    )

    await waitFor(() => {
      expect(screen.getByText(page.emptyTitle)).toBeVisible()
    })
    expect(stub.state.follows).toEqual([])
  })
})
