import { describe, expect, it } from 'vitest'

import type { ChargeableCard, VirtualCardCredit } from './virtual-card-rules.js'
import {
  availableCredit,
  canIssueVirtualCard,
  chargeableStatuses,
  chargeDecision,
  isChargeable,
  maskVirtualCardNumber,
  releaseDecision,
  VIRTUAL_CARD_NUMBER_PATTERN,
  VIRTUAL_CARD_PREFIX,
  VIRTUAL_CARD_RANDOM_DIGITS,
  VIRTUAL_CARDS_PER_USER,
  virtualCardNumberFrom,
  virtualCardStatuses,
} from './virtual-card-rules.js'

/**
 * 가상 카드의 순수 판단, 남김없이 (TASK-0053 6.2 — Q5 강화, 분기 100%).
 *
 * 여기서 거절되지 않은 것은 **한도로 나타난다.** 그래서 경계마다 두 번씩 잰다 —
 * 잔여 한도를 정확히 쓰는 승인과 1원 더, 쓴 만큼의 반환과 1원 더. 한 칸 어긋난
 * 비교는 빨간 테스트가 아니라 대사가 안 맞는 원장으로 나타나고, 그건 나중에
 * 누군가 손으로 세다가 알아차리는 종류의 실패다.
 */

/** 한도 100만원, 아직 아무것도 쓰지 않은 살아 있는 카드 (F1). */
function card(overrides: Partial<ChargeableCard> = {}): ChargeableCard {
  return { status: 'ACTIVE', creditLimit: 1_000_000, usedAmount: 0, ...overrides }
}

/** 발급기가 받는 바이트열. 자리마다 다른 값이라 자릿수가 섞이면 눈에 띈다. */
const BYTES = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

describe('카드번호', () => {
  it('starts with the prefix that no real card can have', () => {
    // F7 · R1. 접두어가 무너지면 이 카드는 진짜 카드로 보이기 시작하고, 화면의
    // 「가상 카드」 안내는 스크린샷 한 장이 지나가는 순간 사라진다.
    expect(virtualCardNumberFrom(BYTES).startsWith(`${VIRTUAL_CARD_PREFIX}-`)).toBe(true)
  })

  it('lays the bytes out as 9999-XXXX-XXXX-XXXX', () => {
    expect(virtualCardNumberFrom(BYTES)).toBe('9999-0123-4567-8901')
  })

  it('needs exactly the declared number of bytes to fill the groups', () => {
    // 서비스가 넘길 바이트 수와 형식이 갈라지면, 자리가 빈 번호가 유니크 인덱스에
    // 닿기 전까지 아무 소리 없이 발급된다.
    expect(BYTES).toHaveLength(VIRTUAL_CARD_RANDOM_DIGITS)
  })

  it('emits a digit for every possible byte value', () => {
    // 바이트 하나가 자릿수 밖으로 나가면 번호가 형식을 잃는다. 256 가지를 전부
    // 넣어 보는 편이 「% 10 이니까 괜찮다」는 짐작보다 싸다.
    for (let byte = 0; byte < 256; byte += 1) {
      const number = virtualCardNumberFrom(new Uint8Array(VIRTUAL_CARD_RANDOM_DIGITS).fill(byte))

      expect(number).toMatch(VIRTUAL_CARD_NUMBER_PATTERN)
    }
  })

  it('wraps past nine instead of running off the end of the digits', () => {
    // 250 % 10 === 0, 255 % 10 === 5. 나머지가 한 바퀴 도는 지점이고, 여기가
    // 틀리면 자릿수 밖의 글자가 번호에 섞인다.
    const wrapping = Uint8Array.from([250, 255, 249, 246, 100, 101, 102, 103, 254, 253, 252, 251])

    expect(virtualCardNumberFrom(wrapping)).toBe('9999-0596-0123-4321')
  })

  it('keeps only the last four digits when masked', () => {
    // TASK-0058 F2 (앞 4자리 + 뒤 4자리). 6.2 는 같은 규칙을 로그에도 건다.
    expect(maskVirtualCardNumber('9999-0123-4567-8901')).toBe('9999-****-****-8901')
  })

  it('leaves nothing of the middle digits behind', () => {
    const number = virtualCardNumberFrom(BYTES)
    const masked = maskVirtualCardNumber(number)

    // 「전문이 남지 않는다」를 자리마다 재지 않고 성질로 잰다 — 가운데 여덟 자리
    // 중 하나라도 살아 있으면 로그에서 카드번호를 복원할 실마리가 남는다.
    expect(masked).not.toContain('0123')
    expect(masked).not.toContain('4567')
  })

  it('never echoes the leading digits of whatever it was given', () => {
    // 마스킹 함수는 「무엇이 들어올지 모르는 자리」에 있다. 앞자리를 입력에서
    // 잘라 오는 구현이었다면 실제 카드번호가 흘러든 날 그 카드의 BIN 을 그대로
    // 로그에 찍는다.
    expect(maskVirtualCardNumber('4111-1111-1111-1234')).toBe('9999-****-****-1234')
  })
})

