import { productImageInputSchema } from '@shopping/shared'
import type { Product, ProductImage } from '@shopping/shared'

import type { Selection } from './variant-selection'

const gallerySchema = productImageInputSchema.array().min(1).max(10)

/** Option presentation metadata can provide a gallery; material overrides color by priority. */
export function imagesForSelection(
  product: Pick<Product, 'images' | 'options'>,
  selection: Selection,
): ProductImage[] {
  let selected: { images: ProductImage[]; priority: number } | null = null

  for (const option of product.options) {
    const value = option.values.find((candidate) => candidate.id === selection[option.id])
    const encoded = value?.meta?.gallery
    if (value === undefined || typeof encoded !== 'string') continue

    try {
      const parsed = gallerySchema.safeParse(JSON.parse(encoded) as unknown)
      if (!parsed.success) continue

      const rawPriority = value.meta?.galleryPriority
      const priority =
        typeof rawPriority === 'number' && Number.isFinite(rawPriority) ? rawPriority : 0
      if (selected !== null && selected.priority >= priority) continue

      selected = {
        priority,
        images: parsed.data.map((image, sortOrder) => ({
          id: `${value.id}:${String(sortOrder)}`,
          url: image.url,
          alt: image.alt ?? null,
          sortOrder,
        })),
      }
    } catch {
      // Optional display metadata must not prevent choosing or buying a product.
    }
  }

  return selected?.images ?? product.images
}
