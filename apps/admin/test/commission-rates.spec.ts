/**
 * 요율을 다루는 순수 함수들 (TASK-0079).
 *
 * 이 파일이 재는 것은 화면이 아니라 **화면이 요청을 만들기 전에 하는 산수**다.
 * 그것을 따로 재는 이유는 틀렸을 때 조용하기 때문이다: 「3.5%」를 `349` 로 보내는
 * 화면도, 「12.75%」를 거절하는 화면도 렌더링은 멀쩡하고 검사는 초록이다. 잘못된
 * 요율은 **모든 판매자의 다음 정산 금액**을 옮긴다.
 *
 * `vitest.config.mjs` 가 `rate-bp.ts` 와 `scopes.ts` 를 분기 100% 로 묶어 두는
 * 이유도 같다.
 */

import { COMMISSION_RATE_MAX_BP } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { commissionFormSchema } from '@/lib/commissions/form-schema'
import { percentFromRateBp, rateBpFromPercent } from '@/lib/commissions/rate-bp'
import {
  commissionChanges,
  commissionSearch,
  GLOBAL_SCOPE,
  groupOpenRates,
  openRateFor,
  scopeIds,
  scopeKey,
  selectedScope,
} from '@/lib/commissions/scopes'
import { categoryTargetName, sellerTargetName } from '@/lib/commissions/targets'
import { messagesFor } from '@/messages'

import { commissionRate, UNKNOWN_SELLER_ID } from './support/commissions'

const { commissions: copy } = messagesFor()

const SELLER_ID = '019596e0-0001-7000-8000-000000000001'

describe('퍼센트 → basis point', () => {
  /**
   * **곱셈이 아니라 자리 맞추기다.**
   *
   * `8.31 * 100` 은 `830.9999999999999` 이고 `0.07 * 100` 은 `7.000000000000001`
   * 이다. 두 값 다 여기서는 정수로 나와야 하고, 그것이 이 모듈이 문자열을 자르는
   * 이유다 — 반올림으로 덮으면 자릿수가 하나 늘어난 날 다시 틀린다.
   */
  it.each([
    ['3.5', 350],
    ['12.75', 1275],
    ['8.31', 831],
    ['0.07', 7],
    ['0.5', 50],
    ['3', 300],
    ['3.05', 305],
    ['0', 0],
    ['100', COMMISSION_RATE_MAX_BP],
    ['  3.5  ', 350],
  ])('reads %s as %i bp', (input, expected) => {
    expect(rateBpFromPercent(input)).toEqual({ ok: true, rateBp: expected })
  })

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['abc', 'malformed'],
    ['3.', 'malformed'],
    ['.5', 'malformed'],
    ['-1', 'malformed'],
    ['1e2', 'malformed'],
    ['3.456', 'too_precise'],
    ['100.01', 'out_of_range'],
    ['101', 'out_of_range'],
  ])('refuses %s as %s', (input, reason) => {
    expect(rateBpFromPercent(input)).toEqual({ ok: false, reason })
  })
})

describe('basis point → 폼에 되돌려 놓는 퍼센트', () => {
  it.each([
    [0, '0'],
    [5, '0.05'],
    [300, '3'],
    [305, '3.05'],
    [350, '3.5'],
    [1275, '12.75'],
    [COMMISSION_RATE_MAX_BP, '100'],
  ])('writes %i bp as %s', (rateBp, expected) => {
    expect(percentFromRateBp(rateBp)).toBe(expected)
  })

  /**
   * 왕복이 맞아야 「같은 값으로 저장」이 이력에 빈 줄을 남기지 않는다. 지금 요율을
   * 폼에 채우고 아무것도 고치지 않은 채 저장하면 같은 bp 가 나가야 한다.
   */
  it('comes back as the same basis points', () => {
    for (let rateBp = 0; rateBp <= COMMISSION_RATE_MAX_BP; rateBp += 7) {
      expect(rateBpFromPercent(percentFromRateBp(rateBp))).toEqual({ ok: true, rateBp })
    }
  })
})

