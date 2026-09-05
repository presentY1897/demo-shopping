'use client'

import type { ApiFailure } from '@shopping/shared'
import { Button, DataList, EmptyState } from '@shopping/ui/components'
import { ConfirmDialog, useConfirm } from '@shopping/ui/form'
import { useCallback, useState } from 'react'

import type { CardMutationResult } from '@/lib/cards/use-cards'
import { useCardWallet } from '@/lib/cards/use-cards'
import type { IssuedCard } from '@/lib/payment/payment-api'
import type { MyPageMessages } from '@/messages'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountNotice,
  AccountWriteFailure,
} from './account-notices'
import type { CardIssueOutcome } from './card-issue-form'
import { CardIssueForm } from './card-issue-form'
import { VirtualCard } from './virtual-card'

/**
 * `/mypage/cards` — 가상 카드 지갑 (TASK-0058).
 *
 * **이 화면의 존재 이유는 「환불이 잘 됐는지 잔액으로 확인」하는 것**이다 (2장).
 * 목록이 지금 잔액을 말하고, 카드마다 펼쳐지는 원장이 그 잔액이 **어떻게 그렇게
 * 됐는지**를 말한다. 발급과 정지는 그 확인을 하기 위해 있어야 하는 것들이지 이
 * 화면의 목적이 아니다.
 *
 * **결제 화면의 카드 선택은 여기 없다.** TASK-0054 가 이미 만들었고(4.3), 주문서에서
 * 카드를 고르는 것과 카드를 관리하는 것은 다른 일이다 — 배송지에서 `AddressCard` 만
 * 주문서가 다시 쓰고 주소록 화면은 다시 쓰지 않는 것과 같은 갈래다.
 *
 * **가상 카드 안내를 어디에 두는가 (R1).** 목록 **위**, 발급 버튼보다도 위에 고정된
 * 패널로 둔다. 세 가지 이유가 있다.
 *
 * 1. R1 이 말하는 실패는 **오해**이고, 오해는 첫눈에 생긴다. 카드 모양의 것들 아래에
 *    적힌 각주는 이미 믿어 버린 사람에게 도착한다.
 * 2. **접거나 닫을 수 없다.** `details` 나 닫기 버튼을 달면 「이건 진짜 카드가
 *    아닙니다」가 끌 수 있는 것이 된다.
 * 3. `role="note"` 이지 `alert` 가 아니다. 잘못된 일이 일어난 것이 아니라 이 화면의
 *    성질이고, 매번 사람의 하던 일을 끊고 읽어 줄 소식이 아니다.
 *
 * 번호 접두어(`9999-`)만으로는 부족하다 — 실제 BIN 과 겹치지 않는다는 것은 결제망의
 * 사정이지 화면을 보는 사람이 아는 사실이 아니다. 그래서 문장이 **실제 돈이 나가지
 * 않는다**고 말한다. 같은 사실을 한 번 더 말하는 자리가 발급 폼의 한도 칸이고, 그
 * 이유는 `card-issue-form.tsx` 에 적혀 있다.
 */
