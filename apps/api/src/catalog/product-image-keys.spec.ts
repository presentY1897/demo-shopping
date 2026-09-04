import { describe, expect, it } from 'vitest'

import { foreignImageIndexes, productImageOwner } from './product-image-keys.js'

/**
 * What the bucket sweep's safety rests on.
 *
 * A false `null` here is a cross-store reference the save lets through, and the
 * damage shows up much later and somewhere else: the other store's sweep
 * deletes an object this product is displaying. A false *match* is the opposite
 * mistake and just as bad — a seller who cannot save a stock photograph.
 */

const STORE = '0199c4a2-0000-7abc-8def-00000000aaaa'
const OTHER = '0199c4a2-0000-7abc-8def-00000000bbbb'
const OBJECT = '11111111-2222-4333-8444-555555555555'

function ourUrl(sellerId: string, extension = 'jpg'): string {
  return `https://cdn.test.invalid/products/${sellerId}/${OBJECT}.${extension}`
}

describe('productImageOwner — 우리 키인가, 누구 것인가', () => {
  it('reads the store out of a key this API issued', () => {
    expect(productImageOwner(ourUrl(STORE))).toBe(STORE)
  })

  it('reads it for every extension the upload rules allow', () => {
    for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
      expect(productImageOwner(ourUrl(STORE, extension))).toBe(STORE)
    }
  })

  it('answers null for an external image', () => {
    // Seeded listings use stock photography (DECISIONS 13). Those URLs are
    // nobody's key, no sweep will ever look at them, and refusing them would
    // make 780 of the 800 demo products unsavable.
    expect(productImageOwner('https://images.unsplash.com/photo-1520.jpg')).toBeNull()
  })

  it('answers null for something shaped like a key but not one', () => {
    expect(productImageOwner('https://cdn.test.invalid/products/not-a-uuid/x.jpg')).toBeNull()
    expect(productImageOwner(`https://cdn.test.invalid/products/${STORE}/${OBJECT}.gif`)).toBeNull()
    expect(productImageOwner(`https://cdn.test.invalid/products/${STORE}/${OBJECT}`)).toBeNull()
  })

  it('handles a public base URL that carries a path of its own', () => {
    expect(productImageOwner(`https://cdn.test.invalid/bucket/products/${STORE}/${OBJECT}.png`)) //
      .toBe(STORE)
  })

  it('handles a bare key, with or without a leading slash', () => {
    expect(productImageOwner(`products/${STORE}/${OBJECT}.webp`)).toBe(STORE)
    expect(productImageOwner(`/products/${STORE}/${OBJECT}.webp`)).toBe(STORE)
  })

  it('answers null for a string that is not a URL at all', () => {
    expect(productImageOwner('  ')).toBeNull()
  })
})

describe('foreignImageIndexes', () => {
  it('names every position that belongs to another store', () => {
    const images = [
      { url: ourUrl(STORE) },
      { url: 'https://images.unsplash.com/photo-1520.jpg' },
      { url: ourUrl(OTHER) },
    ]

    // Positions rather than a boolean, because the answer becomes
    // `details[].field = images.2.url` and a form has to mark the row the person
    // can actually see.
    expect(foreignImageIndexes(images, STORE)).toEqual([2])
  })

  it('is empty when every image is this store’s or nobody’s', () => {
    expect(foreignImageIndexes([{ url: ourUrl(STORE) }], STORE)).toEqual([])
    expect(foreignImageIndexes([], STORE)).toEqual([])
  })
})
