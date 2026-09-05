'use client'

import { Button } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { availableCredit, cardBlock } from '@/lib/payment/cards'
import type { PaymentMethod } from '@/lib/payment/methods'
import { methodId } from '@/lib/payment/methods'
import type { IssuedCard } from '@/lib/payment/payment-api'
import { TOSS_TEST_GUIDE_URL } from '@/lib/payment/toss'
import type { PaymentState } from '@/lib/payment/use-payment'
import type { PaymentMessages } from '@/messages'

const CURRENCY = 'KRW'

export interface PaymentSectionProps {
  /** 고를 수 있는 것 전부. 토스는 키가 있을 때에만 여기 있다 (TASK-0055 4.1). */
  readonly methods: readonly PaymentMethod[]
  readonly loading: boolean
  /** 지금 골라 둔 것의 id. 고를 것이 없으면 `null` 이다. */
  readonly chosen: string | null
  readonly state: PaymentState
  readonly messages: PaymentMessages
  readonly onChoose: (id: string) => void
  readonly onRetry: () => void
}

/**
 * 결제수단 (TASK-0054 · TASK-0055).
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
 *
 * ## 토스는 맨 아래이고, 안내는 고른 사람에게만 (TASK-0055 4.5 · R3)
 *
 * 가상 카드가 기본이고 토스가 선택지다. 순서가 그 판단을 그대로 옮긴 것이라 토스는
 * 언제나 목록의 끝에 있고, 안내는 **그 줄을 고른 사람에게만** 펼쳐진다 — 처음부터
 * 보여 주면 무엇을 골라야 하는지가 더 헷갈린다.
 *
 * **안내는 `label` 밖에 있다.** 안에 넣으면 그 문단 전체가 라디오의 이름이 되어
 * 화면을 보지 않는 사람은 선택지 이름 대신 문단을 듣고, 그 안의 링크는 라디오
 * 안에 든 두 번째 조작 대상이 된다.
 *
 * **키가 없으면 이 목록에 토스가 없다** (4.1). 「지금은 쓸 수 없어요」로도 없다 —
 * 그것은 방문자가 어찌할 수 없는 우리 설정이고, 정지된 카드와 달리 알려 줄 이유가
 * 없다. 지금 이 저장소에 키가 없으므로 그것이 기본 상태다.
 */
export function PaymentSection({
  methods,
  loading,
  chosen,
  state,
  messages,
  onChoose,
  onRetry,
}: PaymentSectionProps) {
  const hasCards = methods.some((method) => method.kind === 'card')

  return (
    <section aria-label={messages.title} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.title}</h2>

      {loading ? <p className="text-fg-muted text-sm">{messages.loading}</p> : null}

      {!loading && !hasCards ? <NoCards messages={messages} /> : null}

      {methods.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          {/*
            `legend` 가 없으면 라디오들이 「무엇을 고르는 것인지」 없이 접근성 트리에
            놓인다. 화면에는 제목이 이미 있으므로 `sr-only` 다 — 배송지와 같은 모양이다.
          */}
          <legend className="sr-only">{messages.chooseMethod}</legend>
          {methods.map((method) => (
            <MethodChoice
              chosen={chosen === methodId(method)}
              key={methodId(method)}
              messages={messages}
              method={method}
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
 *
 * 토스가 있어도 그대로 보여 준다 — 카드가 없다는 것은 여전히 사실이고, 그 사람이
 * 토스로 결제하기로 정하는 것과 카드를 만드는 것은 서로를 막지 않는다.
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

function MethodChoice({
  method,
  chosen,
  messages,
  onChoose,
}: {
  readonly method: PaymentMethod
  readonly chosen: boolean
  readonly messages: PaymentMessages
  readonly onChoose: (id: string) => void
}) {
  if (method.kind === 'toss') {
    return (
      <div className="flex flex-col gap-1">
        <Choice
          chosen={chosen}
          id={methodId(method)}
          onChoose={onChoose}
          title={<span className="text-fg block font-medium">{messages.toss.label}</span>}
        />
        {chosen ? <TossNotice messages={messages} /> : null}
      </div>
    )
  }

  return <CardChoice card={method.card} chosen={chosen} messages={messages} onChoose={onChoose} />
}

/**
 * 테스트 환경이라는 사실과, 그것을 확인할 수 있는 곳 (F7 · 4.7).
 *
 * **카드번호가 없다.** 토스페이먼츠는 테스트용 국내 카드번호를 따로 주지 않고,
 * 대신 테스트 환경에서는 실제 카드 정보를 넣어도 가상으로만 승인된다 — 즉 우리가
 * 여기 적을 수 있는 「테스트 카드번호」라는 값 자체가 없다. 지어내면 그것으로 세 번
 * 실패한 사람은 우리 결제가 고장 났다고 결론 내린다.
 */
function TossNotice({ messages }: { readonly messages: PaymentMessages }) {
  return (
    <div className="border-border bg-surface-muted ml-6 flex flex-col gap-1 rounded-md border p-3">
      <p className="text-fg text-sm font-medium">{messages.toss.noticeTitle}</p>
      <p className="text-fg-muted text-sm">{messages.toss.noticeBody}</p>
      <p>
        <a
          className="text-accent text-sm underline"
          href={TOSS_TEST_GUIDE_URL}
          rel="noreferrer noopener"
          target="_blank"
        >
          {messages.toss.noticeAction}
        </a>
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
  readonly onChoose: (id: string) => void
}) {
  const block = cardBlock(card)

  return (
    <Choice
      chosen={chosen}
      disabled={block !== null}
      id={card.id}
      onChoose={onChoose}
      title={
        <>
          <span className={block === null ? 'text-fg block font-medium' : 'text-fg-muted block'}>
            {messages.cardLabel
              .replace('{brand}', card.brand)
              .replace('{number}', card.maskedNumber)}
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
        </>
      }
    />
  )
}

/** 라디오 한 줄. 카드도 토스도 같은 모양이라 고르는 일이 한 가지로 보인다. */
function Choice({
  id,
  chosen,
  disabled = false,
  title,
  onChoose,
}: {
  readonly id: string
  readonly chosen: boolean
  readonly disabled?: boolean
  readonly title: ReactNode
  readonly onChoose: (id: string) => void
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        checked={chosen}
        className="accent-accent mt-1 size-4"
        disabled={disabled}
        name="payment-method"
        onChange={() => {
          onChoose(id)
        }}
        type="radio"
        value={id}
      />
      <span className="min-w-0">{title}</span>
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
  // 결제창으로 넘어갔다. 끝이 아니라 **넘어감**이고, 그래서 완료 문구가 아니다.
  if (state.status === 'leaving') return messages.toss.leaving

  if (state.status !== 'failed') return ''

  const sentence = messages.refusals[state.refusal]

  if (state.shortfall === null) return sentence

  return sentence.replace('{amount}', formatMoney({ amount: state.shortfall, currency: CURRENCY }))
}
