import { storefrontProductDetail } from '@shopping/api-mocks'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProductGallery } from '@/components/products/product-gallery'
import { messagesFor } from '@/messages'

const messages = messagesFor().productDetail.gallery
const product = storefrontProductDetail.product

describe('missing product photography', () => {
  it('shows the shared placeholder when no image was uploaded', () => {
    render(<ProductGallery images={[]} productName={product.name} messages={messages} />)
    expect(screen.getByRole('img', { name: messages.empty })).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('replaces a broken image and can show a different variant image afterwards', () => {
    const first = { ...product.images[0]!, alt: 'first product view' }
    const { rerender } = render(
      <ProductGallery images={[first]} productName={product.name} messages={messages} />,
    )
    fireEvent.error(screen.getByRole('img', { name: first.alt }))
    expect(screen.getByRole('img', { name: messages.empty })).toBeVisible()
    rerender(
      <ProductGallery
        images={[{ ...first, url: 'https://example.com/new-color.png' }]}
        productName={product.name}
        messages={messages}
      />,
    )
    expect(screen.getByRole('img', { name: first.alt })).toHaveAttribute(
      'src',
      'https://example.com/new-color.png',
    )
    expect(screen.queryByRole('img', { name: messages.empty })).toBeNull()
  })
})
