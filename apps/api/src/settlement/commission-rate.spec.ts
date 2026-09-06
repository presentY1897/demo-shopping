/**
 * 수수료율의 결정 (TASK-0079 6.2, Q5 강화). 입력 → 출력, 분기 100%.
 *
 * **여기가 틀리면 조용하다.** 요율이 한 칸 높으면 판매자는 자기가 동의한 적 없는
 * 수수료를 물고, 그 차이는 정산서 한 줄의 숫자로만 나타난다 — 오류가 아니다. 낮으면
 * 플랫폼이 받아야 할 것을 못 받고, 그쪽은 아무도 신고하지 않는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

import type { CommissionRateRow } from './commission-rate.js'
import {
  categoryPathIds,
  COMMISSION_SCOPES,
  commissionOf,
  DEFAULT_COMMISSION_RATE_BP,
  resolveCommission,
  sameScope,
  scopeOf,
} from './commission-rate.js'

const SELLER = '0192f0c1-0000-7000-8000-00000000s001'.replace('s', 'a')

function sellerRate(rateBp: number, sellerId = SELLER): CommissionRateRow {
  return { sellerId, categoryId: null, rateBp }
}

function categoryRate(categoryId: number, rateBp: number): CommissionRateRow {
  return { sellerId: null, categoryId, rateBp }
}

function globalRate(rateBp: number): CommissionRateRow {
  return { sellerId: null, categoryId: null, rateBp }
}

/** 의류(1) → 상의(5) → 반팔 셔츠(12). 잎에서 뿌리 순서다. */
const SUBJECT = { sellerId: SELLER, categoryPath: [12, 5, 1] }

describe('우선순위', () => {
  /** 개별 계약이 기본값을 이긴다. */
  it('판매자 개별율이 카테고리율보다 먼저다 (F2)', () => {
    const mine = sellerRate(200)

    const answer = resolveCommission(SUBJECT, [categoryRate(5, 300), mine])

    expect(answer).toEqual({ rateBp: 200, scope: 'seller', matched: mine })
  })

  it('카테고리율이 전역 기본율보다 먼저다 (F1)', () => {
    const tops = categoryRate(5, 300)

    const answer = resolveCommission(SUBJECT, [globalRate(1_000), tops])

    expect(answer).toEqual({ rateBp: 300, scope: 'category', matched: tops })
  })

  it('아무것도 없으면 전역 행을 쓴다', () => {
    const everywhere = globalRate(800)

    const answer = resolveCommission(SUBJECT, [everywhere])

    expect(answer).toEqual({ rateBp: 800, scope: 'global', matched: everywhere })
  })

  /**
   * **폴백이 0이 아닌 이유.** 「설정을 안 했다」와 「수수료를 받지 않기로 했다」는
   * 다른 결정이고, 0으로 두면 설정을 잊은 카테고리에서 플랫폼이 조용히 아무것도
   * 받지 않는다.
   */
  it('전역 행조차 없으면 기본 상수로 떨어지고, 그 사실을 말한다 (F3)', () => {
    const answer = resolveCommission(SUBJECT, [])

    expect(answer).toEqual({
      rateBp: DEFAULT_COMMISSION_RATE_BP,
      scope: 'global',
      matched: null,
    })
    expect(DEFAULT_COMMISSION_RATE_BP).toBeGreaterThan(0)
  })

  it('남의 스토어에 걸린 요율은 나에게 적용되지 않는다', () => {
    const answer = resolveCommission(SUBJECT, [sellerRate(100, 'someone-else'), globalRate(900)])

    expect(answer.rateBp).toBe(900)
  })
})

describe('카테고리 계층', () => {
  /** 조상에 걸면 그 아래 전부에 걸린다 — 잎마다 채우게 두면 아무도 다 못 채운다. */
  it('조상에 걸린 요율이 잎에 적용된다', () => {
    const clothing = categoryRate(1, 500)

    const answer = resolveCommission(SUBJECT, [clothing])

    expect(answer).toEqual({ rateBp: 500, scope: 'category', matched: clothing })
  })

  /** 「이것만은 다르게」가 「이 아래 전부」를 덮지 않으면 그 설정은 아무 일도 안 한다. */
  it('잎에 걸린 요율이 조상의 것을 이긴다', () => {
    const answer = resolveCommission(SUBJECT, [categoryRate(1, 500), categoryRate(12, 200)])

    expect(answer.rateBp).toBe(200)
  })

  it('중간 조상도 그 아래를 덮는다', () => {
    const answer = resolveCommission(SUBJECT, [categoryRate(1, 500), categoryRate(5, 300)])

    expect(answer.rateBp).toBe(300)
  })

  it('경로 밖의 카테고리는 아무 상관이 없다', () => {
    const answer = resolveCommission(SUBJECT, [categoryRate(99, 100), globalRate(700)])

    expect(answer.rateBp).toBe(700)
  })

  it('카테고리가 없는 항목도 답을 얻는다', () => {
    const answer = resolveCommission({ sellerId: SELLER, categoryPath: [] }, [globalRate(600)])

    expect(answer.rateBp).toBe(600)
  })
})

