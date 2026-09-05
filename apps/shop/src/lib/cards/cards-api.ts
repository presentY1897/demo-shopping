import type { ApiCallOptions } from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'
import type { IssuedCard } from '@/lib/payment/payment-api'
import { issuedCardSchema } from '@/lib/payment/payment-api'

/**
 * 카드를 **관리하는** 쪽의 라우트들 (TASK-0058).
 *
 * 목록과 결제는 `@/lib/payment/payment-api` 가 이미 부르고 있고(TASK-0054), 이
 * 파일은 그 위에 발급·정지·해제·삭제와 **사용 내역**을 얹는다. 카드의 모양을 다시
 * 적지 않고 `issuedCardSchema` 를 들여오는 이유는 그것이 같은 카드이기 때문이다 —
 * 여기서 한 벌 더 적으면 두 화면이 서로 다른 카드를 믿게 된다.
 *
 * **사용 내역 라우트는 TASK-0053 이 만들지 않았다** (4.1). 0053 이 만든 것은
 * 발급·목록·정지·삭제까지이고, 「환불이 잘 됐는지 잔액으로 확인」하는 동선은 원장을
 * 읽어야 완성되므로 라우트가 하나 더 생겼다.
 */

/** 발급·정지·해제가 돌려주는 봉투. 목록과 같은 모양의 카드 한 장이다. */
const cardResponseSchema = z.object({ card: issuedCardSchema })

/**
 * 원장 한 줄이 무엇이었는가.
 *
 * 세 이름이 **되돌리는 방향**으로 갈린다 — 승인은 한도를 쓰고, 취소와 환불은
 * 돌려준다. 취소와 환불이 한 이름이 아닌 것은 그 둘이 일어나는 시점이 다르기
 * 때문이다: 취소는 매입 전, 환불은 매입 뒤다.
 */
export const cardTransactionKinds = ['CHARGE', 'CANCEL', 'REFUND'] as const

export type CardTransactionKind = (typeof cardTransactionKinds)[number]

/**
 * 사용 내역 한 줄.
 *
 * **`amount` 에 부호가 있다.** 승인은 양수, 취소·환불은 음수다. 종류로 방향을
 * 추측하지 않는 이유는 그것이 두 번째 진실이 되기 때문이다 — 서버가 부호를 보내는데
 * 화면이 `kind` 를 보고 다시 정하면, 둘이 어긋나는 날 어느 쪽이 맞는지 알 수 없다.
 *
 * **주문번호는 결제를 거친 줄만 갖는다** (4.2). 카드는 결제 말고도 쓸 수 있게
 * 만들어 두었으므로 `null` 인 줄은 링크가 없는 줄이지 잘못된 줄이 아니다.
 *
 * 서버가 주문번호를 **함께** 싣는 것도 4.2 다. 원장 행이 들고 있는 것은 결제 id 라
 * 화면이 그것으로 다시 물어보게 두면 줄마다 왕복이 하나씩 붙는다.
 */
export const cardTransactionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(cardTransactionKinds),
  amount: z.int(),
  /** 이 사건 직후의 `usedAmount`. 사용 가능액은 한도에서 이것을 뺀 것이다. */
  balanceAfter: z.int().min(0),
  createdAt: z.iso.datetime(),
  orderNumber: z.string().nullable(),
  orderId: z.uuid().nullable(),
})

export type CardTransaction = z.infer<typeof cardTransactionSchema>

export const cardTransactionsResponseSchema = z.object({
  transactions: z.array(cardTransactionSchema),
})

/**
 * 몸통 없는 대답.
 *
 * `DELETE /cards/:id` 는 204 다. `createApiClient` 의 `readJson` 이 빈 몸통을
 * `undefined` 로 돌려주므로 **그것이 이 응답의 실제 모양**이고, 아무 스키마나 넘겨
 * 놓으면 파싱이 조용히 실패한다 — 스키마는 생략할 수 있는 인자가 아니다.
 */
const noContentSchema = z.undefined()

/**
 * 카드를 발급한다.
 *
 * 한도의 상·하한은 화면이 아니라 **서버가 정한다** (`payment.controller.ts` 의
 * `issueCardSchema`). 여기서 다시 막지 않는 이유는 그 검사가 폼의 일이기 때문이고
 * (`issue-form-schema.ts`), 폼이 놓친 값은 400 으로 돌아온다.
 */
export async function issueCard(
  creditLimit: number,
  options?: ApiCallOptions,
): Promise<IssuedCard> {
  const { card } = await getApiClient().request({
    path: '/cards',
    method: 'POST',
    body: { creditLimit },
    schema: cardResponseSchema,
    ...options,
  })

  return card
}

/**
 * 카드를 정지한다. **삭제가 아니다** — 해제하면 그대로 돌아온다.
 *
 * 정지된 카드가 목록에서 사라지지 않는 것도 그래서다 (TASK-0023 4장): 감추면 카드를
 * 정지시킨 사람은 자기 카드가 사라졌다고 믿고 새로 발급받으려 한다.
 */
export async function suspendCard(id: string, options?: ApiCallOptions): Promise<IssuedCard> {
  const { card } = await getApiClient().request({
    path: `/cards/${id}/suspend`,
    method: 'POST',
    schema: cardResponseSchema,
    ...options,
  })

  return card
}

export async function activateCard(id: string, options?: ApiCallOptions): Promise<IssuedCard> {
  const { card } = await getApiClient().request({
    path: `/cards/${id}/activate`,
    method: 'POST',
    schema: cardResponseSchema,
    ...options,
  })

  return card
}

/** 카드를 지운다. 서버에서는 소프트 삭제다 — 원장이 이 카드를 가리킨다. */
export async function deleteCard(id: string, options?: ApiCallOptions): Promise<void> {
  await getApiClient().request({
    path: `/cards/${id}`,
    method: 'DELETE',
    schema: noContentSchema,
    ...options,
  })
}

/**
 * 이 카드의 사용 내역. 오래된 것부터다.
 *
 * 서버가 준 순서를 그대로 쓴다. 화면이 다시 정렬하면 서버와 갈릴 수 있는 두 번째
 * 규칙이 생기고, 시간순이라야 `balanceAfter` 가 잔액의 **이야기**가 된다 — 「썼고,
 * 돌려받았고, 그래서 지금 이만큼」이 한 방향으로 읽힌다.
 */
export function fetchCardTransactions(
  id: string,
  options?: ApiCallOptions,
): Promise<readonly CardTransaction[]> {
  return getApiClient()
    .request({
      path: `/cards/${id}/transactions`,
      schema: cardTransactionsResponseSchema,
      ...options,
    })
    .then(({ transactions }) => transactions)
}