describe('상태', () => {
  it('decides usability for every declared status', () => {
    // 레코드로 쓴 것이 컴파일에서 이미 강제하는 성질이지만, 여기서 한 번 더 재는
    // 것은 「일단 true 로 채워 넣고 넘어간」 상태를 잡기 위해서다.
    expect(Object.keys(chargeableStatuses).sort()).toEqual([...virtualCardStatuses].sort())
  })

  it('lets only an active card take a new charge', () => {
    expect(isChargeable('ACTIVE')).toBe(true)
    // 정지는 사람이 멈춰 세운 것이고 삭제는 소프트 삭제다. 둘 다 되살아나거나
    // 원장에 남지만, 새 승인을 받는 카드는 아니다.
    expect(isChargeable('SUSPENDED')).toBe(false)
    expect(isChargeable('DELETED')).toBe(false)
  })
})

describe('사용 가능액', () => {
  it('is the credit limit minus what has been used', () => {
    expect(availableCredit({ creditLimit: 1_000_000, usedAmount: 0 })).toBe(1_000_000)
    expect(availableCredit({ creditLimit: 1_000_000, usedAmount: 400_000 })).toBe(600_000)
  })

  it('is zero for a card whose limit is entirely used', () => {
    expect(availableCredit({ creditLimit: 30_000, usedAmount: 30_000 })).toBe(0)
  })

  it('goes negative rather than hiding a ledger that stopped reconciling', () => {
    // 0으로 접으면 F3 점검이 볼 수 있는 유일한 표시가 사라진다. 접지 않으면 이
    // 카드의 승인은 전부 거절되고, 그쪽이 안전하다.
    expect(availableCredit({ creditLimit: 10_000, usedAmount: 12_000 })).toBe(-2_000)
  })
})

describe('승인 판단 — 허용', () => {
  it('allows a charge and reports the used amount to write', () => {
    // F1. 부르는 쪽이 다시 더하지 않도록 판단이 결과 숫자를 들고 나온다.
    expect(chargeDecision(card(), 250_000)).toEqual({
      outcome: 'allowed',
      usedAmount: 250_000,
      availableAmount: 750_000,
    })
  })

  it('allows a charge of exactly the remaining credit', () => {
    // 경계. 여기가 거절되면 한도를 끝까지 쓸 수 없는 카드가 되고, 마지막 1원은
    // 아무도 쓰지 못한 채 한도에 남는다.
    expect(chargeDecision(card({ usedAmount: 999_000 }), 1_000)).toEqual({
      outcome: 'allowed',
      usedAmount: 1_000_000,
      availableAmount: 0,
    })
  })

  it('allows the smallest possible charge', () => {
    expect(chargeDecision(card(), 1)).toMatchObject({ outcome: 'allowed', usedAmount: 1 })
  })

  it('adds onto what was already used', () => {
    expect(chargeDecision(card({ usedAmount: 300_000 }), 200_000)).toEqual({
      outcome: 'allowed',
      usedAmount: 500_000,
      availableAmount: 500_000,
    })
  })
})

