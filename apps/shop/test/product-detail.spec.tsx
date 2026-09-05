/**
 * 상품 상세 (TASK-0043 F1–F7).
 *
 * The page is a server component, so it is awaited and rendered as one; what it
 * produces is the structured data and a client screen. The screen is where the
 * task's real question lives — **품절과 없는 조합을 구별하는가** — and that is
 * checked through the controls a shopper actually operates.
 */

import { storefrontProductDetail, storefrontProductWithoutOptions } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: ProductPage, generateMetadata } = await import('@/app/products/[id]/page')

const copy = messagesFor().productDetail
const detail = storefrontProductDetail
const product = detail.product

async function renderDetail(
  id: string = product.id,
  { width = VIEWPORTS.desktop, density = 2 }: { width?: number; density?: number } = {},
) {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))
  stubViewport(width)

  return render(
    <DensityProvider>{await ProductPage({ params: Promise.resolve({ id }) })}</DensityProvider>,
  )
}

/** One option button, by axis name and label. */
function optionButton(axis: string, label: string): HTMLElement {
  const group = screen.getByRole('group', { name: axis })

  return within(group).getByRole('button', { name: new RegExp(`^${label}`) })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 옵션 선택', () => {
  it('shows the SKU and the stock once both axes are chosen', async () => {
    const user = userEvent.setup()
    await renderDetail()

    expect(screen.queryByText(/LUMIKNIT/)).toBeNull()

    await user.click(optionButton('색상', '아이보리'))
    await user.click(optionButton('사이즈', 'M'))

    expect(screen.getByText(/LUMIKNIT-6/)).toBeVisible()
    expect(screen.getByText(/8개 남음/)).toBeVisible()
  })

  it('asks for the options before it will total anything', async () => {
    await renderDetail()

    expect(screen.getByText(copy.options.chooseNotice)).toBeVisible()
  })

  it('needs no choice at all when the product has no axes', async () => {
    // That one variant is the thing carrying the price (DECISIONS 3); a screen
    // that waited for a selection would never show one.
    await renderDetail(storefrontProductWithoutOptions.product.id)

    expect(screen.getByText(/LUMISCARF-9/)).toBeVisible()
    expect(screen.queryByText(copy.options.chooseNotice)).toBeNull()
  })
})

