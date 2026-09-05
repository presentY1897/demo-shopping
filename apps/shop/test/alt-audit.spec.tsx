/**
 * 이미지 alt 전수 점검 (TASK-0102 F7).
 *
 * axe already fails an image with no accessible name on every screen this repo
 * checks, so this is not a second opinion — it is a **sweep**. axe reports the
 * first violation per rule with the nodes it found; this counts every `<img>` on
 * every storefront screen and names the ones without an `alt` attribute at all,
 * which is the form the failure takes when somebody adds an image in a hurry.
 *
 * `alt=""` passes on purpose. A decorative image — the thumbnail strip's
 * previews, which sit inside a button that already has a name — must have an
 * empty alt, not a description, or a screen reader reads the same name twice.
 */

import { storefrontProductDetail, storefrontSeller } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { navigation } from './support/navigation'
import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const HomePage = (await import('@/app/page')).default
const ProductPage = (await import('@/app/products/[id]/page')).default
const BrandPage = (await import('@/app/brands/[sellerId]/page')).default

const messages = messagesFor()

/** Every image on the page that carries no `alt` attribute at all. */
function imagesWithoutAlt(): readonly string[] {
  return [...document.querySelectorAll('img')]
    .filter((image) => !image.hasAttribute('alt'))
    .map((image) => image.getAttribute('src') ?? '(no src)')
}

beforeEach(() => {
  localStorage.clear()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F7 alt 누락 0건', () => {
  it('on the home, once its sections have arrived', async () => {
    renderWithAuth(
      <DensityProvider>
        <HomePage />
      </DensityProvider>,
    )

    await screen.findByRole('list', {
      name: messages.home.gridLabel.replace('{title}', messages.home.newTitle),
    })

    expect(imagesWithoutAlt()).toEqual([])
  })

  it('on a product, gallery and thumbnails included', async () => {
    navigation.start(`/products/${storefrontProductDetail.product.id}`)

    render(
      <DensityProvider>
        {await ProductPage({ params: Promise.resolve({ id: storefrontProductDetail.product.id }) })}
      </DensityProvider>,
    )

    // The gallery has one described image per slide and a strip of decorative
    // thumbnails — both forms have to be present for this to mean anything.
    expect(document.querySelectorAll('img').length).toBeGreaterThan(1)
    expect(imagesWithoutAlt()).toEqual([])
  })

  it('on a brand page, logo included', async () => {
    navigation.start(`/brands/${storefrontSeller.seller.id}`)

    render(
      <DensityProvider>
        {await BrandPage({ params: Promise.resolve({ sellerId: storefrontSeller.seller.id }) })}
      </DensityProvider>,
    )

    await screen.findByRole('list', { name: messages.search.list.gridLabel })

    expect(imagesWithoutAlt()).toEqual([])
  })

  it('gives a decorative thumbnail an empty alt rather than a description', async () => {
    navigation.start(`/products/${storefrontProductDetail.product.id}`)

    render(
      <DensityProvider>
        {await ProductPage({ params: Promise.resolve({ id: storefrontProductDetail.product.id }) })}
      </DensityProvider>,
    )

    const thumbnails = screen.getByRole('list', {
      name: messages.productDetail.gallery.thumbnailsLabel,
    })

    // The button around it already carries the name. A described image inside
    // would have a screen reader say it twice.
    for (const image of thumbnails.querySelectorAll('img')) {
      expect(image.getAttribute('alt')).toBe('')
    }
  })
})