describe('승인 판단 — 거절', () => {
  it('refuses one won more than the remaining credit', () => {
    // F4. 위 경계의 반대편이다. 통과하면 한도를 넘긴 카드가 생기고, 그 카드는
    // 「사용액이 한도를 넘을 수 없다」를 반증한 채로 계속 결제된다.
    expect(chargeDecision(card({ usedAmount: 999_000 }), 1_001)).toEqual({
      outcome: 'refused',
      reason: 'exceeds_credit',
      // 거절이 숫자를 들고 있어야 얼마짜리로 나눠 담을지 정할 수 있다.
      availableAmount: 1_000,
    })
  })

  it('refuses any charge on a card with nothing left', () => {
    expect(chargeDecision(card({ usedAmount: 1_000_000 }), 1)).toEqual({
      outcome: 'refused',
      reason: 'exceeds_credit',
      availableAmount: 0,
    })
  })

  it('refuses a charge on a card that cannot be used at all', () => {
    // 금액이 아니라 카드가 문제인 경우다. 「한도를 초과했습니다」로 답하면 부르는
    // 쪽은 금액을 줄여 다시 시도하고, 그 시도는 전부 같은 이유로 거절된다.
    for (const status of ['SUSPENDED', 'DELETED'] as const) {
      expect(chargeDecision(card({ status }), 1_000)).toEqual({
        outcome: 'refused',
        reason: 'card_unusable',
        // 쓸 수 없는 카드의 남은 한도를 알려 주면 쓸 수 없는 돈을 쓸 수 있다고
        // 말하는 셈이 된다.
        availableAmount: 0,
      })
    }
  })

  it('refuses everything on an unusable card, whatever the amount', () => {
    for (const amount of [-1, 0, 0.5, 1, 1_000_000, 1_000_001]) {
      expect(chargeDecision(card({ status: 'SUSPENDED' }), amount)).toMatchObject({
        outcome: 'refused',
        reason: 'card_unusable',
      })
    }
  })

  it('refuses a charge of nothing', () => {
    expect(chargeDecision(card(), 0)).toEqual({
      outcome: 'refused',
      reason: 'invalid_amount',
      availableAmount: 1_000_000,
    })
  })

  it('refuses a negative charge, which would return credit under a charge name', () => {
    // 음수 승인은 원장에 CHARGE 로 남으면서 한도를 늘린다. 그렇게 늘어난 한도는
    // 누구도 발급한 적이 없다.
    expect(chargeDecision(card(), -1)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })

  it('refuses an amount that is not a whole won', () => {
    // 소수가 한 번 섞이면 원장 합계와 usedAmount 의 비교가 부동소수 비교가 되고,
    // F3 은 그 뒤로 「거의 같다」까지만 말할 수 있다.
    expect(chargeDecision(card(), 1_000.5)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })
})

describe('반환 판단', () => {
  /** 100만원 한도에서 30만원을 쓴 카드. */
  function used(overrides: Partial<VirtualCardCredit> = {}): VirtualCardCredit {
    return { creditLimit: 1_000_000, usedAmount: 300_000, ...overrides }
  }

  it('gives credit back and reports the used amount to write', () => {
    expect(releaseDecision(used(), 100_000)).toEqual({
      outcome: 'allowed',
      usedAmount: 200_000,
      availableAmount: 800_000,
    })
  })

  it('allows releasing exactly what was used', () => {
    // 경계. 전액 환불이 여기 걸리면 취소된 주문의 한도가 영원히 묶인다.
    expect(releaseDecision(used(), 300_000)).toEqual({
      outcome: 'allowed',
      usedAmount: 0,
      availableAmount: 1_000_000,
    })
  })

  it('refuses one won more than was used', () => {
    // 경계의 반대편. 통과하면 usedAmount 가 음수가 되고, 사용 가능액이 한도보다
    // 커진 그 카드는 없는 돈을 쓸 수 있는 카드가 된다.
    expect(releaseDecision(used(), 300_001)).toEqual({
      outcome: 'refused',
      reason: 'exceeds_used',
      releasableAmount: 300_000,
    })
  })

  it('refuses any release on a card that has used nothing', () => {
    expect(releaseDecision(used({ usedAmount: 0 }), 1)).toEqual({
      outcome: 'refused',
      reason: 'exceeds_used',
      releasableAmount: 0,
    })
  })

  it('refuses a release of nothing and a negative one', () => {
    for (const amount of [0, -1]) {
      expect(releaseDecision(used(), amount)).toEqual({
        outcome: 'refused',
        reason: 'invalid_amount',
        releasableAmount: 300_000,
      })
    }
  })

  it('refuses an amount that is not a whole won', () => {
    expect(releaseDecision(used(), 0.5)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })

  it('does not look at the status, so a suspended card still takes its refunds', () => {
    // 정지·삭제된 카드로 새 결제는 못 하지만, 그 카드로 이미 나간 결제의 환불은
    // 돌아와야 한다. 막으면 카드를 정지시키는 순간 미결 환불이 갈 곳을 잃고
    // usedAmount 가 영원히 그 금액을 물고 있는다 — 원장이 대사되지 않는다.
    const suspended = card({ status: 'SUSPENDED', usedAmount: 300_000 })

    expect(chargeDecision(suspended, 1_000)).toMatchObject({ reason: 'card_unusable' })
    expect(releaseDecision(suspended, 300_000)).toMatchObject({ outcome: 'allowed', usedAmount: 0 })
  })

  it('returns to where it started after a charge and its release', () => {
    // F2·F3 을 순수한 자리에서 잰 것. 승인 3건과 그중 2건의 환불을 걸어도 판단이
    // 들고 나온 usedAmount 의 마지막 값은 원장 금액의 합과 같아야 한다.
    const entries: number[] = []
    let current: ChargeableCard = card()

    for (const amount of [250_000, 400_000, 100_000]) {
      const decision = chargeDecision(current, amount)

      expect(decision.outcome).toBe('allowed')

      if (decision.outcome !== 'allowed') return

      entries.push(amount)
      current = { ...current, usedAmount: decision.usedAmount }
    }

    for (const amount of [400_000, 100_000]) {
      const decision = releaseDecision(current, amount)

      expect(decision.outcome).toBe('allowed')

      if (decision.outcome !== 'allowed') return

      entries.push(-amount)
      current = { ...current, usedAmount: decision.usedAmount }
    }

    expect(current.usedAmount).toBe(250_000)
    expect(entries.reduce((sum, amount) => sum + amount, 0)).toBe(current.usedAmount)
    expect(availableCredit(current)).toBe(750_000)
  })
})

describe('발급 개수', () => {
  it('lets a user hold up to the maximum', () => {
    // F6. 데모 계정이 자동으로 받는 한 장(F5)이 이 수 안에 들어간다.
    expect(canIssueVirtualCard(0)).toBe(true)
    expect(canIssueVirtualCard(VIRTUAL_CARDS_PER_USER - 1)).toBe(true)
  })

  it('refuses the one past the maximum', () => {
    expect(canIssueVirtualCard(VIRTUAL_CARDS_PER_USER)).toBe(false)
    expect(canIssueVirtualCard(VIRTUAL_CARDS_PER_USER + 1)).toBe(false)
  })
})
