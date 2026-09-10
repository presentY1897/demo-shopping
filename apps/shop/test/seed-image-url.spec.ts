import { describe, expect, it } from 'vitest'
import { productImageUrl } from '@/lib/products/seed-image-url'

describe('legacy catalogue image mirror', () => {
  const file = '8a339cd2282243e9aaf043e297815b91.svg'
  it('serves the original content-addressed asset for the observed missing URL', () => {
    expect(productImageUrl(`https://cdn.demo-shopping.com/seed/catalog/${file}`)).toBe(
      `/seed/catalog/${file}`,
    )
  })
  it.each([
    `https://other.example/seed/catalog/${file}`,
    'https://cdn.demo-shopping.com/seed/catalog/00000000000000000000000000000000.svg',
    `https://cdn.demo-shopping.com/seed/catalog/${file}?version=2`,
    `https://cdn.demo-shopping.com/products/${file}`,
    'https://cdn.demo-shopping.com/products/product.png',
    '/images/local.webp',
  ])('preserves unknown or independently hosted images: %s', (src) => {
    expect(productImageUrl(src)).toBe(src)
  })
})
