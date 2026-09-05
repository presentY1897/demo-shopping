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
 */
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
          <Link className="hover:text-fg underline-offset-2 hover:underline" href="/">
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
              <Link
                className="hover:text-fg underline-offset-2 hover:underline"
                href={`/categories/${node.slug}`}
              >
                {node.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
