'use client'

import type { Address } from '@shopping/shared'
import { Badge, Button, Card } from '@shopping/ui/components'

import type { AddressBookMessages } from '@/messages'

/**
 * One saved address (TASK-0112 4장).
 *
 * **This component is a seam, not just a card.** M07's checkout reuses it to
 * let somebody pick an address at order time (TASK-0050), which is why the
 * actions arrive as optional callbacks rather than being wired to the address
 * book's own hook: a checkout screen wants the same card with none of them.
 *
 * **The default is marked three ways**, because one is never enough:
 * a badge with a word in it (colour alone fails WCAG 1.4.1), a border that
 * separates it at a glance, and — the part that matters most — **the "기본으로"
 * button is absent** rather than disabled. Nothing about the row that is already
 * the default invites a click that would do nothing.
 *
 * The card's own layout is a container query (`@container/card`), so it lays out
 * from its width rather than the viewport's — the same card is right in a
 * one-column phone list and in a three-column desktop one, at all three
 * densities.
 */
export function AddressCard({
  address,
  copy,
  busy = false,
  onMakeDefault,
  onEdit,
  onRemove,
}: {
  readonly address: Address
  readonly copy: AddressBookMessages
  /** A write about this row is in flight; its actions are inert until it lands. */
  readonly busy?: boolean
  readonly onMakeDefault?: () => void
  readonly onEdit?: () => void
  readonly onRemove?: () => void
}) {
  /**
   * What every control on this card is called.
   *
   * "삭제" three times in a list of three addresses is three buttons with the
   * same accessible name, and a screen-reader user listing the buttons on the
   * page would have no way to tell them apart. The label — or the recipient,
   * for an address saved without one — is what makes each unique.
   */
  const name = address.label ?? address.recipientName

  return (
    <Card
      as="li"
      className={address.isDefault ? 'border-primary flex flex-col gap-3' : 'flex flex-col gap-3'}
      variant="outline"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{name}</h3>
        {address.isDefault ? <Badge variant="primary">{copy.defaultBadge}</Badge> : null}
      </div>

      <dl className="text-fg-muted flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt>{copy.recipientLabel}</dt>
          <dd className="text-fg">{address.recipientName}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{copy.phoneLabel}</dt>
          <dd className="text-fg">{address.phone}</dd>
        </div>
      </dl>

      <p className="text-fg text-sm">
        <span className="text-fg-muted">[{address.postalCode}]</span> {address.addressLine1}
        {address.addressLine2 === null ? null : ` ${address.addressLine2}`}
      </p>

      <div className="flex flex-wrap gap-2">
        {/* Absent, not disabled: there is nothing to ask for on this row. */}
        {!address.isDefault && onMakeDefault !== undefined ? (
          <Button loading={busy} onClick={onMakeDefault} size="sm" variant="outline">
            {copy.makeDefault}
            <Owner name={name} />
          </Button>
        ) : null}

        {onEdit === undefined ? null : (
          <Button onClick={onEdit} size="sm" variant="ghost">
            {copy.edit}
            <Owner name={name} />
          </Button>
        )}

        {onRemove === undefined ? null : (
          <Button loading={busy} onClick={onRemove} size="sm" variant="ghost">
            {copy.remove}
            <Owner name={name} />
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * Which address a button is about, for the reader who cannot see which card it
 * is on.
 *
 * Visually hidden rather than in the label, because "삭제 · 집" on screen is
 * noise for somebody who can see the heading two lines above it — and "삭제"
 * three times over is three indistinguishable buttons for somebody who cannot.
 * The word joins the button's accessible name; nothing else changes.
 */
function Owner({ name }: { readonly name: string }) {
  return <span className="sr-only">{` ${name}`}</span>
}
