import { COUPON_CODE_ALPHABET, COUPON_CODE_LENGTH, COUPON_CODE_PATTERN } from '@shopping/shared'

/**
 * 쿠폰 코드 (TASK-0072 4장).
 *
 * `order-number.ts` 와 같은 Crockford base32 이고, **다른 것이 둘**이다.
 *
 * - **날짜 접두어가 없다.** 주문번호의 `YYYYMMDD-` 는 문의를 받는 사람이 어느
 *   기간을 뒤져야 하는지 알기 위한 것인데, 쿠폰 코드를 들고 오는 사람은 문의를
 *   하는 것이 아니라 **입력을 하는 것**이다. 접두어는 칠 글자를 늘릴 뿐이다.
 * - **여덟 자리가 아니라 열 자리다.** 주문번호는 이미 자기 주문인 사람이 불러
 *   주는 번호라 맞히는 것이 의미가 없지만, 쿠폰 코드는 **맞히면 이득이 되는
 *   문자열**이다. 32^8(40비트)은 살아 있는 코드가 수천 개일 때 무차별 대입이
 *   현실적인 범위에 들어오고, 32^10(50비트)은 그렇지 않다.
 *
 * 그리고 **읽어 넣는 쪽을 위해 정규화가 있다.** 이것이 이 파일의 절반이고,
 * 주문번호에는 없던 부분이다 — 주문번호는 사람이 불러 주면 받는 쪽이 화면에서
 * 확인하지만, 쿠폰 코드는 배너를 보고 혼자 옮겨 적은 다음 「잘못된 코드입니다」를
 * 받는다. 그 화면은 무엇이 틀렸는지 말해 주지 않는다.
 */

/**
 * 헷갈리는 글자를 알파벳 안의 글자로 접는다 — Crockford 의 규칙이다.
 *
 * 알파벳에 `I` · `L` · `O` 가 **없기** 때문에 이 접기는 손해가 없다: 어떤 코드도
 * 그 글자들을 담고 있지 않으므로, 그것을 `1` · `0` 으로 읽는 것이 다른 코드를
 * 가리킬 수 없다. 「0을 O로 옮겨 적은 사람」과 「진짜 O가 든 코드」가 충돌할
 * 여지가 구조적으로 없다는 뜻이다.
 *
 * `U` 는 여기 없다. 알파벳에서 뺀 이유가 **낱말이 만들어지는 것을 막기 위해서**
 * 이지 헷갈려서가 아니라, 접어 줄 대상이 없다 — `U` 가 든 입력은 그냥 없는
 * 코드다.
 */
const CONFUSABLES: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' }

/**
 * 사람이 친 코드를 저장된 모양으로 되돌린다.
 *
 * 대문자로 올리고, 하이픈·공백을 버리고, 헷갈리는 글자를 접는다. **버리는 것을
 * 「구분자」로 한정하는 것이 중요하다** — 알파벳 밖 글자를 전부 버리면
 * `WELCOME!!` 같은 입력이 우연히 열 글자가 되어 남의 코드를 가리킬 수 있다.
 * 여기서는 사람이 읽기 좋으라고 끼워 넣는 두 글자만 사라진다.
 *
 * 모양이 맞지 않으면 `null` 이다. 부르는 쪽은 그것을 「없는 코드」와 같게 다룬다 —
 * 형식 오류와 없는 코드를 갈라 답하면 **코드를 찍어 보는 쪽에 힌트가 된다.**
 */
export function normalizeCouponCode(input: string): string | null {
  let normalized = ''

  for (const char of input.trim().toUpperCase()) {
    if (char === '-' || char === ' ') continue

    normalized += CONFUSABLES[char] ?? char
  }

  return COUPON_CODE_PATTERN.test(normalized) ? normalized : null
}

/**
 * 바이트열을 코드로 옮긴다. `bytes` 는 {@link COUPON_CODE_LENGTH} 바이트여야 한다.
 *
 * 나머지 연산 하나뿐인 것도 `order-number.ts` 와 같다 — 256 이 32의 배수라
 * `byte % 32` 에 치우침이 없다. 치우침이 있으면 앞쪽 글자가 더 자주 나오고, 그것은
 * 코드 공간을 실질적으로 좁힌다.
 */
export function couponCodeFrom(bytes: Uint8Array): string {
  let code = ''

  for (const byte of bytes) code += COUPON_CODE_ALPHABET.charAt(byte % COUPON_CODE_ALPHABET.length)

  return code
}

/**
 * 사람에게 보여 줄 때의 모양: `XXXXX-XXXXX`.
 *
 * **저장되는 값이 아니다.** 하이픈을 저장하면 「하이픈이 있는 코드」와 「없는
 * 코드」가 다른 문자열이 되고, 그때 유니크 인덱스는 같은 코드를 두 번 허용한다.
 * 구분자는 읽는 순간에만 붙이고, 입력에서는 {@link normalizeCouponCode} 가 뗀다.
 */
export function formatCouponCode(code: string): string {
  const half = COUPON_CODE_LENGTH / 2

  return `${code.slice(0, half)}-${code.slice(half)}`
}
