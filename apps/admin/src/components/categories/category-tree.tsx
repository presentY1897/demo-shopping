'use client'

import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import type { MoveDirection, VisibleRow } from '@/lib/categories/tree'
import type { CategoryMessages } from '@/messages'

import { CategoryTreeItem } from './category-tree-item'

/** `Alt` plus an arrow moves the node itself, as an outline editor does. */
const ALT_MOVES: Readonly<Record<string, MoveDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'out',
  ArrowRight: 'in',
}

interface CategoryTreeProps {
  readonly items: readonly VisibleRow[]
  readonly selectedId: number | null
  readonly messages: CategoryMessages
  readonly onSelect: (id: number) => void
  readonly onToggle: (id: number, expanded?: boolean) => void
  readonly onMove: (id: number, direction: MoveDirection) => void
  readonly onEdit: (id: number) => void
}

/**
 * The tree, driven entirely from the keyboard (U5, P4).
 *
 * It follows the WAI-ARIA tree pattern: one tab stop for the whole widget
 * (roving `tabindex`), arrows to walk it, and left/right to fold. On top of that
 * sit the four `Alt`+arrow moves, which is the same gesture set an outline
 * editor uses and the reason this screen needs no drag target at all
 * (TASK-0029 4장). Every one of them is also a button in the toolbar, so a
 * pointer user and a keyboard user take the same code path.
 *
 * The rows are flat with `aria-level`, rather than nested `role="group"`
 * elements: the visible order is computed once in `visibleRows` and both the
 * markup and the arrow keys read it, so what the eye walks and what the arrows
 * walk cannot drift apart.
 */
export function CategoryTree({
  items,
  selectedId,
  messages,
  onSelect,
  onToggle,
  onMove,
  onEdit,
}: CategoryTreeProps) {
  const treeRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<number, HTMLDivElement>())

  const registerRef = useCallback((id: number, element: HTMLDivElement | null) => {
    if (element === null) itemRefs.current.delete(id)
    else itemRefs.current.set(id, element)
  }, [])

  const active = selectedId ?? items[0]?.row.id ?? null

  /**
   * Keeps the DOM focus on the selected row while the arrows are walking.
   *
   * Guarded by "the tree already has focus" so that selecting from elsewhere —
   * a dialog closing, say — does not yank focus out of whatever the operator is
   * using.
   */
  useEffect(() => {
    const tree = treeRef.current
    if (selectedId === null || tree?.contains(document.activeElement) !== true) return

    itemRefs.current.get(selectedId)?.focus()
  }, [selectedId, items])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (active === null) return

    const index = items.findIndex((item) => item.row.id === active)
    const item = items[index]
    if (item === undefined) return

    // Checked before the plain arrows, or Alt+Down would just move the cursor.
    if (event.altKey) {
      const direction = ALT_MOVES[event.key]
      if (direction === undefined) return

      event.preventDefault()
      onMove(active, direction)

      return
    }

    const select = (target: VisibleRow | undefined): void => {
      if (target !== undefined) onSelect(target.row.id)
    }

    switch (event.key) {
      case 'ArrowDown':
        select(items[index + 1])
        break

      case 'ArrowUp':
        select(items[index - 1])
        break

      case 'ArrowRight':
        if (!item.hasChildren) return
        if (item.expanded) select(items[index + 1])
        else onToggle(active, true)
        break

      case 'ArrowLeft':
        if (item.expanded) onToggle(active, false)
        else {
          const parentId = item.row.parentId
          if (parentId !== null) onSelect(parentId)
        }
        break

      case 'Home':
        select(items[0])
        break

      case 'End':
        select(items[items.length - 1])
        break

      case ' ':
        if (item.hasChildren) onToggle(active)
        break

      case 'Enter':
        onEdit(active)
        break

      default:
        return
    }

    event.preventDefault()
  }

  return (
    <div
      aria-label={messages.treeLabel}
      aria-multiselectable="false"
      className="border-border flex flex-col gap-0.5 overflow-x-auto rounded-lg border p-2"
      ref={treeRef}
      role="tree"
    >
      {items.map((item) => (
        <CategoryTreeItem
          childCount={item.childCount}
          item={item}
          key={item.row.id}
          messages={messages}
          onKeyDown={handleKeyDown}
          onSelect={onSelect}
          onToggle={onToggle}
          registerRef={registerRef}
          selected={item.row.id === selectedId}
          tabbable={item.row.id === active}
        />
      ))}
    </div>
  )
}