describe('범위 하나를 계약의 두 칸으로', () => {
  it('fills exactly one id, or neither', () => {
    expect(scopeIds(GLOBAL_SCOPE)).toEqual({ sellerId: null, categoryId: null })
    expect(scopeIds({ kind: 'category', categoryId: 12 })).toEqual({
      sellerId: null,
      categoryId: 12,
    })
    expect(scopeIds({ kind: 'seller', sellerId: SELLER_ID })).toEqual({
      sellerId: SELLER_ID,
      categoryId: null,
    })
  })

  it('tells the three scopes apart by key', () => {
    const keys = [
      scopeKey(GLOBAL_SCOPE),
      scopeKey({ kind: 'category', categoryId: 12 }),
      scopeKey({ kind: 'seller', sellerId: SELLER_ID }),
    ]

    expect(new Set(keys).size).toBe(3)
  })
})

describe('폼의 세 칸이 가리키는 범위', () => {
  it('is the global scope as soon as it is chosen', () => {
    expect(selectedScope('global', '', '')).toEqual(GLOBAL_SCOPE)
  })

  it('is complete once a category or a store is picked', () => {
    expect(selectedScope('category', '12', '')).toEqual({ kind: 'category', categoryId: 12 })
    expect(selectedScope('seller', '', SELLER_ID)).toEqual({ kind: 'seller', sellerId: SELLER_ID })
  })

  /**
   * **전역으로 접지 않는다.** 접으면 미리보기는 전역 요율의 영향을 계산하고 저장은
   * 전역 요율을 바꾼다 — 아무도 그렇게 하려던 적이 없는데도.
   */
  it('is nothing while the chosen kind still needs a target', () => {
    expect(selectedScope('category', '', '')).toBeNull()
    expect(selectedScope('seller', '', '')).toBeNull()
  })
})

describe('질의 문자열', () => {
  it('says nothing for the global scope, because a blank is how it is named', () => {
    expect(commissionSearch(GLOBAL_SCOPE)).toBe('')
    expect(commissionSearch(GLOBAL_SCOPE, { history: 'true' })).toBe('?history=true')
  })

  it('narrows to one scope', () => {
    expect(commissionSearch({ kind: 'category', categoryId: 12 })).toBe('?categoryId=12')
    expect(commissionSearch({ kind: 'seller', sellerId: SELLER_ID }, { rateBp: '350' })).toBe(
      `?rateBp=350&sellerId=${SELLER_ID}`,
    )
  })
})

describe('열려 있는 요율을 세 덩어리로', () => {
  const global = commissionRate({ rateBp: 300 })
  const category = commissionRate({ scope: 'category', categoryId: 12, rateBp: 500 })
  const seller = commissionRate({ scope: 'seller', sellerId: SELLER_ID, rateBp: 250 })

  it('puts each rate under the scope it was set on', () => {
    const grouped = groupOpenRates([global, category, seller])

    expect(grouped.global).toBe(global)
    expect(grouped.category).toEqual([category])
    expect(grouped.seller).toEqual([seller])
  })

  it('has no global rate when nothing was ever set', () => {
    expect(groupOpenRates([category]).global).toBeNull()
  })

  it('finds the rate that a chosen scope already carries', () => {
    const rates = [global, category, seller]

    expect(openRateFor(rates, GLOBAL_SCOPE)).toBe(global)
    expect(openRateFor(rates, { kind: 'category', categoryId: 12 })).toBe(category)
    expect(openRateFor(rates, { kind: 'category', categoryId: 99 })).toBeNull()
  })
})

