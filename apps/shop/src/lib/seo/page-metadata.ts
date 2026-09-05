import type { Metadata } from 'next'

/**
 * 페이지 유형별 메타데이터 규약 (TASK-0102 4장).
 *
 * The table in the task lists four kinds of page and what each owes. Written
 * once, here, so a new screen picks a kind rather than assembling a
 * `Metadata` object and forgetting the half nobody notices is missing.
 *
 * | 유형 | 색인 | canonical |
 * | --- | --- | --- |
 * | `indexed` | ✓ | 자기 자신 |
 * | `canonicalTo` | ✓ | 다른 URL — 필터가 걸린 목록이 기본 URL 을 가리킨다 |
 * | `hidden` | **noindex** | 없음 |
 *
 * **`noindex` 와 canonical 을 같이 걸지 않는다.** 둘은 서로 다른 말을 한다 —
 * 「이 페이지를 색인하지 마라」와 「이 페이지의 신호를 저쪽으로 보내라」 — 그리고
 * 함께 걸면 크롤러가 저쪽까지 색인에서 뺄 수 있다. 필터 조합처럼 「색인은 하지
 * 말되 신호는 기본 URL 로」인 경우는 **canonical 만** 건다.
 */

export interface PageMetadataInput {
  readonly title: string
  readonly description: string
  /** The page's own path, absolute from the root: `/products/x`. */
  readonly path: string
  readonly images?: readonly string[]
}

/** Indexed, canonical to itself. Home, category, product, brand. */
export function indexedMetadata(input: PageMetadataInput): Metadata {
  return {
    ...openGraph(input),
    alternates: { canonical: input.path },
  }
}

/**
 * Indexed content that lives at several addresses — a category with filters on.
 *
 * The canonical points at the plain URL so the hundreds of filter combinations
 * an auto-generated panel can produce (TASK-0039) do not become hundreds of
 * near-identical pages competing with each other.
 */
export function canonicalToMetadata(input: PageMetadataInput, canonical: string): Metadata {
  return {
    ...openGraph(input),
    alternates: { canonical },
  }
}

/** Never indexed: search results, the account screens. */
export function hiddenMetadata(input: Omit<PageMetadataInput, 'path'>): Metadata {
  return {
    title: input.title,
    description: input.description,
    robots: { index: false, follow: true },
  }
}

/**
 * `follow: true` on a hidden page is deliberate.
 *
 * A search result page is not worth indexing, but the product links on it are
 * worth following — telling a crawler to ignore them would cut off a path into
 * the catalogue for no gain.
 */
function openGraph(input: PageMetadataInput): Metadata {
  return {
    title: input.title,
    description: input.description,
    openGraph: {
      title: input.title,
      description: input.description,
      url: input.path,
      type: 'website',
      ...(input.images === undefined ? {} : { images: [...input.images] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      ...(input.images === undefined ? {} : { images: [...input.images] }),
    },
  }
}
