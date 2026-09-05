'use client'

import { Badge, Button, Card } from '@shopping/ui/components'
import { formatDate, formatMoney } from '@shopping/ui/format'
import { useId } from 'react'

import { availableCredit } from '@/lib/payment/cards'
import type { IssuedCard } from '@/lib/payment/payment-api'
import type { CardWalletMessages, MyPageMessages } from '@/messages'

import { CardLedger } from './card-ledger'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/** 상태마다 다른 배지 색. 색만으로는 말하지 않는다 — 안에 단어가 있다. */
const STATUS_VARIANTS = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DELETED: 'neutral',
} as const

/**
 * 가상 카드 한 장 (TASK-0058 F1 · F2 · F5).
 *
 * **사용 가능액이 계산된 값이라는 것이 보이게 놓는다.** 한도 · 사용 · 사용 가능이
 * 한 `dl` 안에 나란히 있어서 「1,000,000 − 300,000 = 700,000」이 눈으로 확인된다.
 * 서버는 앞의 둘만 주고 마지막은 `availableCredit` 이 뺀 값이다 — 음수를 0으로
 * 접지 않는 이유는 서버가 접지 않는 이유와 같다(한도보다 많이 쓴 카드는 대사가
 * 이미 깨졌다는 신호다).
 *
 * **번호는 마스킹된 것만 온다** (F2). 서버가 전문을 내보내지 않으므로 여기서 가릴
 * 것도 없다 — 화면이 자르는 것이 아니라 **애초에 오지 않는다**는 것이 이 설계의
 * 핵심이고, 그래서 로그에 남을 수도 없다 (TASK-0053 6.2).
 *
 * **정지된 카드도 남는다.** 목록에서 빼면 카드를 정지시킨 사람은 자기 카드가
 * 사라졌다고 믿고 새로 발급받으려 한다 (TASK-0023 4장). 배지가 상태를 말하고,
 * 버튼이 「정지」에서 「정지 해제」로 바뀐다 — 비활성 버튼이 아니라 **다른 버튼**인
 * 이유는, 정지된 카드에서 할 수 있는 일이 없어진 것이 아니라 달라졌기 때문이다.
 *
 * 카드 안의 배치는 컨테이너 쿼리다(`@container/card`, `Card` 가 선언한다). 같은
 * 카드가 한 열짜리 휴대폰 목록과 두 열짜리 데스크톱 목록에 들어가고, 창 너비가
 * 아니라 **자기 너비**로 접힌다 — 밀도 3 × 뷰포트 3 이 아홉 개의 디자인이 아니라
 * 하나의 디자인인 것이 그 덕분이다 (F7).
 */
export function VirtualCard({
  card,
  copy,
  messages,
  busy = false,
  open,
  onToggleLedger,
  onSuspend,
  onActivate,
  onRemove,
}: {
  readonly card: IssuedCard
  readonly copy: CardWalletMessages
  readonly messages: MyPageMessages
  /** 이 카드에 대한 쓰기가 날아가는 중. 끝날 때까지 버튼이 눌리지 않는다. */
  readonly busy?: boolean
  readonly open: boolean
  readonly onToggleLedger: () => void
  readonly onSuspend: () => void
  readonly onActivate: () => void
  readonly onRemove: () => void
}) {
  /**
   * 이 카드의 버튼들이 서로 구별되는 이름.
   *
   * 「정지」가 카드 세 장에 하나씩 있으면 접근성 트리에는 같은 이름의 버튼이 셋
   * 있는 것이고, 버튼 목록을 훑는 사람은 어느 것이 어느 카드인지 알 길이 없다.
   * 브랜드와 번호가 그것을 갈라 준다 — `AddressCard` 가 같은 이유로 같은 일을 한다.
   *
   * `aria-label` 이고 화면에서 감춘 글자가 아니다. 눈에 보이는 글자가 이름의
   * **앞**에 오므로 WCAG 2.5.3(Label in Name)이 지켜지고 음성 제어가 그대로 된다.
   */
  const name = copy.cardLabel.replace('{brand}', card.brand).replace('{number}', card.maskedNumber)
  const ledgerHeadingId = useId()

  return (
    <Card as="li" className="flex flex-col gap-3" variant="outline">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `h2` 다. 화면의 다른 제목은 껍데기의 `h1` 과 발급 폼의 `h2` 뿐이라, 여기가
          `h3` 이면 폼이 닫혀 있을 때마다 단계가 하나 빈다.
        */}
        <h2 className="text-base font-semibold tabular-nums">{name}</h2>
        <Badge variant={STATUS_VARIANTS[card.status]}>{copy.statuses[card.status]}</Badge>
      </div>

      <dl className="text-fg-muted flex flex-col gap-1 text-sm @md/card:flex-row @md/card:gap-6">
        <div className="flex gap-2">
          <dt>{copy.limitLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: card.creditLimit, currency: CURRENCY })}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>{copy.usedLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: card.usedAmount, currency: CURRENCY })}
          </dd>
        </div>
        <div className="flex gap-2">
          {/* 이 화면에 온 사람이 찾는 숫자다. 다른 둘보다 굵게 둔다. */}
          <dt>{copy.availableLabel}</dt>
          <dd className="text-fg font-semibold tabular-nums">
            {formatMoney({ amount: availableCredit(card), currency: CURRENCY })}
          </dd>
        </div>
      </dl>

      <p className="text-fg-subtle text-xs tabular-nums">
        {copy.expiresLabel.replace(
          '{date}',
          formatDate(card.expiresAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE }),
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        {/*
          `aria-controls` 는 원장이 실제로 있을 때만 붙는다. 없는 id 를 가리키는
          속성은 axe `aria-valid-attr-value` 위반이고, 접혀 있는 동안 원장을
          그려 두면 카드마다 요청이 한 벌씩 미리 나간다.
        */}
        <Button
          aria-controls={open ? ledgerHeadingId : undefined}
          aria-expanded={open}
          aria-label={`${open ? copy.closeLedger : copy.openLedger} ${name}`}
          onClick={onToggleLedger}
          size="sm"
          variant="outline"
        >
          {open ? copy.closeLedger : copy.openLedger}
        </Button>

        {/* 비활성이 아니라 **다른 버튼**이다. 정지된 카드에서 할 일이 달라진다. */}
        {card.status === 'ACTIVE' ? (
          <Button
            aria-label={`${copy.suspend} ${name}`}
            loading={busy}
            onClick={onSuspend}
            size="sm"
            variant="ghost"
          >
            {copy.suspend}
          </Button>
        ) : (
          <Button
            aria-label={`${copy.activate} ${name}`}
            loading={busy}
            onClick={onActivate}
            size="sm"
            variant="ghost"
          >
            {copy.activate}
          </Button>
        )}

        <Button
          aria-label={`${copy.remove} ${name}`}
          loading={busy}
          onClick={onRemove}
          size="sm"
          variant="ghost"
        >
          {copy.remove}
        </Button>
      </div>

      {open ? (
        <CardLedger
          card={card}
          copy={copy.ledger}
          headingId={ledgerHeadingId}
          messages={messages}
        />
      ) : null}
    </Card>
  )
}
