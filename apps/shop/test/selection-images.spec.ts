import type { Product } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { imagesForSelection } from '@/lib/products/selection-images'

const product: Pick<Product, 'images' | 'options'> = {
  images: [{ id: 'base', url: '/camel.png', alt: '카멜', sortOrder: 0 }],
  options: [
    {
      id: 'color',
      name: '색상',
      sortOrder: 0,
      values: [
        {
          id: 'navy',
          value: '네이비',
          sortOrder: 0,
          meta: {
            gallery: JSON.stringify([
              { url: '/navy.png', alt: '네이비' },
              { url: '/navy-model.png' },
            ]),
          },
        },
      ],
    },
    {
      id: 'material',
      name: '소재',
      sortOrder: 1,
      values: [
        { id: 'wool', value: '울', sortOrder: 0, meta: null },
        {
          id: 'herringbone',
          value: '헤링본',
          sortOrder: 1,
          meta: {
            galleryPriority: 10,
            gallery: JSON.stringify([{ url: '/herringbone.png', alt: '헤링본' }]),
          },
        },
      ],
    },
  ],
}

describe('imagesForSelection', () => {
  it('keeps the original gallery before a visual option is selected', () => {
    expect(imagesForSelection(product, {})).toBe(product.images)
    expect(imagesForSelection(product, { material: 'wool' })).toBe(product.images)
  })

  it('switches all photos with the selected color and preserves order and alt text', () => {
    const images = imagesForSelection(product, { color: 'navy', material: 'wool' })
    expect(images.map((image) => image.url)).toEqual(['/navy.png', '/navy-model.png'])
    expect(images.map((image) => image.sortOrder)).toEqual([0, 1])
    expect(images[0]?.alt).toBe('네이비')
    expect(new Set(images.map((image) => image.id)).size).toBe(2)
  })

  it('uses the material gallery and restores the color gallery when material is changed back', () => {
    expect(imagesForSelection(product, { color: 'navy', material: 'herringbone' })[0]?.url).toBe(
      '/herringbone.png',
    )
    expect(imagesForSelection(product, { color: 'navy', material: 'wool' })[0]?.url).toBe(
      '/navy.png',
    )
  })

  it.each(['not json', '{}', '[]', '[{"url":42}]'])(
    'ignores malformed presentation metadata: %s',
    (gallery) => {
      const changed = structuredClone(product)
      const value = changed.options[0]?.values[0]
      if (value !== undefined) value.meta = { gallery }
      expect(imagesForSelection(changed, { color: 'navy' })).toBe(changed.images)
    },
  )
})
