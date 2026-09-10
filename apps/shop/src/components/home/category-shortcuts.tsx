'use client'

/**
 * 카테고리 바로가기 (TASK-0044 F1).
 *
 * The header's tree, read through the same hook — one request for the tab, and
 * one definition of what the top level is. A second fetch here would be a second
 * answer to the same question, and the two would drift the day one of them
 * learned to hide something.
 *
 * **기다리는 동안 같은 높이를 잡아 둔다** (TASK-0097 F2). 예전 주석은 자리표를
 * 두면 이름이 도착할 때 화면이 움직인다고 적어 두었는데, 재 보니 반대였다 — 자리를
 * 안 잡아 두어 **줄 하나가 통째로 나타나면서** 아래가 116px 내려갔고 그것이 홈의
 * 레이아웃 이동의 나머지였다. 칩 한 줄의 높이는 이름 길이와 무관하므로(`min-h-touch`)
 * 자리표를 두면 도착은 눈에 띄지 않는다.
 *
 * 못 받아 왔을 때는 여전히 아무것도 그리지 않는다. 그래서 「아직」과 「없다」를
 * 가르는 값이 필요했다 (`useCategoryMenu` 의 `loading`).
 */

import Link from 'next/link'

import { useCategoryMenu } from '@/lib/categories/use-category-menu'
import type { HomeMessages } from '@/messages'

/** 자리표 칩의 너비. 이름의 길이를 흉내 낸 값이고, 높이만이 중요하다. */
const PLACEHOLDER_WIDTHS = ['w-16', 'w-16', 'w-20']

export function CategoryShortcuts({ messages }: { readonly messages: HomeMessages }) {
  const { nodes: categories, loading } = useCategoryMenu()

  if (!loading && categories.length === 0) return null

  return (
    <nav aria-label={messages.categoriesTitle} className="flex flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{messages.categoriesTitle}</h2>
      <ul className="flex flex-wrap gap-2">
        {loading
          ? PLACEHOLDER_WIDTHS.map((width, index) => (
              <li aria-hidden="true" key={`${width}-${index}`}>
                <span
                  className={`bg-surface-muted min-h-touch block animate-pulse rounded-md ${width}`}
                />
              </li>
            ))
          : categories.map((category) => (
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
