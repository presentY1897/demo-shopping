'use client'

import { Badge, ChevronDownIcon, ChevronRightIcon } from '@shopping/ui/components'
import type { KeyboardEvent, MouseEvent } from 'react'

import type { VisibleRow } from '@/lib/categories/tree'
import type { CategoryMessages } from '@/messages'

/**
 * Indentation per level. Three entries because the tree is three deep and the
 * database says so (`CATEGORY_MAX_DEPTH`); a level beyond the last simply keeps
 * the deepest indent rather than computing a class name at runtime, which
 * Tailwind could not have compiled.
 */
const LEVEL_PADDING = ['ps-3', 'ps-9', 'ps-15'] as const

interface CategoryTreeItemProps {
  readonly item: VisibleRow
  readonly selected: boolean
  /** The one item in the tree that Tab reaches — the roving tabindex. */
  readonly tabbable: boolean
  readonly messages: CategoryMessages
  readonly childCount: number
  readonly onSelect: (id: number) => void
  readonly onToggle: (id: number) => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly registerRef: (id: number, element: HTMLDivElement | null) => void
}

/**
 * One node of the tree.
 *
 * **It contains no focusable element.** The expand chevron is a decorative span
 * with a mouse handler, and every action — rename, move, retire — is a button in
 * the toolbar beside the tree. A `<button>` inside a `role="treeitem"` is an axe
 * `nested-interactive` violation and puts two competing focus models on the same
 * row (TASK-0029 4장); the keyboard reaches everything through the arrow keys
 * and the toolbar instead.
 */
export function CategoryTreeItem({
  item,
  selected,
  tabbable,
  messages,
  childCount,
  onSelect,
  onToggle,
  onKeyDown,
  registerRef,
}: CategoryTreeItemProps) {
  const { row, level, hasChildren, expanded } = item
  const indent = LEVEL_PADDING[Math.min(level, LEVEL_PADDING.length) - 1] ?? LEVEL_PADDING[0]

  function toggle(event: MouseEvent<HTMLSpanElement>): void {
    event.stopPropagation()
    onSelect(row.id)
    onToggle(row.id)
  }

  return (
    <div
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={level}
      aria-posinset={item.position}
      aria-selected={selected}
      aria-setsize={item.siblingCount}
      className={`min-h-touch flex cursor-default items-center gap-2 rounded-md pe-3 text-sm outline-none focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2 ${indent} ${
        selected ? 'bg-primary-surface text-fg font-medium' : 'hover:bg-surface-muted'
      }`}
      data-category-id={row.id}
      onClick={() => {
        onSelect(row.id)
      }}
      onKeyDown={onKeyDown}
      ref={(element) => {
        registerRef(row.id, element)
      }}
      role="treeitem"
      tabIndex={tabbable ? 0 : -1}
    >
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center"
        onClick={hasChildren ? toggle : undefined}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )
        ) : null}
      </span>

      <span className="grow truncate">{row.name}</span>

      {childCount > 0 ? (
        <span className="text-fg-subtle shrink-0 text-xs">
          {messages.childCountLabel} {childCount}
        </span>
      ) : null}

      <code className="text-fg-subtle shrink-0 text-xs">{row.slug}</code>

      {row.isActive ? null : (
        <Badge size="sm" variant="neutral">
          {messages.inactiveBadge}
        </Badge>
      )}
    </div>
  )
}
