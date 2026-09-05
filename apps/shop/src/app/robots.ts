import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/seo/site'

/**
 * `robots.txt` (TASK-0102 F5).
 *
 * **The account screens are disallowed, the search screen is not.** They are
 * different refusals: `/mypage` holds one person's data and a crawler has no
 * business fetching it at all, while `/search` is public content that simply
 * should not be *indexed* — and that is said with a `noindex` on the page, not
 * here. Disallowing a URL stops the crawl, which means the `noindex` on it is
 * never read, which means the page can stay in an index it should have left.
 *
 * The sitemap is named absolutely, because a crawler that found this file from
 * another host has no base to resolve a relative path against.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Personal, and behind a sign-in anyway. Nothing to gain by fetching it.
        disallow: ['/mypage', '/mypage/', '/login', '/cart'],
      },
    ],
    sitemap: siteUrl('/sitemap.xml'),
  }
}