describe('F2 · F3 — 품절과 없는 조합은 다르다', () => {
  it('calls an out-of-stock combination 품절 and refuses the click (F2)', async () => {
    const user = userEvent.setup()
    await renderDetail()

    await user.click(optionButton('색상', '블랙'))

    const small = optionButton('사이즈', 'S')

    expect(small).toHaveAttribute('aria-disabled', 'true')
    expect(within(small).getByText(copy.options.soldOut)).toBeVisible()

    await user.click(small)

    expect(small).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls a combination nobody made something else (F3)', async () => {
    const user = userEvent.setup()
    await renderDetail()

    await user.click(optionButton('색상', '카멜'))

    const large = optionButton('사이즈', 'L')

    expect(large).toHaveAttribute('aria-disabled', 'true')
    // The two words differ on purpose: 품절 is a thing to wait for and this is
    // not, and a shopper's next move is different for each.
    expect(within(large).getByText(copy.options.missing)).toBeVisible()
    expect(within(large).queryByText(copy.options.soldOut)).toBeNull()
  })

  it('keeps a disabled choice reachable by keyboard, so the reason can be read', async () => {
    const user = userEvent.setup()
    await renderDetail()

    await user.click(optionButton('색상', '카멜'))

    // `aria-disabled`, not `disabled` — a control nobody can tab to is a control
    // whose reason nobody hears (`docs/design/pages.md`).
    const large = optionButton('사이즈', 'L')

    expect(large).not.toBeDisabled()
    expect(large).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers deselection as the way out of a dead end', async () => {
    const user = userEvent.setup()
    await renderDetail()

    await user.click(optionButton('사이즈', 'XL'))

    // 카멜·XL 은 없다. 카멜을 원하면 XL 을 먼저 푼다 — 이미 고른 값을 다시 누르면
    // 풀린다는 것이 `aria-pressed` 가 말하는 것이다.
    expect(optionButton('색상', '카멜')).toHaveAttribute('aria-disabled', 'true')

    await user.click(optionButton('사이즈', 'XL'))

    expect(optionButton('사이즈', 'XL')).toHaveAttribute('aria-pressed', 'false')
    expect(optionButton('색상', '카멜')).toHaveAttribute('aria-disabled', 'false')

    await user.click(optionButton('색상', '카멜'))

    expect(optionButton('색상', '카멜')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('F4 밀도 3단계', () => {
  it('folds the attribute table at the minimal step and opens it at the others', async () => {
    const { unmount } = await renderDetail(product.id, { density: 1 })

    expect(screen.getByText(copy.info.attributesToggle)).toBeVisible()

    unmount()
    await renderDetail(product.id, { density: 3 })

    expect(screen.queryByText(copy.info.attributesToggle)).toBeNull()
    expect(screen.getByText('울 혼용률')).toBeVisible()
  })

  it('shows only the leading rows at the standard step', async () => {
    await renderDetail(product.id, { density: 2 })

    expect(screen.getByText('브랜드')).toBeVisible()
    // Six attributes, four rows at this step.
    expect(screen.queryByText('착용 계절')).toBeNull()
  })

  it('says more about shipping as the density grows', async () => {
    const { unmount } = await renderDetail(product.id, { density: 1 })

    expect(screen.getByText(copy.info.shippingMinimal)).toBeVisible()

    unmount()
    await renderDetail(product.id, { density: 3 })

    expect(screen.getByText(copy.info.shippingDetailed)).toBeVisible()
  })

  it('adds the recommendation slot only at the maximal step', async () => {
    const { unmount } = await renderDetail(product.id, { density: 2 })

    expect(screen.queryByText(copy.info.recommendationsLabel)).toBeNull()

    unmount()
    await renderDetail(product.id, { density: 3 })

    expect(screen.getByText(copy.info.recommendationsLabel)).toBeVisible()
  })

  it.each(DENSITY_LEVELS)('draws a price and the options at density %s', async (level) => {
    await renderDetail(product.id, { density: level })

    expect(screen.getByRole('heading', { level: 1, name: product.name })).toBeVisible()
    expect(screen.getByRole('group', { name: '색상' })).toBeVisible()
  })
})

describe('F5 갤러리', () => {
  it('offers a thumbnail per image and moves the strip', async () => {
    const user = userEvent.setup()
    await renderDetail()

    const thumbnails = screen.getByRole('list', { name: copy.gallery.thumbnailsLabel })
    const items = within(thumbnails).getAllByRole('button')

    expect(items).toHaveLength(product.images.length)

    // jsdom has no layout, so the scroll itself cannot be measured — what can be
    // is that the control exists and is operable.
    await user.click(items[1]!)

    expect(items[1]).toBeInTheDocument()
  })

  it('toggles the zoom, and says which state it is in', async () => {
    const user = userEvent.setup()
    await renderDetail()

    const zoom = screen.getByRole('button', { name: copy.gallery.zoomIn })

    await user.click(zoom)

    expect(await screen.findByRole('button', { name: copy.gallery.zoomOut })).toBeVisible()
  })

  it('draws no thumbnail strip for a single image', async () => {
    await renderDetail(storefrontProductWithoutOptions.product.id)

    expect(screen.queryByRole('list', { name: copy.gallery.thumbnailsLabel })).toBeNull()
  })
})

describe('F5b · F5c — 모바일 구매 바', () => {
  it('shows the fixed bar at 360px and no side panel', async () => {
    await renderDetail(product.id, { width: VIEWPORTS.mobile })

    // One purchase area, not two. The compact form drops the quantity stepper,
    // which is what tells the two apart.
    expect(screen.getAllByRole('button', { name: copy.purchase.addToCart })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: copy.purchase.increase })).toBeNull()
  })

  it('shows the panel with its quantity stepper on a desktop', async () => {
    await renderDetail(product.id, { width: VIEWPORTS.desktop })

    expect(screen.getAllByRole('button', { name: copy.purchase.addToCart })).toHaveLength(1)
    expect(screen.getByRole('button', { name: copy.purchase.increase })).toBeVisible()
  })

  it('keeps 바로 구매 reachable and says why it is inert', async () => {
    // 담기는 이제 실제로 담는다 (TASK-0046 4.5). 남은 것은 「바로 구매」이고,
    // TASK-0023 4장대로 **보이되 비활성이고 그 이유가 붙어 있다** — `aria-disabled`
    // 라 탭 순서에 남아서 그 이유를 읽을 수 있다.
    await renderDetail()

    const buyNow = screen.getByRole('button', { name: copy.purchase.buyNow })

    expect(buyNow).toHaveAttribute('aria-disabled', 'true')
    expect(buyNow).not.toBeDisabled()
    expect(screen.getByText(copy.purchase.comingSoon)).toBeVisible()
  })

  it('refuses 담기 until a combination is chosen, without taking its tab stop', async () => {
    // 조합이 정해지기 전에는 담을 것이 없다. 그래도 `aria-disabled` 인 이유는
    // 키보드로 그 자리에 닿을 수 있어야 하기 때문이고 — 이유는 바로 위의 옵션
    // 영역이 말한다 — 그것이 TASK-0023 4장이 정한 방식이다.
    await renderDetail()

    const add = screen.getByRole('button', { name: copy.purchase.addToCart })

    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).not.toBeDisabled()
  })
})

describe('F6 아홉 조합', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom paints nothing, so 「깨짐 0건」 cannot be measured
   * as pixels — what can be measured is that every combination is a *complete*
   * screen: a heading, a price, the option axes, and **exactly one** purchase
   * area. The last one is F5c, and it is the failure that a CSS-hidden second
   * copy would produce.
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      Object.entries(VIEWPORTS).map(([name, width]) => [density, name, width] as const),
    ),
  )('density %s at %s', async (density, _name, width) => {
    await renderDetail(product.id, { density, width })

    expect(screen.getByRole('heading', { level: 1, name: product.name })).toBeVisible()
    expect(screen.getByRole('group', { name: '색상' })).toBeVisible()
    expect(screen.getByRole('group', { name: '사이즈' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: copy.purchase.addToCart })).toHaveLength(1)
    expect(screen.getByText('25%')).toBeVisible()
  })
})

