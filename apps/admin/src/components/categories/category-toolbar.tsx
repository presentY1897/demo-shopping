'use client'

import { Button } from '@shopping/ui/components'

import type { CategoryRow, MoveDirection } from '@/lib/categories/tree'
import { canAddChild, hasChildren, planMove } from '@/lib/categories/tree'
import type { CategoryMessages } from '@/messages'

interface CategoryToolbarProps {
  readonly rows: readonly CategoryRow[]
  readonly selected: CategoryRow | null
  readonly messages: CategoryMessages
  readonly onAddRoot: () => void
  readonly onAddChild: (id: number) => void
  readonly onEdit: (id: number) => void
  readonly onMove: (id: number, direction: MoveDirection) => void
  readonly onToggleActive: (id: number) => void
  readonly onRemove: (id: number) => void
  readonly onExpandAll: () => void
  readonly onCollapseAll: () => void
}

/**
 * Everything that can be done to the selected category.
 *
 * It sits **outside** the tree, which is what lets the tree stay a single tab
 * stop — the property the whole keyboard contract rests on (TASK-0029 4장). A
 * pointer and a keyboard reach the same handlers from here; `Alt`+arrow in the
 * tree is a shortcut for the four move buttons, not a second implementation.
 *
 * A move that cannot happen — the first child moving up, a root moving out, a
 * branch that would land four levels deep — disables its button, and the same
 * `planMove` that returns `null` here is what the handler would have refused.
 * One function decides, so the button and the behaviour cannot disagree.
 */
export function CategoryToolbar({
  rows,
  selected,
  messages,
  onAddRoot,
  onAddChild,
  onEdit,
  onMove,
  onToggleActive,
  onRemove,
  onExpandAll,
  onCollapseAll,
}: CategoryToolbarProps) {
  const { actions } = messages
  const blocked = selected !== null && hasChildren(rows, selected.id)

  const moveButton = (direction: MoveDirection, label: string) => (
    <Button
      disabled={selected === null || planMove(rows, selected.id, direction) === null}
      key={direction}
      onClick={() => {
        if (selected !== null) onMove(selected.id, direction)
      }}
      size="sm"
      variant="outline"
    >
      {label}
    </Button>
  )

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onAddRoot} size="sm" variant="primary">
          {actions.addRoot}
        </Button>
        <Button onClick={onExpandAll} size="sm" variant="ghost">
          {actions.expandAll}
        </Button>
        <Button onClick={onCollapseAll} size="sm" variant="ghost">
          {actions.collapseAll}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {/*
          With nothing selected the label would run into the hint and read as
          one sentence — "선택한 카테고리 트리에서 카테고리를 선택하면…". The
          label only earns its place once there is something to label.
        */}
        {selected === null ? (
          <p className="text-fg-subtle text-sm">{messages.noSelection}</p>
        ) : (
          <p className="text-sm">
            <span className="text-fg-muted">{messages.selectionLabel}</span>{' '}
            <span className="font-medium">{selected.name}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {moveButton('up', actions.moveUp)}
          {moveButton('down', actions.moveDown)}
          {moveButton('out', actions.moveOut)}
          {moveButton('in', actions.moveIn)}

          <Button
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onEdit(selected.id)
            }}
            size="sm"
            variant="secondary"
          >
            {actions.edit}
          </Button>

          <Button
            disabled={selected === null || !canAddChild(rows, selected.id)}
            onClick={() => {
              if (selected !== null) onAddChild(selected.id)
            }}
            size="sm"
            variant="outline"
          >
            {actions.addChild}
          </Button>

          <Button
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onToggleActive(selected.id)
            }}
            size="sm"
            variant="outline"
          >
            {selected?.isActive === false ? actions.activate : actions.deactivate}
          </Button>

          <Button
            disabled={selected === null || blocked}
            onClick={() => {
              if (selected !== null) onRemove(selected.id)
            }}
            size="sm"
            variant="danger"
          >
            {actions.remove}
          </Button>
        </div>

        {blocked ? <p className="text-fg-muted text-sm">{actions.removeBlocked}</p> : null}
      </div>
    </div>
  )
}
