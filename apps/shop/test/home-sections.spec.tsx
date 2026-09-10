/**
 * 홈의 섹션과 첫 방문 안내 (TASK-0044 F1 · F2 · F4 · F5).
 *
 * The page itself — that it awaits nothing and makes no request of its own — is
 * `home-page.spec.tsx`'s, and that is TASK-0101 F4's structural measurement. What
 * is checked here is what TASK-0044 added on top of it: the rows arrive, the
 * density decides how many, and the first-visit nudge appears once.
 *
 * TASK-0089 F6 put a third row here — 「팔로우한 브랜드의 신상품」 — and it is checked
 * in the same place because it is the same thing: a search, drawn by the same
 * component. What is its own is **when the row exists at all.**
 */

import {
  mockPaths,
  searchHandlers,
  healthHandlers,
  neverAnswers,
  healthSearchIndexing,
  malformedResponse,
  networkFailureOn,
  sessionBuyer,
  storefrontCategoryTree,
} from '@shopping/api-mocks'
import { SEARCH_SELLER_IDS_MAX } from '@shopping/shared'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/page'
import { SECTION_FETCH_LIMIT, SECTION_ITEMS } from '@/components/home/product-section'
import { DEMO_INVITE_ATTRIBUTE, DEMO_INVITE_KEY, demoInviteBootScript } from '@/lib/demo/invite'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { resetLocalHistoryCache } from '@/lib/collections/use-recently-viewed'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import {
  bulkFollows,
  MOCK_FOLLOWS,
  resetCommunityStores,
  stubCommunityApi,
} from './support/community'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()
const home = messages.home

function renderHome({
  density = 2,
  signedIn = false,
}: { density?: number; signedIn?: boolean } = {}) {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))

  return renderWithAuth(
    <DensityProvider>
      <HomePage />
    </DensityProvider>,
    { session: signedIn ? sessionBuyer : null },
  )
}

/** 나간 검색 질의들. 홈의 줄이 **무엇을 물었나**는 이것만이 답한다. */
function watchSearches(): URL[] {
  const searches: URL[] = []

  testServer.server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/search')) searches.push(url)
  })

  return searches
}

/** One section's grid, once its request has come back. */
async function sectionGrid(title: string): Promise<HTMLElement> {
  return screen.findByRole('list', { name: home.gridLabel.replace('{title}', title) })
}

let stub: CommunityApiStub

beforeEach(() => {
  localStorage.clear()
  // 데모 안내가 보이는지는 이제 `<html>` 의 표시가 정한다 — 문서는 스펙 사이에
  // 살아남으므로 지우지 않으면 한 스펙의 결정이 다음 스펙으로 새어 간다.
  document.documentElement.removeAttribute(DEMO_INVITE_ATTRIBUTE)
  resetCategoryMenuCache()
  resetLocalHistoryCache()
  // 찜 표와 팔로우 표는 모듈 수준에 한 벌이다. 되돌리지 않으면 한 스펙의 팔로우가
  // 다음 스펙의 홈에 줄을 하나 더 그린다.
  resetCommunityStores()
  stubViewport(VIEWPORTS.desktop)
  // 홈 아래에 「최근 본 상품」이 붙었다 (TASK-0087). 로그인한 사람의 렌더가 그
  // 라우트를 묻고, `@shopping/api-mocks` 에는 핸들러가 없다.
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
  testServer.server.events.removeAllListeners('request:start')
})

describe('F1 홈 렌더', () => {
  it('shows 신상품, 인기 상품 and the category shortcuts', async () => {
    renderHome()

    expect(await sectionGrid(home.newTitle)).toBeVisible()
    expect(await sectionGrid(home.popularTitle)).toBeVisible()

    const shortcuts = await screen.findByRole('navigation', { name: home.categoriesTitle })
    const root = storefrontCategoryTree.nodes[0]!

    expect(within(shortcuts).getByRole('link', { name: root.name })).toHaveAttribute(
      'href',
      `/categories/${root.slug}`,
    )
  })

  it('offers a way from each section into the search that produced it', async () => {
    renderHome()
    await sectionGrid(home.newTitle)

    const links = screen.getAllByRole('link', { name: home.moreLabel })

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/search?sort=newest',
      '/search?sort=sales',
    ])
  })

  it('says so, and keeps the page up, when a section cannot load', async () => {
    // The home is a starting point, not a destination: a section that failed
    // must not take the search box and the categories down with it.
    testServer.server.use(networkFailureOn('get', mockPaths.search))

    renderHome()

    expect(await screen.findAllByText(home.sectionFailed)).toHaveLength(2)
    expect(await screen.findByRole('navigation', { name: home.categoriesTitle })).toBeVisible()
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2)
  })
})

