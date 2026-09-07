import type { CategoryTreeNode } from '@shopping/shared'
import Link from 'next/link'

import type { CategoryMessages } from '@/messages'

/**
 * 브레드크럼 (TASK-0042 F2).
 *
 * A server component with real `<a>`s, so the lineage is in the markup a crawler
 * reads and a visitor can middle-click. The current page is the last item and is
 * **not** a link — `aria-current="page"` says where you are, and a link to the
 * page you are on is a control that does nothing.
 *
 * `<ol>` rather than a row of spans: the order is the meaning, and a screen
 * reader announcing "list, 3 items" is what tells somebody how deep they are.
 *
 * **각 칸은 손가락이 닿는 상자다** (TASK-0098 F5b). `link.tsx` 는 터치 하한에서
 * 빠져 있는데 그것은 **문장 안의 링크**를 위한 면제이고(WCAG 2.5.8), 여기 링크는
 * 문장 안이 아니라 나란히 놓인 이동 목적지다. 면제를 그대로 가져다 쓰다가 Lighthouse
 * 가 「홈」을 14×18px 로 짚었다 — 카테고리 화면의 접근성 점수 4점이 이것이었다.
 */
/**
 * 글자는 작아도 **닿는 상자는 44px** 이다 (TASK-0098 R1 — 「시각적으로 작아도
 * 패딩으로 터치 영역 확보」). `-mx-2` 로 그만큼 되돌려 놓아 줄의 생김새는 그대로다.
 */
const CRUMB =
  'hover:text-fg min-h-touch -mx-2 inline-flex items-center px-2 underline-offset-2 hover:underline'

export function CategoryBreadcrumb({
  lineage,
  messages,
}: {
  readonly lineage: readonly CategoryTreeNode[]
  readonly messages: CategoryMessages
}) {
  const last = lineage.length - 1

  return (
    <nav aria-label={messages.breadcrumbLabel}>
      <ol className="text-fg-muted flex flex-wrap items-center gap-1 text-sm">
        <li>
          <Link className={CRUMB} href="/">
            {messages.homeLabel}
          </Link>
        </li>
        {lineage.map((node, index) => (
          <li className="flex items-center gap-1" key={node.id}>
            <span aria-hidden="true">/</span>
            {index === last ? (
              <span aria-current="page" className="text-fg font-medium">
                {node.name}
              </span>
            ) : (
              <Link className={CRUMB} href={`/categories/${node.slug}`}>
                {node.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