describe('이력 — 무엇에서 무엇으로 (F5)', () => {
  /**
   * 「무엇에서」는 저장된 값이 아니라 **바로 다음 줄의 요율**이다. 서버가 한 범위의
   * 행들을 최신순으로 주므로, 다음 줄은 시간상 앞선 줄이다.
   */
  it('reads the earlier rate off the next row', () => {
    const newest = commissionRate({ rateBp: 400, validFrom: '2026-09-03T00:00:00.000Z' })
    const middle = commissionRate({ rateBp: 350, validFrom: '2026-09-02T00:00:00.000Z' })
    const oldest = commissionRate({ rateBp: 300, validFrom: '2026-09-01T00:00:00.000Z' })

    expect(commissionChanges([newest, middle, oldest])).toEqual([
      { rate: newest, previousRateBp: 350 },
      { rate: middle, previousRateBp: 300 },
      // 처음 설정된 줄에는 「무엇에서」가 없다. 폴백을 적으면 없던 사건이 생긴다.
      { rate: oldest, previousRateBp: null },
    ])
  })

  it('has nothing to say about a scope that was never set', () => {
    expect(commissionChanges([])).toEqual([])
  })
})

describe('요율이 걸린 자리의 이름', () => {
  const choices = [{ id: 12, path: ['여성', '아우터', '코트'], isActive: true }]

  it('names a category by the path down to it', () => {
    expect(categoryTargetName(choices, 12, copy.open)).toBe('여성 › 아우터 › 코트')
  })

  /** id 는 마지막 단서다. 빈칸으로 두면 그 요율을 고칠 방법이 없다. */
  it('keeps the id when the name is not in reach', () => {
    expect(categoryTargetName(choices, 99, copy.open)).toContain('99')
    expect(sellerTargetName([], UNKNOWN_SELLER_ID, copy.open)).toContain(UNKNOWN_SELLER_ID)
  })

  it('names a store by its brand', () => {
    expect(sellerTargetName([{ id: SELLER_ID, name: '루미에르' }], SELLER_ID, copy.open)).toBe(
      '루미에르',
    )
  })
})

describe('저장 요청을 만드는 스키마', () => {
  const schema = commissionFormSchema(copy.editor.errors)

  it('turns a percentage into the basis points the contract takes', () => {
    expect(
      schema.parse({ scope: 'global', categoryId: '', sellerId: '', ratePercent: '3.5' }),
    ).toEqual({ sellerId: null, categoryId: null, rateBp: 350 })
  })

  it('carries exactly one id for a narrowed scope', () => {
    expect(
      schema.parse({ scope: 'category', categoryId: '12', sellerId: '', ratePercent: '5' }),
    ).toEqual({ sellerId: null, categoryId: 12, rateBp: 500 })
    expect(
      schema.parse({ scope: 'seller', categoryId: '', sellerId: SELLER_ID, ratePercent: '2.5' }),
    ).toEqual({ sellerId: SELLER_ID, categoryId: null, rateBp: 250 })
  })

  /** 거절은 **고쳐야 할 칸 위에** 선다. 폼 위의 한 줄이면 어디를 고칠지 알 수 없다. */
  it.each([
    ['category', '', '', 'categoryId', copy.editor.errors.categoryRequired],
    ['seller', '', '', 'sellerId', copy.editor.errors.sellerRequired],
  ])('refuses an unfinished %s scope on the field that is missing', (scope, ...rest) => {
    const [categoryId, sellerId, field, message] = rest
    const result = schema.safeParse({ scope, categoryId, sellerId, ratePercent: '3' })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: [field], message }))
  })

  it('places a rate refusal on the rate field', () => {
    const result = schema.safeParse({
      scope: 'global',
      categoryId: '',
      sellerId: '',
      ratePercent: '101',
    })

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['ratePercent'],
        message: copy.editor.errors.rate.out_of_range,
      }),
    ])
  })

  /**
   * 둘 다 걸리면 두 칸 모두에 문장이 선다. 먼저 걸린 하나만 말하면, 고친 뒤에 다음
   * 거절이 나타나는 폼이 된다.
   */
  it('answers both refusals at once', () => {
    const result = schema.safeParse({
      scope: 'category',
      categoryId: '',
      sellerId: '',
      ratePercent: '',
    })

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['categoryId'],
      ['ratePercent'],
    ])
  })
})