describe('상품 조회 복구', () => {
  it('retries a failed product section and renders its products', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.search))
    renderHome()
    const buttons = await screen.findAllByRole('button', { name: home.retryLabel })
    testServer.server.use(...searchHandlers)
    await userEvent.click(buttons[0]!)
    expect(await screen.findByRole('link', { name: home.moreLabel })).toHaveAttribute(
      'href',
      '/search?sort=newest',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('retries failed products after health recovery', async () => {
    testServer.server.use(
      malformedResponse(mockPaths.health, healthSearchIndexing),
      networkFailureOn('get', mockPaths.search),
    )
    renderHome()
    const status = await screen.findByRole('status')
    const button = within(status).getByRole('button', { name: messages.wake.retryLabel })
    expect(screen.queryByText(home.sectionEmpty)).toBeNull()
    expect(screen.queryByRole('link', { name: home.moreLabel })).toBeNull()
    testServer.server.use(...healthHandlers, ...searchHandlers)
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: home.moreLabel })).toHaveLength(2),
    )
    expect(screen.queryByText(messages.wake.storefrontPreparing)).toBeNull()
  })
})

describe('F2 밀도 반영', () => {
  it.each(DENSITY_LEVELS)('draws the step’s own number of cards at density %s', async (level) => {
    renderHome({ density: level })

    const grid = await sectionGrid(home.newTitle)

    await waitFor(() => {
      expect(within(grid).getAllByRole('listitem').length).toBeLessThanOrEqual(SECTION_ITEMS[level])
    })

    // 미니멀은 큰 이미지 소수, 맥시멀은 조밀한 다수 — the count moves with the
    // step, and it is read from the table rather than typed here.
    expect(grid).toHaveAttribute('data-density', String(level))
  })

  it('asks for the largest step’s worth, so a step change costs no request', async () => {
    const searches = watchSearches()

    renderHome({ density: 1 })
    await sectionGrid(home.newTitle)

    // Two sections, one request each, and each asks for the maximal step's
    // count — the minimal step then draws four of the twelve it already has. A
    // request per density change would make the toggle slow and the cache three
    // deep; TASK-0040 F3 made the same call for the card.
    await waitFor(() => {
      expect(searches).toHaveLength(2)
    })
    expect(searches.map((url) => url.searchParams.get('limit'))).toEqual([
      String(SECTION_FETCH_LIMIT),
      String(SECTION_FETCH_LIMIT),
    ])
  })
})

describe('F6 팔로우한 브랜드의 신상품 (TASK-0089)', () => {
  async function followedGrid(): Promise<HTMLElement> {
    return screen.findByRole('list', {
      name: home.gridLabel.replace('{title}', home.followedTitle),
    })
  }

  it('holds down the stores this shopper follows, as one search (4.5)', async () => {
    const searches = watchSearches()

    renderHome({ signedIn: true })

    expect(await followedGrid()).toBeVisible()

    // 홈 전용 엔드포인트가 아니라 **검색**이다 — `pages.md` 의 「홈 섹션은 검색
    // API 다」가 그것을 막고, 만들었다면 「신상품」의 정의가 두 군데가 된다.
    const followed = searches.find((url) => url.searchParams.get('sellerIds') !== null)

    expect(followed?.searchParams.get('sellerIds')).toBe(stub.state.follows[0]!.sellerId)
    expect(followed?.searchParams.get('sort')).toBe('newest')
    expect(followed?.searchParams.get('limit')).toBe(String(SECTION_FETCH_LIMIT))
  })

  it('draws nothing at all for a visitor who is not signed in (4.5)', async () => {
    const searches = watchSearches()

    renderHome()
    await sectionGrid(home.newTitle)

    // 빈 격자도, 영원히 안 차는 스켈레톤도 아니다 — 줄 자체가 없다.
    expect(screen.queryByRole('heading', { name: home.followedTitle })).toBeNull()
    expect(searches.some((url) => url.searchParams.get('sellerIds') !== null)).toBe(false)
  })

  it('draws nothing for somebody who follows nobody', async () => {
    stub = stubCommunityApi({ follows: [] })

    renderHome({ signedIn: true })
    await sectionGrid(home.newTitle)

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: home.followedTitle })).toBeNull()
    })
  })

  it('asks for at most what the contract takes, most recent first (4.6)', async () => {
    // 맨 앞은 **검색 대역이 상품을 가진 가게**다. 나머지 예순 곳은 이 검사가 세려는
    // 것(무엇을 물었나)에는 필요하지만 답에는 한 줄도 보태지 못하므로, 그것만 두면
    // 줄이 비어 사라지고 검사는 정작 재려던 질의를 못 본다.
    const follows = [MOCK_FOLLOWS[0]!, ...bulkFollows(SEARCH_SELLER_IDS_MAX + 10)]

    stub = stubCommunityApi({ follows })
    const searches = watchSearches()

    renderHome({ signedIn: true })
    await followedGrid()

    // 상한을 넘기면 서버가 400 으로 거절하고, 그 거절은 화면에 **빈 줄**로만 보인다.
    // 잘리는 쪽은 오래된 팔로우다 — 그래서 답의 순서가 계약의 일부다.
    const followed = searches.find((url) => url.searchParams.get('sellerIds') !== null)

    expect(followed?.searchParams.get('sellerIds')?.split(',')).toEqual(
      follows.slice(0, SEARCH_SELLER_IDS_MAX).map((seller) => seller.sellerId),
    )
  })

  it('keeps the rest of the home up when its own search fails', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.search))

    renderHome({ signedIn: true })

    // Section failures keep navigation available and offer local retries.
    // 셋인 것은 이 줄이 팔로우 목록을 먼저 읽고 **나서** 실패하기 때문이다 — 앞의
    // 둘보다 한 왕복 늦게 비고, 그래서 세는 자리가 `waitFor` 안에 있다.
    await waitFor(async () => {
      expect(await screen.findAllByText(home.sectionFailed)).toHaveLength(3)
    })
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2)
  })
})

