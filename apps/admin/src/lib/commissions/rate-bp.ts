import { COMMISSION_RATE_MAX_BP } from '@shopping/shared'

/**
 * 사람이 쓰는 퍼센트와 계약이 쓰는 basis point 사이, **한 곳에서만** 오간다.
 *
 * ## 왜 곱하지 않는가
 *
 * 관리자는 「3.5%」라고 쓰고 계약이 받는 것은 `350` 이다(`settlement.ts` —
 * 1bp = 0.01%). 그 사이를 `Number('3.5') * 100` 으로 건너면 **틀린 요율이 조용히
 * 저장된다**: 부동소수에서 `8.31 * 100` 은 `830.9999999999999` 이고
 * `0.07 * 100` 은 `7.000000000000001` 이다. 앞엣것은 `Math.round` 로 가려지지만
 * 그것은 반올림이 오차를 덮고 있다는 뜻일 뿐이고, 자릿수가 하나 늘면 다시 드러난다.
 *
 * 그래서 여기서는 **곱셈을 하지 않고 문자열을 자른다.** `3.5` 는 정수부 `3` 과
 * 소수부 `5` 이고, 소수부를 두 자리로 채운 `50` 을 정수부 × 100 에 더하면 `350` 이다.
 * 모든 연산이 정수라 오차가 들어올 자리가 없다 — 금액을 정수(원)로 다루는 것과 같은
 * 이유이고(CLAUDE.md 6장), 요율은 그 금액을 곱할 값이라 오차가 더 크게 번진다.
 *
 * ## 왜 이 한 곳뿐인가
 *
 * 화면에는 퍼센트가 나타나는 자리가 여럿이다 — 폼의 입력, 지금 요율, 이력의
 * 「3.5% → 4%」. 그 각각이 자기 방식으로 나누고 곱하면 같은 요율이 자리마다 다르게
 * 보이기 시작하고, 그중 어느 것이 서버로 가는지는 읽는 사람이 알 수 없다. 요청으로
 * 나가는 값을 만드는 함수는 {@link rateBpFromPercent} 하나다.
 */

/** 소수점 아래 몇 자리까지 뜻이 있는가. 1bp = 0.01% 이므로 둘이다. */
export const RATE_PERCENT_DECIMALS = 2

/** 입력이 요율이 되지 못한 네 가지 이유. 문장은 앱의 카탈로그가 갖는다. */
export type RatePercentRefusal = 'required' | 'malformed' | 'too_precise' | 'out_of_range'

export type RatePercentParse =
  | { readonly ok: true; readonly rateBp: number }
  | { readonly ok: false; readonly reason: RatePercentRefusal }

/** 부호도 지수도 없는 십진수 하나. `-1` · `1e3` · `3.` 은 여기서 걸린다. */
const DECIMAL = /^\d+(?:\.\d+)?$/

/**
 * 사람이 친 퍼센트 → 계약의 bp.
 *
 * 상한은 {@link COMMISSION_RATE_MAX_BP} 에서 온다 — 100% 라는 숫자를 여기 적으면
 * 계약과 화면에 상한이 두 벌이 되고, 둘은 갈라진다.
 */
export function rateBpFromPercent(input: string): RatePercentParse {
  const text = input.trim()

  if (text === '') return { ok: false, reason: 'required' }
  if (!DECIMAL.test(text)) return { ok: false, reason: 'malformed' }

  const point = text.indexOf('.')
  const whole = point === -1 ? text : text.slice(0, point)
  const fraction = point === -1 ? '' : text.slice(point + 1)

  if (fraction.length > RATE_PERCENT_DECIMALS) return { ok: false, reason: 'too_precise' }

  // 정수만으로 끝난다. `padEnd` 는 `.5` 를 `50` 으로 채워 「0.5% = 50bp」를 맞춘다.
  const rateBp = Number(whole) * 100 + Number(fraction.padEnd(RATE_PERCENT_DECIMALS, '0'))

  if (rateBp > COMMISSION_RATE_MAX_BP) return { ok: false, reason: 'out_of_range' }

  return { ok: true, rateBp }
}

/**
 * bp → 폼에 다시 채워 넣을 수 있는 퍼센트 문자열.
 *
 * **{@link rateBpFromPercent} 가 그대로 되받는 모양이어야 한다.** 지금 요율을 폼에
 * 채우고 아무것도 고치지 않은 채 저장하면 같은 bp 가 나가야 하고, 그것이 「같은
 * 값으로 바꾸는 것은 바꾸는 것이 아니다」(`commission.service.ts`)가 이력에 빈 줄을
 * 남기지 않는 이유다.
 *
 * 소수점 아래를 **나머지 연산으로** 얻는다. `rateBp / 100` 을 그대로 문자열로
 * 바꾸면 `0.1 + 0.2` 와 같은 종류의 자릿수가 화면에 새어 나오고, 그 문자열을 다시
 * 읽은 값은 원래 bp 가 아니다.
 */
export function percentFromRateBp(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100)
  const fraction = rateBp % 100

  if (fraction === 0) return String(whole)

  // `5` → `05` → `3.05`, `50` → `50` → `5` → `3.5`. 뒤에 붙은 0 은 뜻이 없다.
  const padded = String(fraction).padStart(RATE_PERCENT_DECIMALS, '0').replace(/0$/, '')

  return `${String(whole)}.${padded}`
}