export function CardWallet({ messages }: { readonly messages: MyPageMessages }) {
  const wallet = useCardWallet()
  const copy = messages.cards

  const [issuing, setIssuing] = useState(false)
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  /**
   * 삭제 확인, `await` 한 번으로.
   *
   * 되돌릴 수 없는 것 앞에만 둔다 — 정지에는 없다. 정지는 해제하면 그대로 돌아오고,
   * 되돌릴 수 있는 일에 확인을 붙이면 확인이라는 장치 자체가 형식이 된다.
   */
  const gate = useConfirm()
  const [pendingRemoval, setPendingRemoval] = useState<IssuedCard | null>(null)

  const items = wallet.state.status === 'ready' ? wallet.state.items : []

  const announce = useCallback((message: string) => {
    setNotice(message)
    setFailure(null)
  }, [])

  const report = useCallback((next: ApiFailure) => {
    setNotice(null)
    setFailure(next)
  }, [])

  async function issue(creditLimit: number): Promise<CardIssueOutcome> {
    const result = await wallet.issue(creditLimit)

    if (!result.ok) return { kind: 'rejected', failure: result.failure }

    setIssuing(false)
    // 어느 카드가 생겼는지까지 말한다. 목록 맨 위에 새 카드가 나타나지만, 세 장이
    // 전부 같은 접두어로 시작하므로 화면만 봐서는 어느 것이 새 것인지 알 수 없다 —
    // 그래서 응답이 들고 온 카드의 번호를 문장에 싣는다.
    announce(copy.issuedNotice.replace('{number}', result.card.maskedNumber))

    return { kind: 'issued' }
  }

  /** 카드 하나에 대한 쓰기. 정지·해제·삭제가 같은 모양이다. */
  async function write(
    card: IssuedCard,
    run: () => Promise<CardMutationResult>,
    done: string,
  ): Promise<void> {
    setBusyId(card.id)
    const result = await run()
    setBusyId(null)

    if (result.ok) {
      announce(done)

      return
    }

    report(result.failure)
  }

  async function remove(card: IssuedCard): Promise<void> {
    setPendingRemoval(card)
    const confirmed = await gate.request()
    setPendingRemoval(null)

    if (!confirmed) return

    // 지운 카드의 원장은 열어 둘 수 없다. 접지 않으면 다음 렌더에서 없는 카드의
    // 원장을 요청하고, 404 를 오류 화면으로 그리게 된다.
    setOpenCardId((current) => (current === card.id ? null : current))
    await write(card, () => wallet.remove(card.id), copy.removedNotice)
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        R1. 목록보다 먼저, 그리고 끌 수 없이. 이유는 이 파일 위쪽 주석에 있다.
        `note` 는 「본문에 딸린 참고」라는 뜻이고, 이 문장이 정확히 그것이다.
      */}
      <div
        className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3"
        role="note"
      >
        <p className="text-fg text-sm font-semibold">{copy.noticeTitle}</p>
        <p className="text-fg-muted text-sm">{copy.noticeBody}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            setIssuing(true)
          }}
          variant="primary"
        >
          {copy.issue.open}
        </Button>

        {notice === null ? null : <AccountNotice>{notice}</AccountNotice>}
      </div>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.writeFailedTitle} />
      )}

      {issuing ? (
        <CardIssueForm
          copy={copy.issue}
          messages={messages}
          onCancel={() => {
            setIssuing(false)
          }}
          onSubmit={issue}
        />
      ) : null}

      <DataList
        empty={<EmptyState description={copy.emptyBody} title={copy.emptyTitle} />}
        error={
          wallet.state.status === 'error' ? (
            <AccountLoadFailure
              failure={wallet.state.failure}
              messages={messages}
              onRetry={wallet.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} />}
        state={stateOf(wallet.state.status, items.length)}
      >
        {/*
          한 열이다. 원장이 카드 안에서 펼쳐지고 그것은 표라서, 두 열로 두면 표가
          카드 너비의 절반 안에서 옆으로 스크롤하게 된다 — 배송지 목록과 다른
          판단이고, 그 차이를 만드는 것은 카드가 무엇을 품느냐다.
        */}
        <ul aria-label={copy.listLabel} className="grid gap-4">
          {items.map((card) => (
            <VirtualCard
              busy={busyId === card.id}
              card={card}
              copy={copy}
              key={card.id}
              messages={messages}
              onActivate={() => {
                void write(card, () => wallet.activate(card.id), copy.activatedNotice)
              }}
              onRemove={() => {
                void remove(card)
              }}
              onSuspend={() => {
                void write(card, () => wallet.suspend(card.id), copy.suspendedNotice)
              }}
              onToggleLedger={() => {
                setOpenCardId((current) => (current === card.id ? null : card.id))
              }}
              open={openCardId === card.id}
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
        {/* 어느 카드인지 적는다. 대상을 말하지 않는 확인은 믿고 누르는 확인이다. */}
        {pendingRemoval === null ? null : (
          <p className="text-fg text-sm tabular-nums">
            {copy.cardLabel
              .replace('{brand}', pendingRemoval.brand)
              .replace('{number}', pendingRemoval.maskedNumber)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}

/** `DataList` 의 네 상태를, 읽기의 세 상태와 「아무 카드도 없다」에서. */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
