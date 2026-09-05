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
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

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

  return render(
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

  it('keeps the follow button visible, inert, and explained', async () => {
    await renderBrand()

    const follow = screen.getByRole('button', { name: copy.follow })

    // Shown and disabled with a reason rather than hidden (TASK-0023 4장): the
    // point of the demo is that the feature is visible.
    expect(follow).toHaveAttribute('aria-disabled', 'true')
    expect(follow).not.toBeDisabled()
    expect(screen.getByText(copy.followComingSoon)).toBeVisible()
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
