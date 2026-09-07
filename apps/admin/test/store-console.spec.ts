/**
 * 스토어 화면의 순수 판단 (TASK-0094).
 *
 * 여기 있는 것은 전부 **틀려도 조용한** 것들이다 — 화면은 멀쩡히 그려지고 검사는
 * 초록이며, 달라지는 것은 목록의 맨 위에 어느 스토어가 앉는가뿐이다. 그래서
 * `vitest.config.mjs` 가 두 파일을 분기 100% 로 잡고 있고, 이 파일이 그 값을 채운다.
 *
 * 서식기는 `Intl` 을 지나므로 **자릿수와 기호를 문자열로 못박지 않는다.** 재는 것은
 * 「무엇이 그려지는가」가 아니라 「없는 값이 `null` 로 갈라지는가」와 「100배가 한 번만
 * 나뉘는가」다.
 */

import { describe, expect, it } from 'vitest'

import {
  storeClaimRate,
  storeCount,
  storeDate,
  storeDateTime,
  storeMoney,
  storeRating,
} from '@/lib/stores/format'
import type { StoreFilters } from '@/lib/stores/store-console'
import {
  EMPTY_STORE_FILTERS,
  eventKind,
  isNarrowed,
  queryOf,
  sanctionCount,
} from '@/lib/stores/store-console'

import { statusEvent } from './support/stores'

function filters(overrides: Partial<StoreFilters> = {}): StoreFilters {
  return { ...EMPTY_STORE_FILTERS, ...overrides }
}

describe('필터 → 질의', () => {
  it('sends nothing but the sort when nothing is narrowed', () => {
    expect(queryOf(EMPTY_STORE_FILTERS)).toEqual({ sort: 'recent' })
  })

  /**
   * 값이 없는 축은 **키 자체가 없어야** 한다. `undefined` 를 실으면
   * `URLSearchParams` 가 `status=undefined` 를 만들고 서버가 400 으로 답한다.
   */
  it('omits the key of an axis nobody chose', () => {
    expect('status' in queryOf(EMPTY_STORE_FILTERS)).toBe(false)
    expect('isDemo' in queryOf(EMPTY_STORE_FILTERS)).toBe(false)
  })

  it('carries a status, a demo flag and a sort once they are chosen', () => {
    expect(queryOf(filters({ status: 'SUSPENDED', isDemo: true, sort: 'claimRate' }))).toEqual({
      status: 'SUSPENDED',
      isDemo: true,
      sort: 'claimRate',
    })
  })

  it('keeps false apart from "not chosen"', () => {
    expect(queryOf(filters({ isDemo: false })).isDemo).toBe(false)
  })
})

describe('좁혔는가', () => {
  it('is not narrowed by the sort alone', () => {
    // 순서를 바꾼다고 줄이 사라지지 않는다. 그래서 그때의 빈 목록은 「조건을
    // 지워 보세요」가 아니라 「아직 스토어가 없어요」다.
    expect(isNarrowed(filters({ sort: 'sales' }))).toBe(false)
  })

  it('is narrowed by a status', () => {
    expect(isNarrowed(filters({ status: 'PENDING' }))).toBe(true)
  })

  it('is narrowed by the demo flag', () => {
    expect(isNarrowed(filters({ isDemo: false }))).toBe(true)
  })
})

describe('이력의 갈래 (F6)', () => {
  it('calls a move *into* 정지 a sanction, whatever it came from', () => {
    expect(eventKind(statusEvent({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }))).toBe('sanction')
    expect(eventKind(statusEvent({ fromStatus: 'PENDING', toStatus: 'SUSPENDED' }))).toBe(
      'sanction',
    )
  })

  /**
   * 해제의 도착지는 승인과 같은 `ACTIVE` 다. 출발지로 판정하지 않으면 둘을 가를 수
   * 없고, 그러면 「몇 번 정지됐나」의 짝이 되는 「몇 번 풀렸나」도 사라진다.
   */
  it('tells 정지 해제 from 승인 by where it came from', () => {
    expect(eventKind(statusEvent({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' }))).toBe('lift')
    expect(eventKind(statusEvent({ fromStatus: 'PENDING', toStatus: 'ACTIVE' }))).toBe('approval')
  })

  it('names a rejection and the first filing', () => {
    expect(eventKind(statusEvent({ fromStatus: 'PENDING', toStatus: 'REJECTED' }))).toBe(
      'rejection',
    )
    expect(eventKind(statusEvent({ fromStatus: null, toStatus: 'PENDING' }))).toBe('filed')
  })
})

describe('정지 횟수 (F6 · 4.6)', () => {
  it('is zero for a store that was only ever approved', () => {
    expect(sanctionCount([statusEvent({ fromStatus: null, toStatus: 'PENDING' })])).toBe(0)
  })

  /**
   * 반복 위반과 한 번의 실수를 가르는 수다. 해제를 함께 세면 두 번 정지되고 두 번
   * 풀린 스토어가 네 번짜리로 보인다.
   */
  it('counts only the moves into 정지, not the ones out of it', () => {
    expect(
      sanctionCount([
        statusEvent({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }),
        statusEvent({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' }),
        statusEvent({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }),
        statusEvent({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' }),
      ]),
    ).toBe(2)
  })
})

describe('클레임률 (4.5)', () => {
  /**
   * **0%가 아니다.** 0으로 그리면 아직 아무것도 안 판 스토어가 「클레임 한 건도 없는
   * 좋은 스토어」로 목록의 맨 위에 앉고, 클레임률을 보러 온 사람은 정작 봐야 할
   * 스토어를 못 본다.
   */
  it('is null — not zero — for a store that has never sold', () => {
    expect(storeClaimRate(null)).toBeNull()
  })

  /** 3.5% 가 `350` 이다. 100배를 되돌리는 자리가 이 함수 하나여야 두 화면이 안 갈린다. */
  it('reads the contract integer as hundredths of a percent', () => {
    const formatted = storeClaimRate(350)

    expect(formatted).not.toBeNull()
    expect(formatted).toContain('3.5')
    expect(storeClaimRate(0)).toContain('0')
  })
})

describe('평점', () => {
  /** 리뷰가 없으면 `ratingAvg` 가 0으로 온다. 그 0을 그리면 **최악의 스토어**가 된다. */
  it('is null when nobody has reviewed, rather than 0.0', () => {
    expect(storeRating(0, 0)).toBeNull()
  })

  it('reads 420 as 4.2', () => {
    expect(storeRating(420, 31)).toContain('4.2')
  })
})

describe('나머지 서식', () => {
  it('writes money, counts and both date shapes', () => {
    expect(storeMoney(1_890_000)).toContain('1,890,000')
    expect(storeCount(1234)).toBe('1,234')
    // 개설일에는 시각이 없고, 이력의 한 줄에는 있다 — 한 트랜잭션 안의 두 번을
    // 가르는 것이 순서이고 그 순서는 같은 날 안에 있다.
    expect(storeDate('2026-05-01T00:00:00.000Z')).not.toBe(
      storeDateTime('2026-05-01T00:00:00.000Z'),
    )
  })
})
