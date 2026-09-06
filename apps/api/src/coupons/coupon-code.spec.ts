import { randomBytes } from 'node:crypto'

import { COUPON_CODE_ALPHABET, COUPON_CODE_LENGTH, COUPON_CODE_PATTERN } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { couponCodeFrom, formatCouponCode, normalizeCouponCode } from './coupon-code.js'

/**
 * 쿠폰 코드 (TASK-0072 6.2, Q5 강화).
 *
 * 재는 것이 둘이고 **둘 다 조용히 틀린다.** 생성이 치우치면 코드 공간이 실질적으로
 * 좁아지는데 어떤 검사도 빨개지지 않고, 정규화가 너무 너그러우면 아무 문자열이나
 * 우연히 남의 코드를 가리킨다 — 그것도 사고가 난 뒤에야 보인다.
 */

describe('코드 생성', () => {
  it('언제나 저장 가능한 모양이다', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(couponCodeFrom(randomBytes(COUPON_CODE_LENGTH))).toMatch(COUPON_CODE_PATTERN)
    }
  })

  it('바이트 하나가 글자 하나가 된다', () => {
    expect(couponCodeFrom(Uint8Array.from([0, 1, 2]))).toBe('012')
  })

  it('256이 32의 배수라 치우침이 없다', () => {
    // 0~255 를 한 번씩 넣으면 32글자가 정확히 여덟 번씩 나와야 한다. 알파벳이
    // 32가 아니었다면 앞쪽 글자가 더 자주 나오고, 그 치우침은 코드 공간을 좁힌다.
    const code = couponCodeFrom(Uint8Array.from({ length: 256 }, (_unused, index) => index))
    const counts = new Map<string, number>()

    for (const char of code) counts.set(char, (counts.get(char) ?? 0) + 1)

    expect(counts.size).toBe(COUPON_CODE_ALPHABET.length)
    expect([...counts.values()]).toEqual(Array.from({ length: 32 }, () => 8))
  })

  it('헷갈리는 네 글자를 쓰지 않는다', () => {
    // `I` · `L` · `O` 는 `1` · `0` 과 헷갈리고 `U` 는 뜻하지 않은 낱말을 만든다.
    // 알파벳에 없다는 것이 아래 정규화의 접기를 **손해 없는 것**으로 만든다.
    for (const char of 'ILOU') expect(COUPON_CODE_ALPHABET).not.toContain(char)
  })
})

describe('정규화 — 사람이 옮겨 적은 코드', () => {
  const code = couponCodeFrom(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

  it('저장된 그대로면 그대로다', () => {
    expect(normalizeCouponCode(code)).toBe(code)
  })

  it('소문자를 올린다', () => {
    expect(normalizeCouponCode(code.toLowerCase())).toBe(code)
  })

  it('보여 준 모양 그대로 붙여 넣어도 받는다', () => {
    expect(normalizeCouponCode(formatCouponCode(code))).toBe(code)
  })

  it('앞뒤 공백과 사이 공백을 버린다', () => {
    expect(normalizeCouponCode(`  ${code.slice(0, 5)} ${code.slice(5)}  `)).toBe(code)
  })

  it('O 를 0 으로, I·L 을 1 로 접는다', () => {
    // 알파벳에 그 글자들이 없으므로 이 접기는 다른 코드를 가리킬 수 없다.
    expect(normalizeCouponCode('O123456789')).toBe('0123456789')
    expect(normalizeCouponCode('I123456789')).toBe('1123456789')
    expect(normalizeCouponCode('L123456789')).toBe('1123456789')
  })

  it('알파벳 밖 글자는 버리지 않는다 — 버리면 아무 문자열이나 코드가 된다', () => {
    // `WELCOME!!` 에서 특수문자를 전부 버리는 구현은 우연히 열 글자를 만들어
    // 남의 코드를 가리킬 수 있다. 사라지는 것은 사람이 읽기 좋으라고 끼워 넣는
    // 하이픈과 공백 둘뿐이다.
    expect(normalizeCouponCode('0123456789!')).toBeNull()
    expect(normalizeCouponCode('012345678_9')).toBeNull()
  })

  it('길이가 다르면 거절한다', () => {
    expect(normalizeCouponCode(code.slice(0, 9))).toBeNull()
    expect(normalizeCouponCode(`${code}0`)).toBeNull()
    expect(normalizeCouponCode('')).toBeNull()
  })

  it('U 가 든 입력은 없는 코드다', () => {
    // 접어 줄 대상이 없다 — 알파벳에서 뺀 이유가 낱말 방지라 헷갈림이 아니다.
    expect(normalizeCouponCode('U123456789')).toBeNull()
  })
})

describe('보여 주는 모양', () => {
  it('가운데에 하이픈을 넣는다', () => {
    expect(formatCouponCode('0123456789')).toBe('01234-56789')
  })

  it('저장되는 값이 아니다 — 다시 정규화하면 원래대로다', () => {
    // 하이픈을 저장하면 「있는 코드」와 「없는 코드」가 다른 문자열이 되고, 그때
    // 유니크 인덱스는 같은 코드를 두 번 허용한다.
    expect(normalizeCouponCode(formatCouponCode('0123456789'))).toBe('0123456789')
  })
})
