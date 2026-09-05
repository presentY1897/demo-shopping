'use client'

import type { ApiFailure, DemoCarrierCode } from '@shopping/shared'
import { demoCarrierCodes, failureMessage, quotableRequestId } from '@shopping/shared'
import { Button, ErrorNotice, Modal, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { OrderShipMessages, OrderVocabularyMessages, StoreFailureMessages } from '@/messages'
import { messagesFor } from '@/messages'

/**
 * 발송 처리 — **한 건과 여러 건이 같은 대화상자다** (F3 · F4).
 *
 * 나누지 않는 이유는 판매자가 고르는 것이 같기 때문이다: 운송사 하나. 두 벌을 만들면
 * 「일괄에서는 운송사를 못 고른다」 같은 차이가 조용히 생기고, 그 차이는 아무도
 * 의도하지 않는다.
 *
 * **운송사는 선택이다.** 고르지 않으면 서버가 고른다(`ShipSellerOrderRequest`) — 가상
 * 운송사라 「어디에 맡겼는가」가 이 데모에서 뜻하는 바는 표시뿐이고, 그 칸을 필수로
 * 만들면 폰에서 발송하는 흐름에 걸음이 하나 는다.
 *
 * **폰에서 완결된다** (F10). 모달은 360px 에서 전체 폭을 쓰고, 안에 있는 것은 셀렉트
 * 하나와 버튼 둘이다.
 */
export interface ShipDialogProps {
  readonly open: boolean
  /** 몇 건을 보내는가. 1이면 한 건짜리 문구가 나간다. */
  readonly count: number
  readonly busy: boolean
  readonly failure: ApiFailure | null
  /** 건별 실패 — 전체를 되돌리지 않는다 (R1). */
  readonly failed?: readonly { readonly orderNumber: string; readonly reason: string }[]
  readonly onConfirm: (carrierCode: DemoCarrierCode | undefined) => void
  readonly onClose: () => void
  readonly messages: OrderShipMessages
  readonly failureMessages: StoreFailureMessages
  readonly closeLabel: string
  readonly vocabulary?: OrderVocabularyMessages
}

/** 「자동 배정」을 셀렉트의 값으로 나타내는 문자열. 운송사 코드와 겹치지 않는다. */
const AUTO = 'auto'

export function ShipDialog({
  open,
  count,
  busy,
  failure,
  failed = [],
  onConfirm,
  onClose,
  messages,
  failureMessages,
  closeLabel,
  vocabulary = messagesFor().orders,
}: ShipDialogProps) {
  const [carrier, setCarrier] = useState<string>(AUTO)
  const carrierId = useId()
  const requestId = failure === null ? null : quotableRequestId(failure)

  const options = [
    { value: AUTO, label: messages.carrierAuto },
    ...demoCarrierCodes.map((code) => ({ value: code, label: vocabulary.carrierLabels[code] })),
  ]

  return (
    <Modal
      closeLabel={closeLabel}
      description={messages.notice}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            {messages.cancel}
          </Button>
          <Button
            // U3: 도는 동안 두 번째 클릭이 두 번째 요청이 되지 않는다.
            disabled={busy}
            onClick={() => {
              onConfirm(carrier === AUTO ? undefined : (carrier as DemoCarrierCode))
            }}
            type="button"
            variant="primary"
          >
            {messages.confirm}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
      title={count === 1 ? messages.title : messages.bulkTitle.replace('{count}', String(count))}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={carrierId}>
            {messages.carrierLabel}
          </label>
          <Select
            disabled={busy}
            id={carrierId}
            onValueChange={setCarrier}
            options={options}
            value={carrier}
          />
        </div>

        {failed.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <p className="text-fg text-sm font-medium">{messages.failedHeading}</p>
            <ul className="text-fg-muted flex flex-col gap-1 text-sm">
              {failed.map((entry) => (
                <li key={entry.orderNumber}>
                  {entry.orderNumber} — {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {failure === null ? null : (
          <ErrorNotice
            copiedLabel={failureMessages.copiedLabel}
            copyLabel={failureMessages.copyLabel}
            description={failureMessage(failure, {
              errors: messagesFor().errors,
              failures: messagesFor().apiFailures,
            })}
            requestIdHint={failureMessages.requestIdHint}
            requestIdLabel={failureMessages.requestIdLabel}
            title={failureMessages.title}
            {...(requestId === null ? {} : { requestId })}
          />
        )}
      </div>
    </Modal>
  )
}
