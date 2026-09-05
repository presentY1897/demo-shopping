/**
 * 결제창에서 돌아온 것을 읽는 규칙 (TASK-0055 4.2 · 6.2 Q5 강화).
 *
 * 순수 함수라 분기를 전부 셀 수 있다. 이 파일이 재는 것은 「토스가 잘 도는가」가
 * 아니라 **「우리가 토스를 잘못 믿지 않는가」**다 — 쿼리를 믿을 수 있는가, 승인이
 * 거절된 것인가 요청이 실패한 것인가, 그리고 그 뒤에 「다시 결제하기」를 권해도
 * 되는가.
 */

import { apiErrorBody } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  checkoutIdOf,
  confirmFailureOf,
  offersRetry,
  TOSS_CANCEL_CODE,
  tossConfirmFailures,
  tossFailureKind,
  tossSuccessReturn,
} from '@/lib/payment/toss-return'

const RETURNED = {
  amount: '476500',
  checkout: '019596d0-1f1c-7c2e-9a0e-5e0000000001',
  orderId: '019596d0-1f1c-7c2e-9a0e-6b0000000001',
  paymentKey: 'tviva20260905123456ABCD',
} as const

function query(overrides: Readonly<Record<string, string | null>> = {}): URLSearchParams {
  const params = new URLSearchParams(RETURNED)

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }

  return params
}

/** 서버가 보낸 거절 하나, 클라이언트가 받는 모양 그대로. */
function refusal(status: number, code: string): ApiClientError {
  return new ApiClientError({
    body: apiErrorBody(code, '거절'),
    kind: 'http',
    message: 'refused',
    status,
  })
}

describe('성공 주소의 쿼리를 읽는다', () => {
  it('reads what Toss sent and what we sent ourselves', () => {
    expect(tossSuccessReturn(query())).toEqual({
      amount: 476_500,
      checkoutId: RETURNED.checkout,
      // 토스가 `orderId` 라 부르는 것은 **우리 결제 id** 다 (4.3).
      paymentId: RETURNED.orderId,
      paymentKey: RETURNED.paymentKey,
    })
  })

  it.each(['orderId', 'paymentKey', 'amount'])('is null without %s', (missing) => {
    // `null` 은 「실패했다」가 아니라 「결제창에서 온 것이 아니다」이다 — 주소를
    // 직접 연 사람에게는 승인을 시도할 것이 없다.
    expect(tossSuccessReturn(query({ [missing]: null }))).toBeNull()
  })

  it('is null for an empty key or id, which is not the same as a present one', () => {
    expect(tossSuccessReturn(query({ paymentKey: '' }))).toBeNull()
    expect(tossSuccessReturn(query({ orderId: '' }))).toBeNull()
  })

  it.each(['1e5', '0x64', '-1', '476500.0', '  476500'])(
    'refuses %s as an amount rather than passing it on',
    (amount) => {
      // `Number()` 를 썼다면 앞의 둘이 숫자가 된다. 어차피 서버가 거절할 요청을 한
      // 번 더 보내는 것뿐이라 여기서 멈춘다.
      expect(tossSuccessReturn(query({ amount }))).toBeNull()
    },
  )

  it('still reads the rest when we forgot to carry the checkout id', () => {
    expect(tossSuccessReturn(query({ checkout: null }))?.checkoutId).toBeNull()
    expect(checkoutIdOf(query({ checkout: '' }))).toBeNull()
  })
})

describe('승인이 던진 것을 할 말로', () => {
  it('names the amount mismatch, because that one has its own next step (F2)', () => {
    expect(confirmFailureOf(refusal(400, 'PAYMENT_AMOUNT_MISMATCH'))).toBe('amount_mismatch')
  })

  it('names an already processed payment, because retrying it would pay twice', () => {
    expect(confirmFailureOf(refusal(409, 'PAYMENT_TRANSITION_REFUSED'))).toBe('already_settled')
  })

  it('names a payment still being looked up, because that one says "wait" (D-220)', () => {
    // **두 409 가 반대 방향의 문장을 낸다.** 위의 것은 「이미 끝났으니 결과를
    // 확인하세요」이고 이것은 「아직 안 끝났으니 기다리세요」다 — 상태로 갈랐다면
    // 둘 중 하나를 반드시 틀리게 말한다.
    expect(confirmFailureOf(refusal(409, 'PAYMENT_AWAITING_RESULT'))).toBe('awaiting_result')
  })

  it('sends an unknown refusal to "we do not know"', () => {
    // 「토스로 시작한 결제가 아니다」는 사람이 고칠 수 있는 종류가 아니라 우리
    // 버그다. 그 경우에 다시 결제하라고 시키면 같은 실패를 반복시킨다.
    expect(confirmFailureOf(refusal(400, 'PAYMENT_PROVIDER_MISMATCH'))).toBe('unreachable')
    expect(confirmFailureOf(refusal(500, 'INTERNAL_ERROR'))).toBe('unreachable')
  })

  it('sends a lost request there too', () => {
    expect(confirmFailureOf(new ApiClientError({ kind: 'network', message: 'down' }))).toBe(
      'unreachable',
    )
    expect(confirmFailureOf(new Error('boom'))).toBe('unreachable')
  })
})

describe('다시 결제하기를 권해도 되는가', () => {
  it.each(['declined', 'amount_mismatch', 'unreachable'] as const)('offers it after %s', (why) => {
    expect(offersRetry(why)).toBe(true)
  })

  it.each(['already_settled', 'unsettled', 'awaiting_result', 'invalid_return'] as const)(
    'withholds it after %s',
    (why) => {
      // 앞의 셋은 저쪽에 승인이 남아 있을 수 있다 — 다시 결제하면 두 번 낸다.
      // `awaiting_result` 는 서버가 그 재시도를 아예 막아 두기까지 한다 (D-220).
      // 마지막은 애초에 돌아갈 주문서가 없다.
      expect(offersRetry(why)).toBe(false)
    },
  )

  it('has an answer for every failure there is', () => {
    // 사유가 하나 늘면 이 줄이 아니라 `pnpm typecheck` 이 먼저 깨진다. 그래도
    // 세어 두는 이유는 목록이 늘었을 때 위의 두 갈래 중 어디에 넣을지가 **판단**
    // 이기 때문이다 — 잊으면 「다시 결제하기」가 조용히 붙는다.
    expect(tossConfirmFailures).toHaveLength(7)
  })
})

describe('실패 주소가 말하는 것', () => {
  it('tells a closed window apart from everything else', () => {
    // 마음이 바뀐 사람에게 「결제에 실패했어요」라고 말하면 우리 쪽이 고장 난
    // 것처럼 들린다. 실패로 돌아오는 것 중 절대다수가 이 경우다.
    expect(tossFailureKind(TOSS_CANCEL_CODE)).toBe('canceled')
    expect(tossFailureKind('REJECT_CARD_COMPANY')).toBe('refused')
    expect(tossFailureKind(null)).toBe('refused')
  })
})
