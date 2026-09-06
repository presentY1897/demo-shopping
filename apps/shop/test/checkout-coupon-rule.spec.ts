/**
 * 중복 사용 규칙 (TASK-0075) — **플랫폼 한 장 + 판매자당 한 장**.
 *
 * **렌더러도 목 서버도 없다.** 규칙이 순수 함수라 여기서 재는 것이 곧 규칙이고,
 * 그래서 조합을 대표적인 몇 개가 아니라 **전부** 밟을 수 있다. 훅 안에 있었다면
 * 「같은 판매자 쿠폰 두 장」 하나를 확인하는 데 화면을 세우고 요청을 기다려야 하고,
 * 그러면 아무도 1,110가지를 확인하지 않는다.
 *
 * 씨앗은 목의 쿠폰함이다. 규칙 검사용 쿠폰을 따로 지어내지 않는 이유는, 화면이
 * 실제로 다루는 열 장이 이미 필요한 성질을 전부 갖고 있기 때문이다 — 플랫폼 둘,
 * 같은 판매자 둘, 다른 판매자 하나, 그리고 못 쓰는 여섯.
 */

import { shopperCheckoutCoupons } from '@shopping/api-mocks'
import type { ApplicableCoupon } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { isChoosable, slotCounts, toggledSelection } from '@/lib/checkout/coupon-selection'

const CATALOGUE = shopperCheckoutCoupons.coupons

/** 이름으로 한 장을 집는다. 없으면 그 자리에서 멈춘다 — 픽스처가 바뀌었다는 뜻이다. */
function pick(name: string): ApplicableCoupon {
  const found = CATALOGUE.find((entry) => entry.userCoupon.coupon.name === name)

  if (found === undefined) throw new Error(`픽스처에 「${name}」 쿠폰이 없다`)

  return found
}

function idOf(name: string): string {
  return pick(name).userCoupon.id
}

/** 플랫폼 둘 — 서로를 밀어내야 한다. */
const WELCOME = idOf('첫 주문 10% 할인')
const AUTUMN = idOf('가을 맞이 5천원')
/** 판매자 둘 — 다른 가게라 함께 쓴다. */
const LUMIERE = idOf('루미에르 10% 할인')
const NODESTEP = idOf('노드스텝 3천원')
/** 노드스텝의 두 번째 장. 같은 가게라 `NODESTEP` 을 밀어낸다. */
const NODESTEP_PENNY = idOf('노드스텝 1% 할인')

const EVERY_ID = CATALOGUE.map((entry) => entry.userCoupon.id)

describe('한 장을 고르고 빼기', () => {
  it('adds a coupon nothing else is competing for', () => {
    expect(toggledSelection([], WELCOME, CATALOGUE)).toEqual([WELCOME])
  })

  it('removes a coupon that was already chosen', () => {
    // 같은 조작이 켜고 끈다. 「해제」를 따로 두면 화면에 지우는 버튼이 하나 더
    // 생기고, 그 버튼과 체크가 서로 다른 말을 하는 날이 온다.
    expect(toggledSelection([WELCOME, LUMIERE], WELCOME, CATALOGUE)).toEqual([LUMIERE])
  })

  it('leaves the order of the rest alone and appends the new one', () => {
    // 순서가 곧 쿼리스트링이다. 같은 선택이 매번 같은 문자열이어야 주문서를 다시
    // 읽는 일이 헛돌지 않는다.
    expect(toggledSelection([LUMIERE, NODESTEP], WELCOME, CATALOGUE)).toEqual([
      LUMIERE,
      NODESTEP,
      WELCOME,
    ])
  })
})

describe('플랫폼은 한 장 (계약의 duplicate_platform)', () => {
  it('replaces the platform coupon instead of refusing the second one', () => {
    // 막지 않고 밀어낸다. 「이미 한 장 고르셨어요」로 답하면 그 사람은 무엇을
    // 지워야 하는지 스스로 찾아 두 번 눌러야 한다.
    expect(toggledSelection([WELCOME], AUTUMN, CATALOGUE)).toEqual([AUTUMN])
  })

  it('keeps the seller coupons while swapping the platform one', () => {
    expect(toggledSelection([LUMIERE, WELCOME, NODESTEP], AUTUMN, CATALOGUE)).toEqual([
      LUMIERE,
      NODESTEP,
      AUTUMN,
    ])
  })
})

