import { sellerBrandNameSchema, sellerSlugSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  DEMO_TOKEN_LENGTH,
  demoBrandName,
  demoEmail,
  demoName,
  demoSlug,
  demoToken,
  uniqueSku,
} from './demo-identity.js'

/**
 * What an issued account is called.
 *
 * Every value here has an index or a schema behind it, and getting one wrong
 * fails at the moment of issue — which is the moment a visitor is trying to get
 * in. A branch nothing reaches is a name nothing refuses.
 */

/** Deterministic bytes, so a shape assertion is not a coin toss. */
function bytes(seed: number): (size: number) => Uint8Array {
  return (size) => Uint8Array.from({ length: size }, (_unused, index) => seed + index)
}

describe('토큰', () => {
  it('요청한 길이만큼 만든다', () => {
    expect(demoToken(bytes(0))).toHaveLength(DEMO_TOKEN_LENGTH)
  })

  it('슬러그에 그대로 쓸 수 있는 글자만 쓴다', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      expect(demoToken(bytes(seed))).toMatch(/^[a-z2-9]+$/)
    }
  })

  it('바이트가 다르면 토큰이 다르다', () => {
    expect(demoToken(bytes(0))).not.toBe(demoToken(bytes(7)))
  })
})

describe('스토어 이름과 주소', () => {
  it('브랜드명 스키마를 통과한다', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const name = demoBrandName(demoToken(bytes(seed)))

      expect(sellerBrandNameSchema.safeParse(name).success).toBe(true)
    }
  })

  it('슬러그 스키마를 통과한다', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      expect(sellerSlugSchema.safeParse(demoSlug(demoToken(bytes(seed)))).success).toBe(true)
    }
  })

  it('같은 토큰이면 같은 이름이 나온다', () => {
    expect(demoBrandName('abcdefgh')).toBe(demoBrandName('abcdefgh'))
  })

  it('토큰이 다르면 이름도 갈린다', () => {
    expect(demoBrandName('abcdefgh')).not.toBe(demoBrandName('zyxwvuts'))
  })
})

describe('계정 이름과 주소', () => {
  it('역할마다 다른 이름을 준다', () => {
    expect(new Set([demoName('BUYER'), demoName('SELLER'), demoName('ADMIN')]).size).toBe(3)
  })

  it('우리 도메인의 주소를 만든다', () => {
    expect(demoEmail('BUYER', 'abcdefgh')).toBe('buyer-abcdefgh@demo.demo-shopping.com')
  })
})

describe('SKU 중복 떼어내기', () => {
  it('겹치지 않으면 그대로 둔다', () => {
    expect(uniqueSku('TSHIRT-BLACK-M', new Set())).toBe('TSHIRT-BLACK-M')
  })

  it('겹치면 꼬리를 붙인다', () => {
    expect(uniqueSku('SKU', new Set(['SKU']))).toBe('SKU-2')
    expect(uniqueSku('SKU', new Set(['SKU', 'SKU-2']))).toBe('SKU-3')
  })

  it('64자를 넘기지 않는다', () => {
    const long = 'A'.repeat(64)

    expect(uniqueSku(long, new Set([long]))).toHaveLength(64)
    // Still legal to `ProductVariant_sku_format_check`.
    expect(uniqueSku(long, new Set([long]))).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  })

  it('떼어낼 수 없으면 조용히 넘어가지 않는다', () => {
    const taken = new Set(['SKU'])

    for (let attempt = 2; attempt < 1_000; attempt += 1) taken.add(`SKU-${String(attempt)}`)

    expect(() => uniqueSku('SKU', taken)).toThrow('SKU')
  })
})
