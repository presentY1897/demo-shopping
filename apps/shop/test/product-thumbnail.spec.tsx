import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductThumbnail } from '@/components/products/product-thumbnail'

describe('snapshot thumbnails', () => {
  it.each([null, '', '   '])('shows a placeholder for absent URL %s', (src) => {
    const { container } = render(<ProductThumbnail src={src} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
  it('replaces a failed image and can render a new snapshot URL', () => {
    const { container, rerender } = render(
      <ProductThumbnail src="https://example.com/broken.png" />,
    )
    const image = container.querySelector('img')!
    fireEvent.error(image)
    expect(container.querySelector('img')).toBeNull()
    rerender(<ProductThumbnail src="https://example.com/valid.png" />)
    expect(container.querySelector('img')?.src).toBe('https://example.com/valid.png')
  })
})
