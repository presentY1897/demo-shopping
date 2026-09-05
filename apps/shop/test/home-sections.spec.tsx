/**
 * 홈의 섹션과 첫 방문 안내 (TASK-0044 F1 · F2 · F4 · F5).
 *
 * The page itself — that it awaits nothing and makes no request of its own — is
 * `home-page.spec.tsx`'s, and that is TASK-0101 F4's structural measurement. What
 * is checked here is what TASK-0044 added on top of it: the rows arrive, the
 * density decides how many, and the first-visit nudge appears once.
 */

import { mockPaths, networkFailureOn, storefrontCategoryTree } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/page'
import { SECTION_FETCH_LIMIT, SECTION_ITEMS } from '@/components/home/product-section'
import { DEMO_INVITE_KEY } from '@/lib/demo/invite'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const messages = messagesFor()
const home = messages.home

function renderHome({ density = 2 }: { density?: number } = {}) {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))

  return renderWithAuth(
    <DensityProvider>
      <HomePage />
    </DensityProvider>,
  )
}

/** One section's grid, once its request has come back. */
async function sectionGrid(title: string): Promise<HTMLElement> {
  return screen.findByRole('list', { name: home.gridLabel.replace('{title}', title) })
}

beforeEach(() => {
  localStorage.clear()
  resetCategoryMenuCache()
  stubViewport(VIEWPORTS.desktop)
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

    expect(await screen.findAllByText(home.sectionEmpty)).toHaveLength(2)
    expect(await screen.findByRole('navigation', { name: home.categoriesTitle })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
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
    const searches: URL[] = []

    testServer.server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url)

      if (url.pathname.endsWith('/search')) searches.push(url)
    })

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

describe('F5 데모 유도', () => {
  it('invites a signed-out visitor and links the demo flow', async () => {
    renderHome()

    expect(await screen.findByText(home.demo.title)).toBeVisible()
    expect(screen.getByRole('link', { name: home.demo.cta })).toHaveAttribute('href', '/login')
  })

  it('stays away once it has been dismissed (F4)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderHome()

    await user.click(await screen.findByRole('button', { name: home.demo.dismiss }))

    await waitFor(() => {
      expect(screen.queryByText(home.demo.title)).toBeNull()
    })

    unmount()
    renderHome()

    // A second visit that shows the same notice is not guidance, it is an
    // advertisement (R2).
    expect(screen.queryByText(home.demo.title)).toBeNull()
    expect(localStorage.getItem(DEMO_INVITE_KEY)).toBe('seen')
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

    expect(screen.queryByText(home.demo.title)).toBeNull()
  })
})
