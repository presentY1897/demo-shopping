/**
 * 카테고리 화면 (TASK-0042 F1–F7).
 *
 * The page is a server component, so it is awaited and rendered as one. What it
 * produces is the *frame* — the lineage, the heading, the child shortcuts, the
 * structured data — and a client workspace that is the search screen's own
 * component, which is what F3 「검색 페이지와 동일한 필터 동작」 comes down to:
 * not two implementations that agree, one implementation.
 */

import { storefrontCategoryTree } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { navigation } from './support/navigation'
import { stubViewport, VIEWPORTS } from './support/viewport'

/**
 * The factory imports its own dependency.
 *
 * `vi.mock` is hoisted above every import in the file, so a factory that closes
 * over a top-level binding runs before that binding exists — which surfaces as
 * `Cannot access '__vi_import_N__' before initialization`, blamed on whichever
 * component imported `next/navigation` first. An async factory with its own
 * `import` is evaluated when the mock is first needed, by which time it is.
 */
vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CategoryPage, generateMetadata } = await import('@/app/categories/[slug]/page')

const messages = messagesFor()
const copy = messages.category
const search = messages.search

/** 여성 → 아우터 → 코트, which is where the search double's listings hang. */
const ROOT = storefrontCategoryTree.nodes[0]!
const SECTION = ROOT.children[0]!
const LEAF = SECTION.children[0]!

async function renderCategory(slug: string, width: number = VIEWPORTS.desktop) {
  stubViewport(width)
  navigation.start(`/categories/${slug}`)

  return render(
    <DensityProvider>{await CategoryPage({ params: Promise.resolve({ slug }) })}</DensityProvider>,
  )
}

async function productNames(): Promise<string[]> {
  const list = await screen.findByRole('list', { name: search.list.gridLabel })

  return within(list)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
  navigation.push.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 하위 포함', () => {
  it('shows everything under a top-level category', async () => {
    await renderCategory(ROOT.slug)

    // Nothing hangs on 여성 itself. The three coats are two levels below it, and
    // a filter that matched the category exactly would answer with none of them.
    await waitFor(async () => {
      expect(await productNames()).toEqual(
        expect.arrayContaining(['오버핏 싱글 코트', '슬림 더블 코트', '경량 발마칸 코트']),
      )
    })
  })

  it('shows the same listings from the section between (F1)', async () => {
    await renderCategory(SECTION.slug)

    await waitFor(async () => {
      expect(await productNames()).toHaveLength(3)
    })
  })
})

describe('F1b 잎 카테고리', () => {
  it('shows only its own, so 하위 포함 does not become 전부 보여 준다', async () => {
    await renderCategory(LEAF.slug)

    await waitFor(async () => {
      expect(await productNames()).toHaveLength(3)
    })

    // The shoes hang under a different root entirely.
    expect(await productNames()).not.toContain('레트로 러너')
  })
})

describe('F2 브레드크럼', () => {
  it('names the whole lineage and links every step but the last', async () => {
    await renderCategory(LEAF.slug)

    const crumbs = screen.getByRole('navigation', { name: copy.breadcrumbLabel })

    expect(within(crumbs).getByRole('link', { name: copy.homeLabel })).toHaveAttribute('href', '/')
    expect(within(crumbs).getByRole('link', { name: ROOT.name })).toHaveAttribute(
      'href',
      `/categories/${ROOT.slug}`,
    )
    expect(within(crumbs).getByRole('link', { name: SECTION.name })).toHaveAttribute(
      'href',
      `/categories/${SECTION.slug}`,
    )

    // The last one is where you are. A link to the page you are on is a control
    // that does nothing, so it is text with `aria-current` instead.
    expect(within(crumbs).queryByRole('link', { name: LEAF.name })).toBeNull()
    expect(within(crumbs).getByText(LEAF.name)).toHaveAttribute('aria-current', 'page')
  })

  it('offers the children as shortcuts, and none when there are none', async () => {
    const { unmount } = await renderCategory(SECTION.slug)

    const shortcuts = screen.getByRole('navigation', { name: copy.subcategoriesLabel })

    expect(within(shortcuts).getByRole('link', { name: LEAF.name })).toHaveAttribute(
      'href',
      `/categories/${LEAF.slug}`,
    )

    unmount()
    await renderCategory(LEAF.slug)

    expect(screen.queryByRole('navigation', { name: copy.subcategoriesLabel })).toBeNull()
  })
})

