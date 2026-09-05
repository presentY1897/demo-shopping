import type { MetadataRoute } from 'next'

/**
 * 콘솔은 전부 색인하지 않는다 (TASK-0102 F5, DECISIONS 1장).
 *
 * The layout already sets `robots: { index: false }` on every page, and this is
 * the other half: that meta tag is only read once a page has been fetched, and a
 * console has no page worth fetching. Both, because either alone leaves a gap —
 * a `Disallow` that a crawler ignores still meets the meta tag, and a meta tag
 * on a page nobody crawls does nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] }
}
