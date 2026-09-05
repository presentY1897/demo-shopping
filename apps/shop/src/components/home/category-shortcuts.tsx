'use client'

/**
 * 카테고리 바로가기 (TASK-0044 F1).
 *
 * The header's tree, read through the same hook — one request for the tab, and
 * one definition of what the top level is. A second fetch here would be a second
 * answer to the same question, and the two would drift the day one of them
 * learned to hide something.
 *
 * Nothing is drawn until the tree arrives. A row of placeholder chips would move
 * the page when the real names replaced them, and the names are short enough
 * that their arrival is not worth a layout shift.
 */

import Link from 'next/link'

import { useCategoryMenu } from '@/lib/categories/use-category-menu'
import type { HomeMessages } from '@/messages'

export function CategoryShortcuts({ messages }: { readonly messages: HomeMessages }) {
  const categories = useCategoryMenu()

  if (categories.length === 0) return null

  return (
    <nav aria-label={messages.categoriesTitle} className="flex flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{messages.categoriesTitle}</h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              className="border-border bg-surface text-fg hover:bg-surface-muted min-h-touch inline-flex items-center rounded-md border px-3 text-sm"
              href={`/categories/${category.slug}`}
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
