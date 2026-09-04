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
   * same accessible name, and somebody listing the page's buttons in a screen
   * reader would have no way to tell them apart. The label — or the recipient,
   * for an address saved without one — is what makes each unique.
   *
   * **`aria-label`, not a visually hidden word inside the button.** The visible
   * text stays "삭제", and the accessible name starts with it, so WCAG 2.5.3
   * (Label in Name) holds and voice control still works. A hidden `<span>`
   * would have read the same in a browser and *not* in the accessibility tree
   * this project's tests compute — element contributions are trimmed and joined
   * with nothing between them, so "삭제" + "집" came out as one word.
   */
  const name = address.label ?? address.recipientName

  return (
    <Card
      as="li"
      className={address.isDefault ? 'border-primary flex flex-col gap-3' : 'flex flex-col gap-3'}
      variant="outline"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `h2`, not `h3`. The page's only other heading is the shell's `h1`, so
          a level-three heading here skips a level whenever the add/edit panel
          is closed — an axe `heading-order` violation, and a real one: an
          outline with a hole in it is how a screen-reader user loses the shape
          of a page. The panel's own heading is an `h2` beside these.
        */}
        <h2 className="text-base font-semibold">{name}</h2>
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
          <Button
            aria-label={`${copy.makeDefault} ${name}`}
            loading={busy}
            onClick={onMakeDefault}
            size="sm"
            variant="outline"
          >
            {copy.makeDefault}
          </Button>
        ) : null}

        {onEdit === undefined ? null : (
          <Button aria-label={`${copy.edit} ${name}`} onClick={onEdit} size="sm" variant="ghost">
            {copy.edit}
          </Button>
        )}

        {onRemove === undefined ? null : (
          <Button
            aria-label={`${copy.remove} ${name}`}
            loading={busy}
            onClick={onRemove}
            size="sm"
            variant="ghost"
          >
            {copy.remove}
          </Button>
        )}
      </div>
    </Card>
  )
}
