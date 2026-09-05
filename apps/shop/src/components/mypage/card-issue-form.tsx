'use client'

import type { ApiFailure } from '@shopping/shared'
import { Button, Card, Input } from '@shopping/ui/components'
import { Form, FormError, FormField, useForm } from '@shopping/ui/form'
import { formatMoney } from '@shopping/ui/format'
import { useMemo, useState } from 'react'

import type { CardIssueFormValues } from '@/lib/cards/issue-form-schema'
import {
  CARD_LIMIT_DEFAULT,
  CARD_LIMIT_MAX,
  CARD_LIMIT_MIN,
  cardIssueFormSchema,
  parseAmount,
} from '@/lib/cards/issue-form-schema'
import type { CardIssueMessages, MyPageMessages } from '@/messages'

import { AccountWriteFailure } from './account-notices'

const CURRENCY = 'KRW'

export type CardIssueOutcome =
  { readonly kind: 'issued' } | { readonly kind: 'rejected'; readonly failure: ApiFailure }

/**
 * 카드 발급 — 받는 값은 한도 하나다 (TASK-0058).
 *
 * **한도를 사람이 정하는 것이 이 카드의 요점이다.** 가상 카드가 존재하는 이유가
 * 「한도 초과를 눈으로 본다」이므로 낮은 한도를 일부러 고를 수 있어야 하고, 그래서
 * 서버도 이 숫자를 몸통으로 받는다 (`payment.controller.ts`).
 *
 * **빈 칸으로 시작하지 않는다.** 100만원이 들어 있고, 그 값은 데모 계정이 가입할 때
 * 받는 카드의 한도와 같다 (`DEMO_CARD_LIMIT`). 기본값을 그대로 받아들인 사람이 만든
 * 카드가 이미 갖고 있던 카드와 똑같이 동작한다.
 *
 * **친 숫자를 금액으로 되읽어 준다.** 「10000000」은 자릿수를 세어야 알 수 있고
 * 「₩10,000,000」은 그렇지 않다 — 0을 하나 더 친 것을 잡는 것은 힌트 문장이 아니라
 * 이 되읽기다. 상·하한을 적은 힌트는 **고칠 방향**을 알려 주고, 되읽기는 **지금 값이
 * 무엇인지**를 알려 준다. 둘은 다른 일을 한다.
 *
 * **모달이 아니다.** 배송지 폼과 같은 판단이다 — 이 화면에는 이미 삭제 확인
 * 다이얼로그가 있고, 목록 위의 패널은 초점 덫을 하나도 더 만들지 않는다.
 */
export function CardIssueForm({
  copy,
  messages,
  onSubmit,
  onCancel,
}: {
  readonly copy: CardIssueMessages
  readonly messages: MyPageMessages
  readonly onSubmit: (creditLimit: number) => Promise<CardIssueOutcome>
  readonly onCancel: () => void
}) {
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  /**
   * 경계를 문장에 채워 넣은 뒤에 스키마를 만든다.
   *
   * `issue-form-schema.ts` 가 `formatMoney` 를 부르지 않는 이유는 그것이 **규칙의
   * 파일**이기 때문이다 — 한도가 정수 몇 원 사이여야 하는지는 통화 표기와 아무
   * 상관이 없고, 거기서 서식을 정하면 로케일이 하나 늘 때 규칙 파일이 따라 바뀐다.
   */
  const schema = useMemo(
    () =>
      cardIssueFormSchema({
        notANumber: copy.errors.notANumber,
        outOfRange: bounded(copy.errors.outOfRange),
      }),
    [copy.errors],
  )

  const form = useForm<CardIssueFormValues>({
    schema,
    initialValues: { creditLimit: String(CARD_LIMIT_DEFAULT) },
    onSubmit: async (values) => {
      setFailure(null)

      // 스키마를 지난 값이므로 `null` 이 아니다. 그래도 `??` 를 두는 것은 파싱을
      // 두 번 하지 않으려고 `!` 를 쓰는 것보다 낫기 때문이다 — 규칙이 바뀌어
      // 파싱이 실패하는 날, 화면은 0원을 보내는 대신 서버의 400 을 받는다.
      const outcome = await onSubmit(parseAmount(values.creditLimit) ?? 0)

      if (outcome.kind === 'rejected') {
        setFailure(outcome.failure)
        // 던져야 `useForm` 이 실패 경로를 탄다: 친 값이 칸에 남고, 폼이 초기화되지
        // 않는다. 한도를 다시 치게 만드는 것은 실패에 대한 벌이다.
        throw new CardIssueRejection(outcome.failure)
      }
    },
    submitErrorMessage: copy.submitError,
  })

  const typed = typeof form.values.creditLimit === 'string' ? form.values.creditLimit : ''
  const amount = parseAmount(typed)

  return (
    <Card as="article" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{copy.title}</h2>

      <Form aria-label={copy.title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField
          form={form}
          hint={bounded(copy.limitHint)}
          label={copy.limitLabel}
          name="creditLimit"
          required
        >
          {/*
            `type="text"` 에 `inputMode="numeric"`.

            `type="number"` 였다면 스피너의 `step` 이 규칙을 한 벌 더 갖게 되고
            (1,500원은 1,000 단위 스피너에서 「올바르지 않은 값」이 된다), 브라우저마다
            다른 검증 문구가 이 카탈로그의 문장 위에 겹친다. 숫자 키패드는
            `inputMode` 가 이미 띄워 준다.
          */}
          <Input
            {...form.text('creditLimit')}
            autoComplete="off"
            inputMode="numeric"
            placeholder={copy.limitPlaceholder}
          />
        </FormField>

        {/*
          되읽기는 `polite` 다. 글자를 칠 때마다 읽어 주면 타이핑을 방해하고,
          `polite` 는 손이 멈춘 뒤에 읽는다.
        */}
        <p aria-live="polite" className="text-fg text-sm tabular-nums">
          {amount === null
            ? ''
            : copy.limitEcho.replace('{amount}', formatMoney({ amount, currency: CURRENCY }))}
        </p>

        {/*
          R1 을 한 번 더, **금액을 치는 자리에서.** 화면 위쪽의 안내는 목록을 읽는
          동안 스크롤 밖으로 나가는데, 「원」 단위 숫자를 직접 치는 순간이 이것을
          실제 돈으로 착각하기 가장 쉬운 지점이다.
        */}
        <p className="text-fg-muted text-xs">{copy.virtualHint}</p>

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {copy.cancel}
          </Button>
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.submitting : copy.submit}
          </Button>
        </div>
      </Form>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.submitError} />
      )}
    </Card>
  )
}

/**
 * 상·하한을 금액으로 채운 문장.
 *
 * 숫자를 그대로 넣지 않는 이유는 화면의 다른 모든 금액이 `formatMoney` 를 지나기
 * 때문이다 — 힌트만 「1000」이라고 적혀 있으면 그 칸에 무엇을 쳐야 하는지가 오히려
 * 흐려진다.
 */
function bounded(template: string): string {
  return template
    .replace('{min}', formatMoney({ amount: CARD_LIMIT_MIN, currency: CURRENCY }))
    .replace('{max}', formatMoney({ amount: CARD_LIMIT_MAX, currency: CURRENCY }))
}

class CardIssueRejection extends Error {
  constructor(readonly failure: ApiFailure) {
    super('card issue rejected')
    this.name = 'CardIssueRejection'
  }
}