describe('판매자는 가게마다 한 장 (계약의 duplicate_seller)', () => {
  it('replaces the coupon of the same seller', () => {
    expect(toggledSelection([NODESTEP], NODESTEP_PENNY, CATALOGUE)).toEqual([NODESTEP_PENNY])
  })

  it('leaves another seller alone', () => {
    // 다른 가게는 다른 자리다. 여기서 밀어내면 판매자가 둘인 주문서에서 쿠폰을
    // 한 장밖에 못 쓰게 된다.
    expect(toggledSelection([LUMIERE], NODESTEP, CATALOGUE)).toEqual([LUMIERE, NODESTEP])
  })

  it('sits beside a platform coupon', () => {
    expect(toggledSelection([WELCOME], LUMIERE, CATALOGUE)).toEqual([WELCOME, LUMIERE])
  })
})

describe('모르는 장', () => {
  const STRANGER = '019596d0-1f1c-7c2e-9a0e-6a00000000ff'

  it('is not added, because we cannot say what it would push out', () => {
    // 넣으면 그 다음 요청 전부가 400 이 된다 — 서버는 이 사람의 쿠폰함에 없는
    // 장을 받아 주지 않는다.
    expect(toggledSelection([WELCOME], STRANGER, CATALOGUE)).toEqual([WELCOME])
  })

  it('can still be taken back out', () => {
    // 빼는 데에는 목록이 필요 없다. 어쩌다 들어간 장을 못 빼는 것이 더 나쁘다.
    expect(toggledSelection([WELCOME, STRANGER], STRANGER, CATALOGUE)).toEqual([WELCOME])
  })

  it('is left where it is when something else is chosen', () => {
    // 무엇과 부딪히는지 모르는 장을 조용히 빼면, 사람이 고른 적 없는 선택이
    // 만들어지고 그 선택으로 주문이 나간다.
    expect(toggledSelection([STRANGER], LUMIERE, CATALOGUE)).toEqual([STRANGER, LUMIERE])
  })
})

describe('규칙은 몇 번을 눌러도 선다', () => {
  /**
   * 열 장에서 뽑은 **길이 3까지의 모든 조작 순서** — 1,110가지.
   *
   * 하나씩 `it` 으로 두지 않는 이유는 실패했을 때 알고 싶은 것이 「몇 번째
   * 조합이 깨졌나」가 아니라 **어떤 순서가 깨졌나**이기 때문이다. 그 순서를
   * 메시지에 실어 두면 목록 1,110줄보다 한 줄이 더 쓸모 있다.
   */
  it('never lets two coupons share a slot, whatever order they are pressed in', () => {
    const sequences: string[][] = []

    for (const first of EVERY_ID) {
      sequences.push([first])

      for (const second of EVERY_ID) {
        sequences.push([first, second])

        for (const third of EVERY_ID) sequences.push([first, second, third])
      }
    }

    for (const sequence of sequences) {
      const selection = sequence.reduce<readonly string[]>(
        (current, id) => toggledSelection(current, id, CATALOGUE),
        [],
      )

      for (const [slot, count] of slotCounts(selection, CATALOGUE)) {
        expect(`${sequence.join(' → ')} · ${slot}: ${String(count)}`).toBe(
          `${sequence.join(' → ')} · ${slot}: 1`,
        )
      }
    }
  })

  it('checked 1,110 sequences, not an empty list', () => {
    // 위의 반복이 빈 목록을 돌면 아무것도 확인하지 않은 채 통과한다.
    expect(EVERY_ID).toHaveLength(10)
  })
})

describe('고를 수 있는 장', () => {
  it('is exactly the one with no fault', () => {
    // 화면이 `fault === null` 을 세 군데에서 따로 판단하지 않게 하려고 함수가 있다.
    expect(CATALOGUE.filter((entry) => isChoosable(entry)).map((entry) => entry.userCoupon.id)) //
      .toEqual([WELCOME, AUTUMN, LUMIERE, NODESTEP])
  })
})
