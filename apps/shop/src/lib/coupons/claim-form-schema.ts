import { COUPON_CODE_INPUT_MAX_LENGTH } from '@shopping/shared'
import { z } from 'zod'

import type { CouponClaimErrorMessages } from '@/messages'

/**
 * 코드 등록 폼이 다루는 유일한 값 — 코드 한 줄 (TASK-0077 F3).
 *
 * **막는 것이 둘뿐인 것이 이 파일의 판단이다.** 비어 있는가와, 계약의 상한을
 * 넘겼는가. 그 둘은 요청을 보내 봐야 알 필요가 없는 사실이고, 나머지 — 열 글자인가,
 * 알파벳 안의 글자인가, 그런 코드가 있는가 — 는 **전부 서버의 몫**이다.
 *
 * 그 선이 여기 있는 이유가 계약에 적혀 있다. 형식이 틀린 코드와 없는 코드를 서버가
 * **같은 답**(`COUPON_CODE_UNKNOWN`)으로 돌려주는 것은 코드를 찍어 보는 쪽에 힌트를
 * 주지 않기 위해서인데, 화면이 「열 글자여야 합니다」로 먼저 거절하면 그 장치가 화면
 * 쪽에서 무너진다 — 열 글자를 채운 입력만 서버에 닿게 되므로, 브라우저를 열어 둔
 * 사람은 「형식은 맞다」를 무료로 알게 된다.
 *
 * 상한만 화면이 아는 이유는 그것이 **보안이 아니라 예의**이기 때문이다. 서른두 자를
 * 넘긴 입력은 어차피 400 인데, 그 왕복을 태우고 나서 말해 줄 이유가 없다.
 */

/** 폼이 들고 있는 값. 입력은 언제나 문자열이다. */
export interface CouponClaimFormValues {
  readonly code: string
}

/**
 * 폼의 스키마 — 계약의 상한에 이 화면의 문장을 입힌 것.
 *
 * `trim` 을 여기서 하지 않는다. 사람이 친 값은 그대로 서버로 가고, 앞뒤 공백을 떼는
 * 것은 정규화의 일부라 서버가 이미 한다(`couponCodeInputSchema` 의 `.trim()`) — 화면이
 * 미리 떼면 「무엇을 보냈나」와 「무엇을 쳤나」가 갈리고, 거절 문장이 가리키는 값이
 * 칸에 남은 값과 달라진다.
 */
export function couponClaimFormSchema(copy: CouponClaimErrorMessages) {
  return z.object({
    code: z
      .string()
      .refine((value) => value.trim().length > 0, copy.required)
      .refine(
        (value) => value.trim().length <= COUPON_CODE_INPUT_MAX_LENGTH,
        copy.tooLong.replace('{max}', String(COUPON_CODE_INPUT_MAX_LENGTH)),
      ),
  })
}
