import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CategoryBreadcrumb } from '@/components/categories/category-breadcrumb'
import { CategoryWorkspace } from '@/components/categories/category-workspace'
import { categoryLineage, findCategoryBySlug } from '@/lib/categories/category-tree'
import { fetchStorefrontCategories } from '@/lib/categories/storefront-api'
import { CATALOGUE_REVALIDATE_SECONDS } from '@/lib/seo/revalidate'
import { canonicalToMetadata } from '@/lib/seo/page-metadata'
import { messagesFor } from '@/messages'
import { PageContainer } from '@shopping/ui/layout'

/**
 * 카테고리 화면 (TASK-0042).
 *
 * **Server rendered**, which `docs/design/pages.md` requires of it: the page is
 * indexed, and a crawler runs no JavaScript. The tree is read with the public
 * client — no session, because `GET /categories/tree` needs none (4.2) — so the
 * render needs nothing from the browser.
 *
 * What is server rendered is the *frame*: the lineage, the heading, the child
 * shortcuts and the structured data. The list itself is a client component,
 * because it is the search screen's, and its filters live in the query string.
 *
 * **An unknown or retired slug is a 404, not a page.** The tree the API serves
 * contains active categories only, so "not in the tree" and "must not be shown"
 * are the same condition here — which is what keeps F4 and F5 from being two
 * different checks that could disagree.
 */

async function resolve(slug: string) {
  const { nodes } = await fetchStorefrontCategories({
    revalidate: CATALOGUE_REVALIDATE_SECONDS,
  })
  const category = findCategoryBySlug(nodes, slug)

  if (category === null) notFound()

  return { category, lineage: categoryLineage(nodes, category) }
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const copy = messagesFor().category

  const { category } = await resolve(slug)

  // The canonical is the filter-free URL even when filters are on: every
  // combination the auto-generated panel can produce is a different address for
  // the same catalogue, and hundreds of them indexed separately is duplicate
  // content (TASK-0102 4장).
  return canonicalToMetadata(
    {
      title: copy.metaTitle.replace('{name}', category.name),
      description: copy.metaDescription.replace('{name}', category.name),
      path: `/categories/${category.slug}`,
    },
    `/categories/${category.slug}`,
  )
}

export default async function CategoryPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}) {
  const { slug } = await params
  const messages = messagesFor()
  const copy = messages.category

  const { category, lineage } = await resolve(slug)

  /**
   * `BreadcrumbList`, which is the one piece of structured data this page can
   * state as fact. A `Product` list would be a claim about prices and stock that
   * the server render does not have — the results arrive in the browser — and
   * structured data that disagrees with the page is worse than none.
   */
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: lineage.map((node, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: node.name,
      item: `/categories/${node.slug}`,
    })),
  }

  return (
    <PageContainer className="flex flex-col gap-4 py-6">
      {/*
        `JSON.stringify` of this file's own object — nothing user-supplied
        reaches it, and a category name is escaped by `stringify` in any case.
        JSON-LD has no other form: a `<script>` with children would be React
        text nodes, which is not what a parser reads.
      */}
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        type="application/ld+json"
      />

      <div className="flex flex-col gap-3">
        <CategoryBreadcrumb lineage={lineage} messages={copy} />
        <h1 className="text-2xl font-bold">{category.name}</h1>

        {category.children.length === 0 ? null : (
          <nav aria-label={copy.subcategoriesLabel}>
            <ul className="flex flex-wrap gap-2">
              {category.children.map((child) => (
                <li key={child.id}>
                  <Link
                    className="border-border bg-surface text-fg hover:bg-surface-muted min-h-touch inline-flex items-center rounded-md border px-3 text-sm"
                    href={`/categories/${child.slug}`}
                  >
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      <CategoryWorkspace categoryId={category.id} messages={messages.search} />
    </PageContainer>
  )
}