describe('F7 SEO', () => {
  it('titles and describes the page with the brand and the name', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: product.id }) })

    expect(meta.title).toBe(copy.metaTitle.replace('{name}', product.name))
    expect(meta.description).toContain(detail.seller.brandName)
    expect(meta.alternates?.canonical).toBe(`/products/${product.id}`)
  })

  it('carries a Product with an offer range built from what is orderable', async () => {
    const { container } = await renderDetail()

    const script = container.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(script?.textContent ?? '{}') as {
      '@type': string
      brand: { name: string }
      offers: { lowPrice: number; offerCount: number; availability: string }
      aggregateRating?: { reviewCount: number }
    }

    expect(data['@type']).toBe('Product')
    expect(data.brand.name).toBe(detail.seller.brandName)
    // Nine of the ten variants are orderable; 블랙·S is out of stock, and an
    // offer range including it would promise a price nobody can pay.
    expect(data.offers.offerCount).toBe(9)
    expect(data.offers.availability).toBe('https://schema.org/InStock')
    expect(data.aggregateRating?.reviewCount).toBe(product.ratingCount)
  })

  it('claims no rating for a product nobody has reviewed', async () => {
    const { container } = await renderDetail(storefrontProductWithoutOptions.product.id)

    const script = container.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(script?.textContent ?? '{}') as { aggregateRating?: unknown }

    // Google rejects a rating with a zero count, and a `0` would be a claim the
    // page does not make.
    expect(data.aggregateRating).toBeUndefined()
  })
})

describe('F9 비공개 상품', () => {
  it('is a 404 for an id the storefront does not serve', async () => {
    await expect(
      ProductPage({ params: Promise.resolve({ id: '019596d0-1f1c-7c2e-9a0e-00000000dead' }) }),
    ).rejects.toThrow()
  })
})

describe('판매자', () => {
  it('links the brand page', async () => {
    await renderDetail()

    expect(
      screen.getByRole('link', {
        name: copy.brandLink.replace('{brand}', detail.seller.brandName),
      }),
    ).toHaveAttribute('href', `/brands/${detail.seller.id}`)
  })
})

describe('가격', () => {
  it('shows the discount against the struck-through list price', async () => {
    await renderDetail()

    // 158,000 → 118,000 은 25% 다.
    expect(screen.getByText('25%')).toBeVisible()
    await waitFor(() => {
      expect(screen.getByText('₩158,000')).toBeVisible()
    })
  })
})