describe('F3 필터 일관성', () => {
  it('filters exactly as the search screen does, and puts it in the URL', async () => {
    const user = userEvent.setup()
    await renderCategory(LEAF.slug)

    await user.click(await screen.findByRole('checkbox', { name: /슬림/ }))

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBe('슬림')
    })
    await waitFor(async () => {
      expect(await productNames()).toEqual(['슬림 더블 코트'])
    })
  })

  it('keeps the category in the path and out of the query string', async () => {
    const user = userEvent.setup()
    await renderCategory(LEAF.slug)

    await user.click(await screen.findByRole('checkbox', { name: /슬림/ }))

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBe('슬림')
    })

    // The address says the category once, in the segment. Two copies of one fact
    // in one URL is two things that can disagree.
    expect(navigation.params.get('categoryId')).toBeNull()
    expect(navigation.href).toContain(`/categories/${LEAF.slug}`)
  })
})

describe('F4 · F5 없는 카테고리', () => {
  it('is a 404 for a slug nothing points at (F5)', async () => {
    await expect(
      CategoryPage({ params: Promise.resolve({ slug: 'no-such-thing' }) }),
    ).rejects.toThrow()
  })

  it('is a 404 for a retired category (F4)', async () => {
    // `men-pants-chino` is inactive in the fixture, and the storefront tree
    // never carries it — so "not in the tree" and "must not be shown" are one
    // condition here rather than two that could disagree.
    await expect(
      CategoryPage({ params: Promise.resolve({ slug: 'men-pants-chino' }) }),
    ).rejects.toThrow()
  })
})

describe('F6 SEO', () => {
  it('titles and describes the page with the category’s own name', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: LEAF.slug }) })

    expect(meta.title).toBe(copy.metaTitle.replace('{name}', LEAF.name))
    expect(meta.description).toBe(copy.metaDescription.replace('{name}', LEAF.name))
  })

  it('points the canonical at the filter-free address', async () => {
    // Every filter combination is a different URL for the same catalogue, and
    // hundreds of them indexed separately is duplicate content.
    const meta = await generateMetadata({ params: Promise.resolve({ slug: LEAF.slug }) })

    expect(meta.alternates?.canonical).toBe(`/categories/${LEAF.slug}`)
  })

  it('carries the lineage as structured data', async () => {
    const { container } = await renderCategory(LEAF.slug)

    const script = container.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(script?.textContent ?? '{}') as {
      '@type': string
      itemListElement: { name: string; position: number }[]
    }

    expect(data['@type']).toBe('BreadcrumbList')
    expect(data.itemListElement.map((entry) => entry.name)).toEqual([
      ROOT.name,
      SECTION.name,
      LEAF.name,
    ])
    expect(data.itemListElement.map((entry) => entry.position)).toEqual([1, 2, 3])
  })
})

describe('F7 밀도', () => {
  it('hands the density down to the same grid the search screen uses', async () => {
    await renderCategory(LEAF.slug)

    expect(await screen.findByRole('list', { name: search.list.gridLabel })).toHaveAttribute(
      'data-density',
      '2',
    )
  })
})

describe('F9 와 같은 모바일 규약', () => {
  it('puts the filter panel behind a button at 360px', async () => {
    await renderCategory(LEAF.slug, VIEWPORTS.mobile)

    expect(await screen.findByRole('button', { name: search.filters.openLabel })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: search.filters.title })).toBeNull()
  })
})
