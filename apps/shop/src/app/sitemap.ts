import type { SearchHit } from '@shopping/shared'
import type { MetadataRoute } from 'next'

import { fetchStorefrontCategories } from '@/lib/categories/storefront-api'
import { fetchSection } from '@/lib/products/section-api'
import { flattenCategories } from '@/lib/categories/category-tree'
import { SITEMAP_REVALIDATE_SECONDS } from '@/lib/seo/revalidate'
import { siteUrl } from '@/lib/seo/site'

/**
 * `sitemap.xml` (TASK-0102 F3 · 4.1).
 *
 * **This is the index path, and the home page is not.** The storefront's home
 * reads its product rows in the browser (TASK-0101 F4 — the API can take ninety
 * seconds to wake and a server render would meet that with a five second
 * timeout), so a crawler that only followed links from it would find few
 * products. A sitemap hands over the list directly, which is what it is for.
 *
 * **A failure is a shorter sitemap, never a 500.** A crawler that gets an error
 * may back off for days; one that gets the static pages and no products comes
 * back tomorrow and finds them. So every read is guarded and the static entries
 * are always there.
 *
 * Regenerated on the same cadence as the pages it lists.
 */
/**
 * Next requires this to be a **literal** — an imported constant is rejected with
 * 「Invalid segment configuration export」. So the number is written twice, and
 * `isr-window.spec.ts` is what keeps the two equal: the page's literal is
 * compared against {@link SITEMAP_REVALIDATE_SECONDS}, which is the value the fetch below asks for.
 */
export const revalidate = 3600

/** How many listings the sitemap carries. */
const PRODUCT_LIMIT = 200

/** The listings the sitemap is built from — products and, through them, brands. */
async function storefrontListings(): Promise<readonly SearchHit[]> {
  try {
    const answer = await fetchSection(
      { sort: 'newest', limit: PRODUCT_LIMIT },
      { revalidate: SITEMAP_REVALIDATE_SECONDS },
    )

    return answer.items
  } catch {
    return []
  }
}

async function categoryEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const { nodes } = await fetchStorefrontCategories({
      revalidate: SITEMAP_REVALIDATE_SECONDS,
    })

    // The whole tree, not only the roots: a leaf category is a page with its own
    // filters and its own listings, and it is the one a shopper lands on.
    return flattenCategories(nodes).map((node) => ({
      url: siteUrl(`/categories/${node.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))
  } catch {
    return []
  }
}

/**
 * The brand pages, derived from the listings rather than enumerated.
 *
 * There is no public 「every store」 endpoint and this is not the reason to add
 * one: a store with nothing for sale is a brand page with an empty list, and a
 * sitemap that offered it would be sending a crawler to a dead end. Deriving
 * from the same listings the sitemap already carries means every brand page
 * named here has something on it.
 */
function brandEntries(products: readonly { readonly sellerId: string }[]): MetadataRoute.Sitemap {
  return [...new Set(products.map((product) => product.sellerId))].map((sellerId) => ({
    url: siteUrl(`/brands/${sellerId}`),
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [listings, categories] = await Promise.all([storefrontListings(), categoryEntries()])

  return [
    { url: siteUrl('/'), changeFrequency: 'daily', priority: 1 },
    ...categories,
    ...listings.map((hit) => ({
      url: siteUrl(`/products/${hit.id}`),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...brandEntries(listings),
  ]
}