/**
 * 안내가 **보이는가**는 `<html>` 의 표시가 답한다 (TASK-0097 F2).
 *
 * 예전에는 React 가 마운트 뒤에 그릴지 말지를 정했고, 그래서 「없다」를
 * `queryByText` 로 물을 수 있었다. 지금은 표를 늘 그려 두고 CSS 가 감춘다 —
 * 그렇게 해야 첫 페인트 전에 결정되고 화면이 움직이지 않는다. jsdom 에는
 * 스타일시트가 없으므로 **보이는지를 정하는 그 값**을 직접 묻는다.
 */
function inviteShown(): boolean {
  return document.documentElement.getAttribute(DEMO_INVITE_ATTRIBUTE) === 'owed'
}

describe('F5 데모 유도', () => {
  it('invites a signed-out visitor and links the demo flow', async () => {
    renderHome()

    expect(await screen.findByText(home.demo.title)).toBeInTheDocument()
    await waitFor(() => {
      expect(inviteShown()).toBe(true)
    })
    expect(screen.getByRole('link', { name: home.demo.cta })).toHaveAttribute('href', '/login')
  })

  it('stays away once it has been dismissed (F4)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderHome()

    await user.click(await screen.findByRole('button', { name: home.demo.dismiss }))

    await waitFor(() => {
      expect(inviteShown()).toBe(false)
    })

    unmount()
    renderHome()

    // A second visit that shows the same notice is not guidance, it is an
    // advertisement (R2).
    await waitFor(() => {
      expect(localStorage.getItem(DEMO_INVITE_KEY)).toBe('seen')
    })
    expect(inviteShown()).toBe(false)
  })

  it('never appears for somebody already signed in', async () => {
    const { sessionBuyer } = await import('@shopping/api-mocks')

    renderWithAuth(
      <DensityProvider>
        <HomePage />
      </DensityProvider>,
      { session: sessionBuyer },
    )

    await sectionGrid(home.newTitle)

    await waitFor(() => {
      expect(inviteShown()).toBe(false)
    })
    // 「봤다」로 적지 않는다 — 로그아웃하면 이 사람도 처음 온 사람이다.
    expect(localStorage.getItem(DEMO_INVITE_KEY)).toBeNull()
  })
})

/**
 * 첫 페인트 전에 도는 스크립트 (TASK-0097 F2).
 *
 * 눈으로 검토하는 대신 **실행해 본다** — `density-script.spec.ts` 가 같은 이유로
 * 같은 모양이다. 이 스크립트가 틀리면 홈은 여전히 움직이는데, 그 사실은 화면에
 * 아무 자국도 남기지 않는다.
 */
describe('데모 안내 부트 스크립트', () => {
  function run(): void {
    // 문자열로 내보낸 원문을 그대로 실행해 본다 — 눈으로 읽는 대신.
    ;(0, eval)(demoInviteBootScript())
  }

  it('marks the invite owed on a first visit', () => {
    run()

    expect(document.documentElement.getAttribute(DEMO_INVITE_ATTRIBUTE)).toBe('owed')
  })

  it('leaves it alone once it has been seen', () => {
    localStorage.setItem(DEMO_INVITE_KEY, 'seen')

    run()

    expect(document.documentElement.hasAttribute(DEMO_INVITE_ATTRIBUTE)).toBe(false)
  })

  it('treats an unreadable store as seen', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    try {
      run()

      // 기억할 수 없는 사람을 매번 붙잡는 쪽이 더 나쁘다.
      expect(document.documentElement.hasAttribute(DEMO_INVITE_ATTRIBUTE)).toBe(false)
    } finally {
      blocked.mockRestore()
    }
  })
})

it('requests and displays products without waiting for a delayed health response', async () => {
  testServer.server.use(neverAnswers(mockPaths.health))
  const requests = watchSearches()
  renderHome()
  await sectionGrid(home.newTitle)
  expect(requests.length).toBeGreaterThan(0)
  expect(screen.getAllByRole('link', { name: home.moreLabel })).toHaveLength(2)
})
