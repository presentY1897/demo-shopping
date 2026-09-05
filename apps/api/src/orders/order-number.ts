/**
 * 주문번호 (TASK-0049 4장).
 *
 * `YYYYMMDD-XXXXXXXX`. 사람이 읽고 **전화로 불러 줄 수 있어야 한다** — 그것이 id
 * 가 이미 있는데도 따로 두는 이유의 전부다.
 *
 * 뒤의 여덟 자리는 Crockford base32 다. `I` · `L` · `O` · `U` 가 없어서 0/O 와
 * 1/I 를 헷갈릴 수 없고, `U` 는 뜻하지 않은 낱말이 만들어지는 것을 막는다. 32^8 =
 * 40비트라 하루 1,000건에서 충돌 확률은 10^-6 미만이지만 **0은 아니고**, 0이 아닌
 * 것을 애플리케이션이 보증할 방법은 없다 — 그래서 `Order_orderNumber_key` 가 있고
 * 서비스가 한 번 다시 뽑는다.
 *
 * 날짜가 앞에 오는 것은 사람을 위해서다. 「20260905-」로 시작하는 번호를 들으면
 * 언제 주문했는지가 바로 보이고, 문의를 받는 쪽이 어느 기간을 뒤져야 하는지 안다.
 */

/** 0/O · 1/I 를 헷갈릴 수 없는 32글자. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 뒤쪽 난수의 길이. */
export const ORDER_NUMBER_SUFFIX_LENGTH = 8

/**
 * `YYYYMMDD` — **한국 시각 기준**이다.
 *
 * UTC 로 찍으면 밤 9시 이후의 주문이 전날 번호를 받는다. 번호를 읽는 사람은 한국에
 * 있고, 「9월 5일 밤에 시킨 것」이 `20260904-` 로 시작하면 그 번호는 자기 일을 못
 * 한다.
 */
export function orderDateOf(now: Date): string {
  const seoul = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = seoul.getUTCFullYear()
  const month = seoul.getUTCMonth() + 1
  const day = seoul.getUTCDate()

  return `${String(year)}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

/**
 * 바이트열을 알파벳으로 옮긴다.
 *
 * 나머지 연산 하나뿐이다. 256 은 32의 배수라 `byte % 32` 에 치우침이 없다 — 32가
 * 아닌 알파벳이었다면 앞쪽 글자가 더 자주 나온다.
 */
export function suffixFrom(bytes: Uint8Array): string {
  let suffix = ''

  for (const byte of bytes) suffix += ALPHABET.charAt(byte % ALPHABET.length)

  return suffix
}

/** 한 건의 주문번호. `bytes` 는 {@link ORDER_NUMBER_SUFFIX_LENGTH} 바이트여야 한다. */
export function orderNumberOf(now: Date, bytes: Uint8Array): string {
  return `${orderDateOf(now)}-${suffixFrom(bytes)}`
}
