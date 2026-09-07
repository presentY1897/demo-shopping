/**
 * 브랜드관 (TASK-0044 F3 · F8 · F9).
 *
 * The list below the heading is the search screen's own component with the store
 * pinned, and `search-page.spec.tsx` is its gate. What is checked here is the
 * frame: whose products these are, what the page says about the store, and the
 * two ways it refuses.
 */

import { storefrontSeller } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: BrandPage, generateMetadata } = await import('@/app/brands/[sellerId]/page')

const messages = messagesFor()
const copy = messages.brand
const seller = storefrontSeller.seller

async function renderBrand(sellerId: string = seller.id) {
  stubViewport(VIEWPORTS.desktop)
  navigation.start(`/brands/${sellerId}`)

  // 팔로우 버튼이 세션을 읽는다 (TASK-0089). 세션 없이 렌더하면 `useAuth` 가
  // 프로바이더 밖이라며 던지고, 그것은 이 화면의 결함이 아니라 이 스펙의 결함이다.
  return renderWithAuth(
    <DensityProvider>{await BrandPage({ params: Promise.resolve({ sellerId }) })}</DensityProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F3 판매자 상품만', () => {
  it('lists the store’s own listings', async () => {
    await renderBrand()

    const grid = await screen.findByRole('list', { name: messages.search.list.gridLabel })

    // Every listing in the mock catalogue belongs to this store, so the filter
    // is all-or-nothing — which is what makes the negative half checkable.
    expect(within(grid).getAllByRole('link').length).toBeGreaterThan(0)
  })

  it('keeps the store in the path and out of the query string', async () => {
    await renderBrand()

    await screen.findByRole('list', { name: messages.search.list.gridLabel })

    expect(navigation.params.get('sellerId')).toBeNull()
    expect(navigation.href).toContain(`/brands/${seller.id}`)
  })

  it('filters within the store like every other list', async () => {
    await renderBrand()

    // The panel is the search screen's, so the sort control is there too.
    expect(await screen.findByRole('combobox', { name: messages.search.sort.label })).toBeVisible()
  })
})

describe('브랜드 소개', () => {
  it('names the store, shows its logo and its paragraph', async () => {
    await renderBrand()

    expect(screen.getByRole('heading', { level: 1, name: seller.brandName })).toBeVisible()
    expect(
      screen.getByRole('img', { name: copy.logoAlt.replace('{brand}', seller.brandName) }),
    ).toHaveAttribute('src', seller.logoUrl)
    expect(screen.getByText(seller.introduction ?? '')).toBeVisible()
  })

  it('offers sign-in in place of the follow button for a visitor (TASK-0089)', async () => {
    await renderBrand()

    // 「준비 중」이라고 적힌 비활성 버튼이 있던 자리다. 로그인하지 않은 사람에게
    // 버튼을 주면 누르는 순간 401 이 돌아오고, 그것은 사람이 고칠 수 없는 실패다.
    expect(
      screen.getByRole('link', { name: messagesFor().collections.follow.signIn }),
    ).toBeVisible()
  })

  it('shows the follower count to everybody, signed in or not (TASK-0089 F3)', async () => {
    await renderBrand()

    // 공개 응답이 그 수를 언제나 싣는다 (4.3). 한때는 팔로우 목록의 줄에만 있어서
    // **아직 안 누른 사람에게는 아예 보이지 않았고**, 그 사람이 바로 이 수를 근거로
    // 쓰는 사람이다. 픽스처가 0 이 아닌 것도 그래서다 — 0 이면 「안 그린다」와
    // 「0을 그린다」가 한 값에 겹친다.
    expect(seller.followerCount).toBeGreaterThan(0)
    expect(
      screen.getByText(
        messagesFor().collections.follow.followerCount.replace(
          '{count}',
          seller.followerCount.toLocaleString('ko-KR'),
        ),
      ),
    ).toBeVisible()
  })
})

describe('F8 · F9 — 거절과 접근', () => {
  it('is a 404 for a store the storefront does not serve (F8)', async () => {
    // A store under review, a suspended one and an id that never existed are one
    // answer: telling them apart publishes the review state of every application.
    await expect(
      BrandPage({ params: Promise.resolve({ sellerId: '019596d0-1f1c-7c2e-9a0e-00000000dead' }) }),
    ).rejects.toThrow()
  })

  it('renders for a caller with no session at all (F9)', async () => {
    // `render` here is the bare one — no `AuthProvider`. The page must not need
    // to know who is asking.
    await renderBrand()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(seller.brandName)
    })
  })
})

describe('SEO', () => {
  it('titles the page with the brand and quotes its introduction', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ sellerId: seller.id }) })

    expect(meta.title).toBe(copy.metaTitle.replace('{brand}', seller.brandName))
    expect(meta.description).toBe(seller.introduction)
    expect(meta.alternates?.canonical).toBe(`/brands/${seller.id}`)
  })
})
