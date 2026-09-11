import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ProductThumbnail } from './product-thumbnail'

describe('ProductThumbnail', () => {
  it('retains a stable footprint for missing and failed sources and displays a new source', () => {
    const { container, rerender } = render(<ProductThumbnail src={null} className="size-12" />)
    expect(container.querySelector('img')).toBeNull()
    rerender(<ProductThumbnail src="https://images.example/a.webp" className="size-12" />)
    const image = container.querySelector('img')!
    fireEvent.error(image)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<ProductThumbnail src="https://images.example/b.webp" className="size-12" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://images.example/b.webp',
    )
  })
})
