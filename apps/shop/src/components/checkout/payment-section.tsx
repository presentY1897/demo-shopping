'use client'

import { Button } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import { availableCredit, cardBlock } from '@/lib/payment/cards'
import type { IssuedCard } from '@/lib/payment/payment-api'
import type { PaymentState } from '@/lib/payment/use-payment'
import type { PaymentMessages } from '@/messages'

const CURRENCY = 'KRW'

export interface PaymentSectionProps {
  readonly cards: readonly IssuedCard[]
  readonly loading: boolean
  /** 지금 골라 둔 카드. 고를 것이 없으면 `null` 이다. */
  readonly chosen: string | null
  readonly state: PaymentState
  readonly messages: PaymentMessages
  readonly onChoose: (cardId: string) => void
  readonly onRetry: () => void
}

/**
 * 결제수단 (TASK-0054).
 *
 * **누르는 것은 여기 없다.** 결제를 시작하는 버튼은 주문서의 「주문하기」 하나이고
 * (`checkout-screen.tsx` 가 그 이유를 적는다), 이 영역이 하는 일은 **무엇으로
 * 결제할지 고르게 하고 그 결과를 말해 주는 것**이다. 실패한 뒤에만 버튼이 하나
 * 생긴다 — 그때 다시 해야 하는 것은 주문이 아니라 결제뿐이기 때문이다.
 *
 * **쓸 수 없는 카드도 보여 준다** (TASK-0023 4장). 정지된 카드를 목록에서 빼면 카드를
 * 정지시킨 사람은 자기 카드가 사라졌다고 믿고, 다시 발급받으려 한다. 보여 주되
 * 고르지 못하게 하고 **이유를 그 옆에 적는다.**
 *
 * **한도가 모자란 카드는 고를 수 있다.** 미리 막으면 「한도 초과」라는 이 TASK 의
 * 핵심 시연(2장)이 화면에서 사라지고, 애초에 승인 여부를 정하는 것은 우리가 읽어 둔
 * 숫자가 아니라 서버의 원장이다 — 목록을 읽은 뒤에 다른 결제가 지나갔을 수 있다.
 */
export function PaymentSection({
  cards,
  loading,
  chosen,
  state,
  messages,
  onChoose,
  onRetry,
}: PaymentSectionProps) {
  return (
    <section aria-label={messages.title} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.title}</h2>

      {loading ? <p className="text-fg-muted text-sm">{messages.loading}</p> : null}

      {!loading && cards.length === 0 ? <NoCards messages={messages} /> : null}

      {cards.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          {/*
            `legend` 가 없으면 라디오들이 「무엇을 고르는 것인지」 없이 접근성 트리에
            놓인다. 화면에는 제목이 이미 있으므로 `sr-only` 다 — 배송지와 같은 모양이다.
          */}
          <legend className="sr-only">{messages.chooseCard}</legend>
          {cards.map((card) => (
            <CardChoice
              card={card}
              chosen={chosen === card.id}
              key={card.id}
              messages={messages}
              onChoose={onChoose}
            />
          ))}
        </fieldset>
      )}

      <Result messages={messages} onRetry={onRetry} state={state} />
    </section>
  )
}

/**
 * 카드가 한 장도 없는 사람.
 *
 * 카드를 만드는 화면으로 보낸다 (TASK-0058). 결제하려다 카드가 없다는 것을 안
 * 사람에게 필요한 것은 「마이페이지 어딘가」가 아니라 **발급 폼 자체**다.
 */
function NoCards({ messages }: { readonly messages: PaymentMessages }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-fg text-sm font-medium">{messages.noneTitle}</p>
      <p className="text-fg-muted text-sm">
        {messages.noneBody}{' '}
        <Link className="text-accent underline" href="/mypage/cards">
          {messages.noneAction}
        </Link>
      </p>
    </div>
  )
}

function CardChoice({
  card,
  chosen,
  messages,
  onChoose,
}: {
  readonly card: IssuedCard
  readonly chosen: boolean
  readonly messages: PaymentMessages
  readonly onChoose: (cardId: string) => void
}) {
  const block = cardBlock(card)

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        checked={chosen}
        className="accent-accent mt-1 size-4"
        disabled={block !== null}
        name="payment-card"
        onChange={() => {
          onChoose(card.id)
        }}
        type="radio"
        value={card.id}
      />
      <span className="min-w-0">
        <span className={block === null ? 'text-fg block font-medium' : 'text-fg-muted block'}>
          {messages.cardLabel.replace('{brand}', card.brand).replace('{number}', card.maskedNumber)}
        </span>
        <span className="text-fg-subtle block tabular-nums">
          {messages.available.replace(
            '{amount}',
            formatMoney({ amount: availableCredit(card), currency: CURRENCY }),
          )}
        </span>
        {block === null ? null : (
          <span className="text-danger block">{messages.blocked[block]}</span>
        )}
      </span>
    </label>
  )
}

/**
 * 지금 어디까지 갔는가, 또는 왜 못 갔는가.
 *
 * **영역이 늘 있고 문장만 바뀐다.** 실패했을 때 비로소 나타나는 `aria-live` 는
 * 브라우저가 구독할 시점에 이미 내용이 들어 있어서 읽히지 않는 일이 잦다.
 *
 * `polite` 인 이유는 타이머와 같다 — 결제가 도는 동안 사람이 하던 일을 끊을 만큼
 * 급한 소식이 아니다. 실패도 마찬가지다: 다음에 할 일(다른 카드)이 화면에 그대로
 * 남아 있으므로 가로채 읽어 줄 이유가 없다.
 */
function Result({
  state,
  messages,
  onRetry,
}: {
  readonly state: PaymentState
  readonly messages: PaymentMessages
  readonly onRetry: () => void
}) {
  return (
    <>
      <p
        aria-live="polite"
        className={
          state.status === 'failed' ? 'text-danger pt-2 text-sm' : 'text-fg-muted pt-2 text-sm'
        }
      >
        {sentenceOf(state, messages)}
      </p>

      {state.status === 'failed' ? (
        <div className="flex flex-col gap-2 pt-2">
          {/* 4.3 — 실패가 곧 포기는 아니다. 예약이 남아 있다는 것을 먼저 말한다. */}
          <p className="text-fg-muted text-xs">{messages.holdKept}</p>
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            {messages.retry}
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** 지금 상태를 한 문장으로. 아무 일도 없는 동안에는 빈 문장이다. */
function sentenceOf(state: PaymentState, messages: PaymentMessages): string {
  if (state.status === 'running') return messages.progress[state.step]

  if (state.status !== 'failed') return ''

  const sentence = messages.refusals[state.refusal]

  if (state.shortfall === null) return sentence

  return sentence.replace('{amount}', formatMoney({ amount: state.shortfall, currency: CURRENCY }))
}
