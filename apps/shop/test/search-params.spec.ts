/**
 * 검색 상태를 URL 로 읽고 쓰는 규칙 (TASK-0041 F4).
 *
 * These two functions are the whole of the screen's state layer, so they are
 * tested as what they are: a parser and a printer. What matters is that a link
 * somebody was sent survives being clicked — including a mangled one — and that
 * the same filters always produce the same address.
 */

import { describe, expect, it } from 'vitest'

import {
  appliedFilters,
  readSearchParams,
  removeFilter,
  toggleAttribute,
  writeSearchParams,
} from '@/lib/search/search-params'

const LABELS = {
  price: '{min}원 ~ {max}원',
  inStock: '재고 있음',
  attribute: (key: string) => key.toUpperCase(),
}

function read(search: string) {
  return readSearchParams(new URLSearchParams(search))
}

describe('읽기', () => {
  it('takes a term, a category, a range, a switch, a sort and attributes', () => {
    expect(
      read(
        'q=코트&categoryId=31&priceMin=10000&priceMax=90000&inStock=true&sort=price_asc&attr.fit=슬림,루즈',
      ),
    ).toEqual({
      q: '코트',
      categoryId: 31,
      priceMin: 10_000,
      priceMax: 90_000,
      inStock: true,
      sort: 'price_asc',
      attributes: { fit: ['슬림', '루즈'] },
    })
  })

  it('drops what it cannot read rather than refusing the page', () => {
    // A shared link with a mangled price is still a link somebody clicked. The
    // right answer is the search without that filter, not an error screen.
    expect(read('q=코트&priceMin=abc&priceMax=-1&categoryId=0&sort=cheapest')).toEqual({
      q: '코트',
    })
  })

  it('treats a blank term as no term, so the empty state is reachable', () => {
    expect(read('q=%20%20')).toEqual({})
  })

  it('ignores an attribute key with no values and blank values within one', () => {
    expect(read('attr.fit=&attr.material=%20,울,')).toEqual({ attributes: { material: ['울'] } })
  })

  it('reads only `inStock=true` as the switch being on', () => {
    expect(read('inStock=false').inStock).toBeUndefined()
    expect(read('inStock=1').inStock).toBeUndefined()
  })
})

describe('쓰기', () => {
  it('writes the same filters to the same string, whatever order they arrived in', () => {
    const one = writeSearchParams({
      attributes: { material: ['울', '캐시미어'], fit: ['슬림'] },
      q: '코트',
    })
    const other = writeSearchParams({
      q: '코트',
      attributes: { fit: ['슬림'], material: ['캐시미어', '울'] },
    })

    expect(one).toBe(other)
    // Two links that filter the same way must *be* the same link, or the history
    // fills with entries that differ only in spelling.
    expect(one).toBe(
      'q=%EC%BD%94%ED%8A%B8&attr.fit=%EC%8A%AC%EB%A6%BC&attr.material=%EC%9A%B8%2C%EC%BA%90%EC%8B%9C%EB%AF%B8%EC%96%B4',
    )
  })

  it('leaves the default sort out of the address entirely', () => {
    expect(writeSearchParams({ sort: 'relevance' })).toBe('')
    expect(writeSearchParams({ sort: 'newest' })).toBe('sort=newest')
  })

  it('round-trips whatever it wrote', () => {
    const query = {
      q: '코트',
      categoryId: 31,
      priceMin: 0,
      priceMax: 90_000,
      inStock: true,
      sort: 'price_desc' as const,
      attributes: { fit: ['슬림'] },
    }

    expect(read(writeSearchParams(query))).toEqual(query)
  })
})

describe('한 값 켜고 끄기', () => {
  it('adds a value, then removes it, and drops the key when it empties', () => {
    const one = toggleAttribute({}, 'fit', '슬림')

    expect(one.attributes).toEqual({ fit: ['슬림'] })
    expect(toggleAttribute(one, 'fit', '슬림').attributes).toBeUndefined()
  })

  it('leaves the other keys alone', () => {
    const query = { attributes: { fit: ['슬림'], material: ['울'] } }

    expect(toggleAttribute(query, 'fit', '슬림').attributes).toEqual({ material: ['울'] })
  })
})

describe('적용된 필터', () => {
  it('lists a chip per applied value, sorted so the row does not reshuffle', () => {
    const chips = appliedFilters(
      { priceMin: 10_000, priceMax: 90_000, inStock: true, attributes: { fit: ['슬림', '루즈'] } },
      LABELS,
    )

    expect(chips.map((chip) => chip.label)).toEqual([
      '10,000원 ~ 90,000원',
      '재고 있음',
      'FIT: 슬림',
      'FIT: 루즈',
    ])
  })

  it('says nothing about a search that has no filters on it', () => {
    expect(appliedFilters({ q: '코트', categoryId: 31, sort: 'newest' }, LABELS)).toEqual([])
  })

  it('removes exactly the chip that was pressed', () => {
    const query = { priceMin: 10_000, inStock: true, attributes: { fit: ['슬림', '루즈'] } }
    const chips = appliedFilters(query, LABELS)

    expect(removeFilter(query, chips[2]!).attributes).toEqual({ fit: ['루즈'] })
    expect(removeFilter(query, chips[1]!).inStock).toBeUndefined()
    expect(removeFilter(query, chips[0]!).priceMin).toBeUndefined()
  })

  it('takes both ends of the range off with one press', () => {
    const query = { priceMin: 10_000, priceMax: 90_000 }
    const [chip] = appliedFilters(query, LABELS)
    const next = removeFilter(query, chip!)

    expect(next.priceMin).toBeUndefined()
    expect(next.priceMax).toBeUndefined()
  })
})
