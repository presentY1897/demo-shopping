/**
 * 가게 목록을 다듬는 규칙 (TASK-0089 4.6).
 *
 * **틀려도 조용한 자리**라 갈래를 전부 지난다. 상한을 넘겨 보내면 서버가 400 으로
 * 거절하고 그 거절은 화면에 **빈 줄**로만 보이며, 읽을 수 없는 id 를 그대로 넘기면
 * 링크를 누른 사람이 「다시 시도」가 붙은 오류 화면을 만난다 — 몇 번을 눌러도 같은
 * 400 이다. 어느 쪽도 빨간 검사를 만들지 않는다.
 */

import { SEARCH_SELLER_IDS_MAX } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { capSellerIds, readSellerIds } from '@/lib/search/seller-ids'

/** 서로 다른 uuid 를 `count` 개. 마지막 열두 자리만 다르다. */
function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `019596d0-1f1c-7c2e-9a0e-92${String(index).padStart(10, '0')}`,
  )
}

describe('자르기', () => {
  it('keeps everything when there is room', () => {
    expect(capSellerIds(ids(3))).toEqual(ids(3))
  })

  it('keeps the first of them and no more, because the head is the recent end', () => {
    const many = ids(SEARCH_SELLER_IDS_MAX + 10)

    // 오래된 팔로우가 잘린다. 뒤에서 자르면 새로고침마다 다른 가게가 남는다.
    expect(capSellerIds(many)).toEqual(many.slice(0, SEARCH_SELLER_IDS_MAX))
  })

  it('drops what is not an id at all', () => {
    const [one] = ids(1)

    // 서버가 400 으로 거절할 것을 여기서 버린다. 판정은 계약의 `z.uuid()` 그대로다.
    expect(capSellerIds([one!, '', '루미크', '019596d0-1f1c'])).toEqual([one])
  })

  it('counts a store once, so the ceiling means what it says', () => {
    const [one, two] = ids(2)

    expect(capSellerIds([one!, ' ' + two! + ' ', one!, two!])).toEqual([one, two])
  })
})

describe('질의 문자열에서 읽기', () => {
  it('is absent when the parameter is', () => {
    expect(readSellerIds(null)).toBeUndefined()
  })

  it('splits on commas, which is how the address bar carries a list', () => {
    const [one, two] = ids(2)

    expect(readSellerIds(`${one!},${two!}`)).toEqual([one, two])
  })

  it('is absent when nothing in it can be read', () => {
    // 빈 목록을 넘기면 계약의 `min(1)` 에 걸려 400 이 된다. 「가게를 하나도 고르지
    // 않은 검색」은 원래 필터가 없는 검색이다.
    expect(readSellerIds('망가진,링크')).toBeUndefined()
  })
})
