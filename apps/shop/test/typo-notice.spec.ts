/**
 * 「무엇으로 찾았는지 알려 준다」의 판단 근거 (TASK-0041 F6).
 *
 * The engine corrects silently and the response says nothing about it, so the
 * screen has exactly one fact to work from: a word was typed and no result
 * contains it. These tests pin that down — including the cases where saying
 * nothing is the right answer.
 */

import type { SearchHit } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { matchedApproximately, unmatchedTerms } from '@/lib/search/typo-notice'

function hit(name: string, brandName = '해뜰녘'): SearchHit {
  return {
    id: '019596d0-1f1c-7c2e-9a0e-000000000001',
    name,
    brandName,
    categoryId: 31,
    price: 100_000,
    inStock: true,
    thumbnailUrl: null,
    ratingAvg: 400,
    ratingCount: 10,
    salesCount: 50,
  }
}

describe('보정 안내를 띄울지', () => {
  it('names the word that appears in no result', () => {
    expect(unmatchedTerms('레트루', [hit('레트로 러너')])).toEqual(['레트루'])
    expect(matchedApproximately('레트루', [hit('레트로 러너')])).toBe(true)
  })

  it('says nothing when the word is there as typed', () => {
    expect(matchedApproximately('레트로', [hit('레트로 러너')])).toBe(false)
  })

  it('looks at the brand as well as the name', () => {
    expect(matchedApproximately('해뜰녘', [hit('레트로 러너')])).toBe(false)
  })

  it('names only the words that missed, in a query that has several', () => {
    expect(unmatchedTerms('레트루 러너', [hit('레트로 러너')])).toEqual(['레트루'])
  })

  it('stays quiet when nothing was found — that is the empty state, not a correction', () => {
    expect(unmatchedTerms('존재하지않는검색어', [])).toEqual([])
  })

  it('stays quiet when nothing was typed', () => {
    expect(unmatchedTerms('   ', [hit('레트로 러너')])).toEqual([])
  })
})
