import { z } from 'zod'

import type { CardIssueErrorMessages } from '@/messages'

/**
 * 발급 폼이 다루는 유일한 값 — 한도 (TASK-0058).
 *
 * **상·하한은 지어낸 것이 아니라 서버의 것이다.** `payment.controller.ts` 의
 * `issueCardSchema` 가 `z.int().min(1_000).max(10_000_000)` 이고, 여기 적힌 두
 * 숫자는 그것을 그대로 옮긴 것이다 — 폼이 더 좁게 막으면 서버가 허락하는 값을 화면이
 * 거절하고, 더 넓게 두면 사람이 400 을 보고서야 알게 된다.
 *
 * 그 두 숫자에 이유가 있다는 것이 중요하다.
 *
 * - **상한 10,000,000원.** 원 단위 정수라 0을 하나 더 치면 열 배가 되고, 그 카드로는
 *   무엇을 사도 한도 초과가 나지 않아 **재현 장치로서 쓸모가 없어진다** — 이 카드가
 *   존재하는 이유가 「한도 초과를 눈으로 본다」인데 그것이 사라진다.
 * - **하한 1,000원.** 1원짜리 카드는 어떤 주문도 통과시키지 못하므로, 만들자마자
 *   못 쓰는 카드가 된다.
 */
export const CARD_LIMIT_MIN = 1_000
export const CARD_LIMIT_MAX = 10_000_000

/**
 * 처음 들어 있는 한도 — 100만원.
 *
 * **데모 계정이 가입할 때 받는 카드와 같은 값**이다
 * (`virtual-card.service.ts` 의 `DEMO_CARD_LIMIT`). 기본값을 그대로 받아들인 사람이
 * 만든 카드가 이미 갖고 있던 카드와 똑같이 동작하는 것이, 빈 칸을 주고 「알아서
 * 정하세요」 하는 것보다 낫다.
 *
 * 씨앗 카탈로그의 상품이 대체로 수만~수십만원이므로 이 한도는 몇 번의 주문을 덮고,
 * 그러면서도 상한(1,000만원)과는 한 자리 떨어져 있다 — **한도 초과를 만들어 보려면
 * 일부러 낮춰야 한다**는 뜻이고, 그 선택이 이 화면에서 가능하다는 것이 요점이다.
 */
export const CARD_LIMIT_DEFAULT = 1_000_000

/** 발급 폼이 들고 있는 값. 입력은 언제나 문자열이다. */
export interface CardIssueFormValues {
  readonly creditLimit: string
}

/**
 * 사람이 친 것에서 원 단위 정수를 읽는다. 읽을 수 없으면 `null`.
 *
 * **쉼표를 지운다.** 「1,000,000」은 이 화면이 바로 위에서 금액을 보여 준 방식이고,
 * 그것을 그대로 따라 친 사람에게 형식 오류를 돌려주는 것은 화면이 자기 관습을
 * 거절하는 일이다. 공백도 같은 이유로 지운다.
 *
 * 정규식으로 **숫자만** 남는지를 먼저 본다. `Number('1e7')` 은 10,000,000 이고
 * `Number('1.5')` 는 1.5 이며 둘 다 「사람이 친 원 단위 금액」이 아니다 —
 * `Number()` 에 곧장 넘기면 그 둘이 조용히 통과한다.
 */
export function parseAmount(raw: string): number | null {
  const digits = raw.replaceAll(',', '').replaceAll(' ', '').trim()

  if (!/^\d+$/u.test(digits)) return null

  const amount = Number(digits)

  return Number.isSafeInteger(amount) ? amount : null
}

/**
 * 폼의 스키마 — 서버의 규칙에 이 화면의 문장을 입힌 것.
 *
 * 두 문장으로 갈리는 이유는 **사람이 할 일이 다르기** 때문이다. 「숫자가 아니다」는
 * 다시 치라는 뜻이고, 「범위 밖이다」는 얼마와 얼마 사이여야 하는지를 알아야 고칠 수
 * 있다 — 그래서 뒤의 문장은 두 경계를 자기 안에 싣는다.
 */
export function cardIssueFormSchema(copy: CardIssueErrorMessages) {
  return z.object({
    creditLimit: z
      .string()
      .refine((value) => parseAmount(value) !== null, copy.notANumber)
      .refine((value) => {
        const amount = parseAmount(value)

        return amount === null || (amount >= CARD_LIMIT_MIN && amount <= CARD_LIMIT_MAX)
      }, copy.outOfRange),
  })
}
