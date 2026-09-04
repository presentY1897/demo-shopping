'use client'

import type { Address, ApiFailure } from '@shopping/shared'
import { Button, DataList, EmptyState } from '@shopping/ui/components'
import { ConfirmDialog, useConfirm } from '@shopping/ui/form'
import { useCallback, useState } from 'react'

import type { AddressFormValues } from '@/lib/profile/address-form-schema'
import { addressCreateFrom, addressUpdateFrom } from '@/lib/profile/address-form-schema'
import { useAddressBook } from '@/lib/profile/use-addresses'
import type { MyPageMessages } from '@/messages'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountNotice,
  AccountWriteFailure,
} from './account-notices'
import { AddressCard } from './address-card'
import type { AddressFormOutcome } from './address-form'
import { AddressForm } from './address-form'

/** Which address the form is about, or `null` when it is closed. */
type Editor = { readonly mode: 'add' } | { readonly mode: 'edit'; readonly address: Address } | null

/**
 * `/mypage/addresses` — the address book (TASK-0112 4장).
 *
 * **Four states, and `DataList` makes three of them impossible to forget**:
 * `loading`, `empty` and `error` are required props with no defaults, so a list
 * that skipped its empty state would not compile.
 *
 * **Two of the three writes change rows nobody named**, and the screen says so.
 * Making an address the default clears another's badge; deleting the default
 * promotes the newest survivor (TASK-0111 4장). Both are correct, both happen
 * without being asked for, and a badge that moved on its own with no explanation
 * reads as a bug — so `promotedNotice` exists and is only said when a promotion
 * actually happened.
 *
 * **A 409 is not a failure to shrug at.** It means somebody made a *different*
 * address the default while this click was in flight, and the useful next step
 * is to look at where the default actually is now. `useAddressBook` re-reads
 * before reporting, so by the time this notice appears the list underneath it is
 * already right (F3b).
 */
export function AddressBook({ messages }: { readonly messages: MyPageMessages }) {
  const book = useAddressBook()
  const copy = messages.addresses

  const [editor, setEditor] = useState<Editor>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  /**
   * The delete confirmation, as one `await`.
   *
   * The destructive call is unreachable unless the answer was yes — every other
   * way of closing the dialog resolves `false` — which is the shape F5 asks for
   * ("확인 없이는 요청 0회").
   */
  const gate = useConfirm()
  const [pendingRemoval, setPendingRemoval] = useState<Address | null>(null)

  const items = book.state.status === 'ready' ? book.state.items : []

  const announce = useCallback((message: string) => {
    setNotice(message)
    setFailure(null)
  }, [])

  async function submit(values: AddressFormValues): Promise<AddressFormOutcome> {
    const result =
      editor?.mode === 'edit'
        ? await book.save(editor.address.id, addressUpdateFrom(values))
        : await book.create(addressCreateFrom(values))

    if (!result.ok) return { kind: 'rejected', failure: result.failure }

    // An edit cannot carry `isDefault` — promotion has its own endpoint — so
    // asking for it here is a second call, made only when the switch changed.
    if (editor?.mode === 'edit' && values.isDefault && !editor.address.isDefault) {
      await book.makeDefault(editor.address.id)
    }

    setEditor(null)
    announce(copy.savedNotice)

    return { kind: 'saved' }
  }

  async function makeDefault(address: Address): Promise<void> {
    setBusyId(address.id)
    const result = await book.makeDefault(address.id)
    setBusyId(null)

    if (result.ok) {
      announce(copy.defaultChangedNotice)
      return
    }

    setNotice(null)
    setFailure(result.failure)
  }

  async function remove(address: Address): Promise<void> {
    setPendingRemoval(address)
    const confirmed = await gate.request()
    setPendingRemoval(null)

    if (!confirmed) return

    setBusyId(address.id)
    const result = await book.remove(address.id)
    setBusyId(null)

    if (!result.ok) {
      setNotice(null)
      setFailure(result.failure)
      return
    }

    // Two different things happened, and the second one is worth its own
    // sentence because nobody asked for it.
    announce(result.promoted ? `${copy.removedNotice} ${copy.promotedNotice}` : copy.removedNotice)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            setEditor({ mode: 'add' })
          }}
          variant="primary"
        >
          {copy.addLabel}
        </Button>

        {notice === null ? null : <AccountNotice>{notice}</AccountNotice>}
      </div>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.title} />
      )}

      {editor === null ? null : (
        <AddressForm
          copy={copy.form}
          editing={editor.mode === 'edit' ? editor.address : undefined}
          isFirst={items.length === 0}
          messages={messages}
          onCancel={() => {
            setEditor(null)
          }}
          onSubmit={submit}
        />
      )}

      <DataList
        empty={<EmptyState description={copy.emptyBody} title={copy.emptyTitle} />}
        error={
          book.state.status === 'error' ? (
            <AccountLoadFailure
              failure={book.state.failure}
              messages={messages}
              onRetry={book.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} />}
        state={stateOf(book.state.status, items.length)}
      >
        <ul aria-label={copy.listLabel} className="grid gap-4 sm:grid-cols-2">
          {items.map((address) => (
            <AddressCard
              address={address}
              busy={busyId === address.id}
              copy={copy}
              key={address.id}
              onEdit={() => {
                setEditor({ mode: 'edit', address })
              }}
              onMakeDefault={() => {
                void makeDefault(address)
              }}
              onRemove={() => {
                void remove(address)
              }}
            />
          ))}
        </ul>
      </DataList>

      <ConfirmDialog
        cancelLabel={copy.removeCancel}
        closeLabel={copy.removeCloseLabel}
        confirmLabel={copy.removeConfirm}
        description={copy.removeDescription}
        destructive
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title={copy.removeTitle}
      >
        {/* Which one, spelled out: a confirmation that does not name its target
            is a confirmation the reader has to take on trust. */}
        {pendingRemoval === null ? null : (
          <p className="text-fg text-sm">
            {pendingRemoval.label ?? pendingRemoval.recipientName} · {pendingRemoval.addressLine1}
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}

/** `DataList`'s four states, from the read's three plus "it answered nothing". */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
