/**
 * The document, as pure input to output (QUALITY-GATES Q5 순수 로직).
 *
 * A wrong document is not a failed request — it is a listing that is findable
 * under the wrong words, or a facet that counts nothing, and neither of those
 * shows up anywhere except in a search somebody runs later.
 */

import { describe, expect, it } from 'vitest'

import type { ProductSource } from './search-document.js'
import {
  ATTRIBUTE_FACET_PREFIX,
  attributeFacets,
  isIndexable,
  toDocument,
} from './search-document.js'

function source(overrides: Partial<ProductSource> = {}): ProductSource {
  return {
    id: '0192f0c1-0000-7000-8000-000000000001',
    name: '데일리 코튼 티셔츠',
    description: '매일 입기 좋은 티셔츠입니다.',
    status: 'ACTIVE',
    sellerId: '0192f0c1-0000-7000-8000-000000000002',
    brandName: '해뜰녘',
    categoryId: 12,
    categoryIds: [1, 5, 12],
    categoryPath: ['여성', '상의', '티셔츠'],
    minPrice: 29_900,
    ratingAvg: 450,
    ratingCount: 12,
    salesCount: 30,
    attributes: { material: '면', color: ['블랙', '화이트'] },
    totalStock: 42,
    thumbnailUrl: 'https://cdn.test.invalid/a.jpg',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    ...overrides,
  }
}

describe('isIndexable', () => {
  it('is only true for a listing that is on sale', () => {
    // F3: a draft or a suspended listing must not be findable, and the decision
    // is here rather than in the query so the worker can be handed any product.
    expect(isIndexable({ status: 'ACTIVE' })).toBe(true)
    expect(isIndexable({ status: 'DRAFT' })).toBe(false)
    expect(isIndexable({ status: 'INACTIVE' })).toBe(false)
    expect(isIndexable({ status: 'SUSPENDED' })).toBe(false)
  })
})

describe('attributeFacets', () => {
  it('prefixes every key so the facet name cannot collide with a field', () => {
    // `name` as an attribute would otherwise overwrite the listing's name.
    expect(attributeFacets({ name: '겹침' })).toEqual({ [`${ATTRIBUTE_FACET_PREFIX}name`]: '겹침' })
  })

  it('keeps a multi-valued attribute as a list', () => {
    // A listing in three colours has to be found by any one of them.
    expect(attributeFacets({ color: ['블랙', '화이트'] })).toEqual({
      attr_color: ['블랙', '화이트'],
    })
  })

  it('keeps numbers and booleans as themselves', () => {
    // A numeric facet is filtered with `>=`; stringifying it would make every
    // comparison lexicographic and `100` smaller than `20`.
    expect(attributeFacets({ heel_mm: 70, laptop_ok: true })).toEqual({
      attr_heel_mm: 70,
      attr_laptop_ok: true,
    })
  })

  it('answers nothing for a listing with no attributes', () => {
    expect(attributeFacets({})).toEqual({})
  })
})

