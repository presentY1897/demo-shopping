/**
 * 이 상점의 절대 주소 (TASK-0102).
 *
 * **Absolute URLs are not a preference here.** A canonical, an Open Graph image
 * and a sitemap entry are all read by something that is not this browser: a
 * relative `/products/x` in a sitemap is meaningless to a crawler, and a
 * relative OG image never renders in a link preview. Next resolves `canonical`
 * against `metadataBase`, which is what this feeds.
 *
 * The default is the origin `render.yaml` already grants CORS to, so a
 * deployment that forgets the variable still emits the right host rather than
 * `localhost`. A preview deployment sets it to its own URL.
 */

const FALLBACK_ORIGIN = 'https://shop.demo-shopping.com'

/** The origin, with no trailing slash. */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL

  return (configured === undefined || configured.trim() === '' ? FALLBACK_ORIGIN : configured)
    .trim()
    .replace(/\/+$/, '')
}

export function siteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * `metadataBase`, which every relative `alternates.canonical` is resolved
 * against. Set once on the root layout.
 */
export function metadataBase(): URL {
  return new URL(siteOrigin())
}