describe('요율이 걸린 자리', () => {
  it('스토어 · 카테고리 · 전역 셋을 가른다', () => {
    expect(scopeOf(sellerRate(100))).toBe('seller')
    expect(scopeOf(categoryRate(5, 100))).toBe('category')
    expect(scopeOf(globalRate(100))).toBe('global')
  })

  /** 목록의 순서가 곧 우선순위다 — 문서와 견줄 수 있어야 한다. */
  it('좁은 것부터 나열되어 있다', () => {
    expect([...COMMISSION_SCOPES]).toEqual(['seller', 'category', 'global'])
  })
})

describe('수수료 금액', () => {
  it('요율을 곱해 내림한다', () => {
    expect(commissionOf(10_000, 350)).toBe(350)
    expect(commissionOf(9_999, 350)).toBe(349)
  })

  /**
   * **올림이면 1원짜리 판매에서 판매자 몫이 0원이 된다.** 나누어떨어지지 않는 잔여를
   * 파는 쪽이 갖는 것이 관례이고, 무엇보다 플랫폼이 스스로에게 유리하게 반올림하지
   * 않는 것이 설명 가능한 규칙이다.
   */
  it('1원짜리 판매에서도 플랫폼이 전부 가져가지 않는다', () => {
    expect(commissionOf(1, 5_000)).toBe(0)
  })

  it('요율이 0이면 아무것도 가져가지 않는다', () => {
    expect(commissionOf(100_000, 0)).toBe(0)
  })

  it('전액 요율이면 전액이다', () => {
    expect(commissionOf(100_000, 10_000)).toBe(100_000)
  })

  it('음수 금액에서 돈을 만들지 않는다', () => {
    expect(commissionOf(-10_000, 350)).toBe(0)
  })
})

describe('categoryPathIds', () => {
  it('저장된 경로를 잎에서 뿌리 순서로 뒤집는다', () => {
    expect(categoryPathIds('/1/5/12/')).toEqual([12, 5, 1])
  })

  it('뿌리 하나짜리 경로도 목록이다', () => {
    expect(categoryPathIds('/1/')).toEqual([1])
  })

  it('앞뒤의 빈 칸이 id 로 세어지지 않는다', () => {
    expect(categoryPathIds('/1/5/')).toHaveLength(2)
  })

  it('잎에 걸린 요율이 조상의 것을 이긴다 — 뒤집기의 값', () => {
    const rates = [
      { sellerId: null, categoryId: 1, rateBp: 300 },
      { sellerId: null, categoryId: 12, rateBp: 200 },
    ]

    const resolved = resolveCommission(
      { sellerId: SELLER, categoryPath: categoryPathIds('/1/5/12/') },
      rates,
    )

    expect(resolved).toEqual({ rateBp: 200, scope: 'category', matched: rates[1] })
  })
})

describe('sameScope', () => {
  it('같은 스토어에 걸린 둘은 같은 자리다 — 요율이 달라도', () => {
    expect(sameScope(sellerRate(300), sellerRate(700))).toBe(true)
  })

  it('스토어와 카테고리는 다른 자리다', () => {
    expect(sameScope(sellerRate(300), categoryRate(5, 300))).toBe(false)
  })

  it('카테고리가 다르면 다른 자리다', () => {
    expect(sameScope(categoryRate(5, 300), categoryRate(12, 300))).toBe(false)
  })

  it('전역은 전역과만 같다', () => {
    expect(sameScope(globalRate(100), globalRate(900))).toBe(true)
    expect(sameScope(globalRate(100), categoryRate(1, 900))).toBe(false)
  })

  it('다른 스토어는 다른 자리다', () => {
    expect(sameScope(sellerRate(300), sellerRate(300, 'someone-else'))).toBe(false)
  })
})

/**
 * 설계 문서에서 6장만 잘라 온다 (D2).
 *
 * 문서를 여기 다시 적으면 이 검사는 **코드를 코드와 비교하게 된다.** 문서가
 * 기준이고(CLAUDE.md 1장), 문서가 바뀌었는데 코드가 안 바뀌면 여기가 빨개져야 한다
 * (`coupon-apply.spec.ts` 가 같은 장치를 쓴다).
 */
function settlementChapter(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')
  const chapter = /^## 6\. 정산 금액[\s\S]*?(?=^## )/mu.exec(document)

  if (chapter === null) throw new Error('pricing.md 의 6장을 찾지 못했습니다.')

  return chapter[0]
}

describe('설계 문서와 같은 것을 말하는가 (D2)', () => {
  it('우선순위가 문서에 적혀 있다', () => {
    expect(settlementChapter()).toContain(
      '`판매자 개별율 > 카테고리 기본율 > 전역 기본율` 순으로 적용한다',
    )
  })

  it('잎이 조상을 이긴다는 것이 문서에 적혀 있다', () => {
    expect(settlementChapter()).toContain('**잎이 조상을 이긴다**')
  })

  /** 폴백이 0이 아닌 것은 **결정**이다. 문서에서 사라지면 코드만 남는다. */
  it('폴백이 0이 아니라는 것이 문서에 적혀 있다', () => {
    expect(settlementChapter()).toContain('**0% 가 아니다**')
    expect(DEFAULT_COMMISSION_RATE_BP).toBeGreaterThan(0)
  })

  it('주문 시점 스냅샷이 문서에 적혀 있다', () => {
    expect(settlementChapter()).toContain('**주문 시점에 주문 항목마다 저장된다**')
  })
})
