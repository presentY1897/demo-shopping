'use client'

import type { EffectiveAttribute } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Switch, Table } from '@shopping/ui/components'

import type { MoveDirection } from '@/lib/attributes/order'
import { ownAttributes } from '@/lib/attributes/order'
import { fill } from '@/lib/attributes/text'
import type { AttributeMessages } from '@/messages'

interface AttributeListProps {
  readonly attributes: readonly EffectiveAttribute[]
  readonly messages: AttributeMessages
  /** The name of the category a definition belongs to. */
  readonly categoryName: (categoryId: number) => string
  readonly onEdit: (id: number) => void
  readonly onRemove: (id: number) => void
  readonly onMove: (id: number, direction: MoveDirection) => void
  readonly onToggleFilterable: (id: number) => void
  /** Takes the picker to the category that owns an inherited definition. */
  readonly onOpenSource: (categoryId: number) => void
}

/**
 * The definitions that apply to the chosen category, in the order a product form
 * will ask about them.
 *
 * **One list, not two.** Folding the inherited ones into their own section was
 * the obvious arrangement and it is wrong: this order *is* the order of the
 * generated form (`attributeFields` hands the index straight to the generator),
 * and a screen that grouped them would be showing an order the seller never
 * sees (TASK-0031 4.2).
 *
 * **An inherited row is not editable here and does not pretend to be.** Instead
 * of four disabled buttons it gets one that works: the category that owns the
 * definition, one click away. A disabled control with no way forward is the dead
 * end TASK-0029 already ran into with 삭제.
 */
export function AttributeList({
  attributes,
  messages,
  categoryName,
  onEdit,
  onRemove,
  onMove,
  onToggleFilterable,
  onOpenSource,
}: AttributeListProps) {
  const own = ownAttributes(attributes)
  const first = own[0]?.id
  const last = own[own.length - 1]?.id

  const columns: readonly TableColumn<EffectiveAttribute>[] = [
    {
      key: 'label',
      header: messages.columns.label,
      cell: (row) => <span className="font-medium">{row.label}</span>,
    },
    {
      key: 'key',
      header: messages.columns.key,
      cell: (row) => <code className="text-fg-subtle text-xs">{row.key}</code>,
    },
    {
      key: 'type',
      header: messages.columns.type,
      cell: (row) => messages.typeLabels[row.type],
    },
    {
      key: 'required',
      header: messages.columns.required,
      cell: (row) => (row.isRequired ? messages.yes : messages.no),
    },
    {
      key: 'filterable',
      header: messages.columns.filterable,
      cell: (row) =>
        row.inherited ? (
          <span className="text-fg-muted">{row.isFilterable ? messages.yes : messages.no}</span>
        ) : (
          <Switch
            aria-label={fill(messages.actions.toggleFilterable, { label: row.label })}
            checked={row.isFilterable}
            onCheckedChange={() => {
              onToggleFilterable(row.id)
            }}
          />
        ),
    },
    {
      key: 'source',
      header: messages.columns.source,
      cell: (row) =>
        row.inherited ? (
          <Badge variant="primary">
            {fill(messages.inheritedFrom, { name: categoryName(row.categoryId) })}
          </Badge>
        ) : (
          <span className="text-fg-muted">{categoryName(row.categoryId)}</span>
        ),
    },
    {
      key: 'actions',
      header: messages.columns.actions,
      align: 'end',
      cell: (row) =>
        row.inherited ? (
          <Button
            onClick={() => {
              onOpenSource(row.categoryId)
            }}
            size="sm"
            variant="outline"
          >
            {fill(messages.actions.goToSource, { name: categoryName(row.categoryId) })}
          </Button>
        ) : (
          <div className="flex justify-end gap-1">
            <Button
              disabled={row.id === first}
              onClick={() => {
                onMove(row.id, 'up')
              }}
              size="sm"
              variant="ghost"
            >
              {messages.actions.moveUp}
            </Button>
            <Button
              disabled={row.id === last}
              onClick={() => {
                onMove(row.id, 'down')
              }}
              size="sm"
              variant="ghost"
            >
              {messages.actions.moveDown}
            </Button>
            <Button
              onClick={() => {
                onEdit(row.id)
              }}
              size="sm"
              variant="outline"
            >
              {messages.actions.edit}
            </Button>
            <Button
              onClick={() => {
                onRemove(row.id)
              }}
              size="sm"
              variant="ghost"
            >
              {messages.actions.remove}
            </Button>
          </div>
        ),
    },
  ]

  return (
    <Table
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => String(row.id)}
      rows={attributes}
      // The list is already in the order the API resolved (general → specific)
      // and that order is the form's. Letting a header re-sort it would put the
      // screen and the generated form into disagreement.
      sort={null}
    />
  )
}