describe('toDocument', () => {
  it('flattens the attributes beside the fields', () => {
    const document = toDocument(source())

    expect(document.attr_material).toBe('면')
    expect(document.attr_color).toEqual(['블랙', '화이트'])
  })

  it('makes the lineage searchable as one string', () => {
    // A shopper types 「여성 티셔츠」, which matches nothing if the lineage is
    // only an array of separate tokens in separate documents.
    expect(toDocument(source()).categoryLabel).toBe('여성 > 상의 > 티셔츠')
  })

  it('carries stock as a boolean, not a number (R3)', () => {
    expect(toDocument(source({ totalStock: 42 })).inStock).toBe(true)
    expect(toDocument(source({ totalStock: 0 })).inStock).toBe(false)
  })

  it('sorts by an epoch number rather than an ISO string', () => {
    // Lexicographic order happens to be right for UTC and is silently wrong the
    // day a value carries an offset.
    expect(toDocument(source()).createdAt).toBe(Date.parse('2026-09-05T00:00:00.000Z') / 1000)
  })

  it('gives a listing with no live combination a price rather than a null', () => {
    // A sortable field that is sometimes absent sorts unpredictably.
    expect(toDocument(source({ minPrice: null })).price).toBe(0)
  })

  it('does not put a null into a searchable field', () => {
    // A `null` in a searchable field is a value a search for "null" can match.
    expect(toDocument(source({ description: null })).description).toBe('')
  })

  it('never lets an attribute overwrite a field of the document', () => {
    const document = toDocument(source({ attributes: { name: '속성이 이긴다면 버그' } }))

    expect(document.name).toBe('데일리 코튼 티셔츠')
    expect(document.attr_name).toBe('속성이 이긴다면 버그')
  })

  it('spreads the name and the brand into jamo and initials (TASK-0103)', () => {
    const document = toDocument(source())

    // 「데일리 코튼 티셔츠」 · 「해뜰녘」, one entry per word: the engine matches
    // prefixes and token sequences, and one run-on string would find nothing.
    expect(document.hangul).toContain('ㅋㅗㅌㅡㄴ')
    expect(document.chosung).toContain('ㅋㅌ')
    expect(document.chosung).toContain('ㅎㄸㄴ')
  })

  it('leaves the description out of them (R2)', () => {
    // 설명까지 펴면 인덱스가 몇 배가 되고, 설명을 초성으로 찾는 사람은 없다.
    const document = toDocument(source({ description: '아주 긴 설명입니다' }))

    expect(document.chosung).not.toContain('ㅇㅈ')
  })
})

describe('F8 — 보조 필드가 문서를 얼마나 키우나', () => {
  /**
   * 「증가분이 운영 한도 내」를 예산이 아니라 **실측으로** 적는다.
   *
   * 문서 **전체** 대비 비율은 쓸모가 없다 — 그 값은 설명이 얼마나 긴지에 달렸고,
   * 설명 길이는 상품마다 다르다. 안정적인 관계는 **이름 대비**다: 자모는 음절 하나를
   * 두세 글자로 펴고 초성은 한 글자로 줄이므로, 두 필드의 크기는 이름의 길이를 따라
   * 움직이지 문서의 크기를 따라 움직이지 않는다.
   */
  const NAMES = [
    '오버핏 울 발마칸 코트',
    '램스울 라운드넥 니트',
    '나이키 에어맥스 270',
    '캐시미어 머플러',
  ]

  it('grows with the title and stays a small multiple of it', () => {
    const measured = NAMES.map((name) => {
      const { hangul, chosung } = toDocument(source({ name }))

      return {
        name,
        added: JSON.stringify({ hangul, chosung }).length,
        // Brand and name are what feed the fields (R2).
        title: `${name} 해뜰녘`.length,
      }
    })

    /**
     * 실측 (JSON 문자 수 기준):
     *
     * | 이름 | 늘어난 것 | 이름+브랜드 | 배수 |
     * | --- | --- | --- | --- |
     * | 오버핏 울 발마칸 코트 | 96 | 16 | 6.00 |
     * | 램스울 라운드넥 니트 | 90 | 15 | 6.00 |
     * | 나이키 에어맥스 270 | 87 | 16 | 5.44 |
     * | 캐시미어 머플러 | 75 | 12 | 6.25 |
     *
     * 자모가 한 음절을 최대 세 글자로 펴고 초성이 한 글자를 더하며, 거기에 JSON 의
     * 따옴표·쉼표와 두 필드 이름이 붙는다. **짧은 이름일수록 배수가 크다** — 고정
     * 오버헤드가 30자 남짓이기 때문이고, 절대량은 그쪽이 작다.
     *
     * 7배로 묶는다. 실측에 여유를 얹은 값이고, 이보다 커지면 그것은 설명까지
     * 펴기 시작했다는 뜻이다.
     */
    for (const entry of measured) {
      expect(entry.added / entry.title).toBeLessThan(7)
    }
  })

  it('is unmoved by the description, however long it gets (R2)', () => {
    const short = toDocument(source({ name: '코트', description: null }))
    const long = toDocument(source({ name: '코트', description: '아주 긴 설명. '.repeat(200) }))

    // 설명까지 폈다면 문서가 배로 늘었을 것이다. 그리고 설명을 초성으로 찾는
    // 사람은 없다.
    expect(long.hangul).toEqual(short.hangul)
    expect(long.chosung).toEqual(short.chosung)
  })
})
