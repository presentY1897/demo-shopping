'use client'

import type { ApiFailure, WithdrawalResponse } from '@shopping/shared'
import { Button, Card, GuardedButton, Input, Modal, ModalClose } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import type { WithdrawalResult } from '@/lib/profile/use-account'
import type { MyPageMessages, WithdrawalMessages } from '@/messages'

import { AccountWriteFailure } from './account-notices'

/**
 * Closing the account — the one action on this screen that cannot be undone.
 *
 * **Its own permission, and the button asks for it.** `profile.delete` is split
 * from `profile.write` precisely so that a future role allowed to change a
 * display density does not inherit the ability to delete an account
 * (TASK-0111 4장). `useAuthorization` asks the same table `apps/api`'s guard
 * asks, so a blocked button and a 403 say the same thing — and the button is
 * shown blocked with the reason rather than hidden, like every other
 * unavailable action in these apps.
 *
 * **The confirmation is not a formality** (R4, TASK-0017 4.7). Three things,
 * and each answers a different way of pressing a button by accident:
 *
 * | | |
 * | --- | --- |
 * | 무엇이 지워지고 무엇이 남는가 | Two lists, in the dialog, not a sentence to skim |
 * | 확인 문구 입력 | The confirm button does nothing until the phrase is typed — an Enter or a mis-click cannot reach it |
 * | 되돌릴 수 없음 | The button is `danger`, and initial focus is on the close control, not on it |
 *
 * `ConfirmDialog` is the house component for a destructive step, and this screen
 * deliberately does **not** use it: it has no room for a field, and a
 * confirmation that only needs a click is exactly what R4 says this must not be.
 * The parts that matter — `Modal`'s focus trap, Escape, background inertness —
 * are the same because both are built on it.
 *
 * **The receipt is the server's count, not a guess.** `DELETE /me` answers with
 * how many addresses were erased and how many sessions were ended, which is why
 * it is a 200 with a body rather than a 204 (TASK-0111 4장). The screen replaces
 * itself with that: the account is gone, so there is no profile left to render.
 */
export function WithdrawalSection({
  copy,
  messages,
  onWithdraw,
}: {
  readonly copy: WithdrawalMessages
  readonly messages: MyPageMessages
  readonly onWithdraw: () => Promise<WithdrawalResult>
}) {
  const { can, reason } = useAuthorization()
  const allowed = can('profile.delete')

  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [receipt, setReceipt] = useState<WithdrawalResponse | null>(null)

  const phraseId = useId()
  const matches = phrase.trim() === copy.phrase

  function confirm(): void {
    if (!matches || pending) return

    setPending(true)
    setFailure(null)

    void onWithdraw().then((result) => {
      setPending(false)

      if (result.ok) {
        setOpen(false)
        setReceipt(result.receipt)
      } else {
        // The dialog stays open so the person can try again or back out. Closing
        // it on failure would leave them looking at a settings screen with no
        // idea whether the account still exists.
        setFailure(result.failure)
      }
    })
  }

  if (receipt !== null) return <WithdrawalReceipt copy={copy} receipt={receipt} />

  return (
    <Card as="article" className="border-danger flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <Consequences copy={copy} />

      <div className="flex">
        {/*
          Two branches rather than `blocked={!allowed}`: `GuardedButton` requires
          `reason` by the type whenever `blocked` is set, which is what stops a
          blocked control from shipping with nothing to read — and a computed
          boolean cannot satisfy a discriminated union.
        */}
        {allowed ? (
          <Button
            onClick={() => {
              setPhrase('')
              setFailure(null)
              setOpen(true)
            }}
            variant="danger"
          >
            {copy.trigger}
          </Button>
        ) : (
          <GuardedButton
            blocked
            reason={reason('profile.delete') ?? copy.blockedReason}
            variant="danger"
          >
            {copy.trigger}
          </GuardedButton>
        )}
      </div>

      <Modal
        closeLabel={copy.closeLabel}
        description={copy.confirmDescription}
        footer={
          <>
            <ModalClose>
              <Button variant="outline">{copy.cancelLabel}</Button>
            </ModalClose>
            {/*
              Disabled until the phrase matches. A confirmation whose button is
              one keypress away from a destructive call is the formality R4
              refuses; `aria-disabled` is `Button`'s own treatment, so the
              control stays in the tab order and can still be read.
            */}
            <Button
              disabled={!matches}
              loading={pending}
              onClick={confirm}
              type="button"
              variant="danger"
            >
              {copy.confirmLabel}
            </Button>
          </>
        }
        onOpenChange={setOpen}
        open={open}
        size="md"
        title={copy.confirmTitle}
      >
        <div className="flex flex-col gap-4">
          <Consequences copy={copy} />

          <div className="flex flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={phraseId}>
              {copy.phraseLabel}
            </label>
            <p className="text-fg-subtle text-xs" id={`${phraseId}-hint`}>
              {copy.phraseHint} <strong className="text-fg">{copy.phrase}</strong>
            </p>
            <Input
              aria-describedby={`${phraseId}-hint`}
              autoComplete="off"
              id={phraseId}
              onChange={(event) => {
                setPhrase(event.target.value)
              }}
              value={phrase}
            />
          </div>

          {failure === null ? null : (
            <AccountWriteFailure failure={failure} messages={messages} title={copy.failed} />
          )}
        </div>
      </Modal>
    </Card>
  )
}

/**
 * What goes and what stays, as two lists.
 *
 * Rendered twice — on the card and inside the dialog — on purpose. The card's
 * copy is what somebody reads before deciding to open the dialog; the dialog's
 * is what they read with their hand on the button, and a confirmation that made
 * them remember the page behind it would be asking them to decide from memory.
 */
function Consequences({ copy }: { readonly copy: WithdrawalMessages }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="text-danger flex list-disc flex-col gap-1 ps-5">
        {copy.erased.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <ul className="text-fg-muted flex list-disc flex-col gap-1 ps-5">
        {copy.kept.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What actually happened, in the server's own numbers.
 *
 * `role="status"` rather than `alert`: it is the expected outcome of something
 * the person asked for twice, not an interruption.
 */
function WithdrawalReceipt({
  copy,
  receipt,
}: {
  readonly copy: WithdrawalMessages
  readonly receipt: WithdrawalResponse
}) {
  return (
    <Card as="article" className="flex flex-col gap-3">
      {/*
        The heading is inside the live region so the announcement carries what
        happened, not only the numbers. `status` rather than `alert`: it is the
        expected outcome of something asked for twice, not an interruption.
      */}
      <div className="flex flex-col gap-3" role="status">
        <h2 className="text-lg font-semibold">{copy.doneTitle}</h2>
        <p className="text-fg-muted text-sm">{copy.doneBody}</p>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-fg-muted">{copy.doneAddresses}</dt>
          <dd className="text-fg font-medium">{receipt.deletedAddresses}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-fg-muted">{copy.doneSessions}</dt>
          <dd className="text-fg font-medium">{receipt.revokedSessions}</dd>
        </div>
      </dl>
    </Card>
  )
}
