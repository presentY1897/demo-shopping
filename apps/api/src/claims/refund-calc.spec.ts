import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'
import type { RefundableLine, ShippingAdjustmentInput } from './refund-calc.js'
import {
  lineNetAmount,
  lineRefundAmount,
  refundBreakdown,
  refundThroughUnits,
  shippingAdjustment,
} from './refund-calc.js'

/**
 * 환불액 계산, 남김없이 (TASK-0068 6.2 — Q5 강화, 분기 100%).
 *
 * **이 파일의 값은 숫자에 있다.** 여기서 어긋나는 것은 실패로 나타나지 않는다 —
 * 화면은 계산된 값을 그대로 그리고, 사라진 1원은 아무 데도 가지 않은 채 전량
 * 환불한 사람의 장부에 남아 정산까지 따라간다. 그 1원을 재는 것이 이 파일의
 * 존재 이유다.
 *
 * `packages/shared` 의 `allocate` 스펙이 **항목 사이**에서 잔여를 버리지 않는 것을
 * 쟀다면, 여기는 같은 규칙(`pricing.md` 원칙 2번)을 **시간 축**에서 잰다: 한 항목을
 * 여러 번 나눠 환불해도 합이 순액과 **정확히** 같아야 한다.
 *
 * 재는 것이 다섯이다. **어떤 분할 순서에서도 합계가 보존되는가**(1절), **경계에서
 * 방어가 어떻게 도는가**(2절), **배송비 네 줄**(3절), **총액이 음수로 뒤집히지
 * 않는가**(4절), **이 전부가 `pricing.md` 3장과 같은 말인가**(5절).
 *
 * 1절이 이 스펙의 이유이고, 5절이 없으면 나머지는 코드를 코드와 비교하는 셈이 된다.
 */

// ---------------------------------------------------------------------------
// 항목 만들기
// ---------------------------------------------------------------------------

/**
 * **순액이 수량으로 나누어떨어지지 않는 항목은 안분액에서만 나온다.**
 *
 * `productAmount` 는 `단가 × 수량` 이라 언제나 수량으로 나누어떨어진다. 그래서 이
 * 파일이 쫓는 1원은 상품금액이 아니라 **쿠폰·적립금 안분액**에서 생긴다 — 안분이
 * 이미 `floor` 로 나눈 값이라(`pricing.md` 2장) 순액을 수량과 서로소인 수로 만든다.
 * 아래 예제 숫자가 전부 「단가 × 수량 − 안분액」인 이유가 그것이다.
 */
function lineOf(unitPrice: number, quantity: number, discounts: Partial<RefundableLine> = {}) {
  return {
    quantity,
    productAmount: unitPrice * quantity,
    couponDiscountAmount: 0,
    pointDiscountAmount: 0,
    ...discounts,
  } satisfies RefundableLine
}

/**
 * 순액이 정확히 `net` 인 항목. 성질 검사에서 순액을 좌표로 쓰려고 있다.
 *
 * 단가를 `net + quantity` 로 잡아 상품금액이 순액보다 크게 만들고 차액을 쿠폰
 * 안분액으로 돌린다 — **실제 주문에서 생길 수 있는 모양**을 유지하기 위해서다.
 * 상품금액을 그냥 `net` 으로 두면 「단가 × 수량」이 아닌 행이 되어, 위 문단이
 * 설명한 「1원은 안분에서만 나온다」가 이 검사에서만 거짓이 된다.
 */
function lineWithNet(quantity: number, net: number): RefundableLine {
  const productAmount = quantity * (net + quantity)

  return {
    quantity,
    productAmount,
    couponDiscountAmount: productAmount - net,
    pointDiscountAmount: 0,
  }
}

// ---------------------------------------------------------------------------
// 나눠 환불하기
// ---------------------------------------------------------------------------

/**
 * `total` 개를 1개 이상씩 쪼개는 **모든 순서**. 3개면 `[3] · [2,1] · [1,2] · [1,1,1]`.
 *
 * 순서까지 다 도는 것이 핵심이다. 「3개를 세 번에」만 재면 「2개 뒤에 1개」와
 * 「1개 뒤에 2개」가 다른 답에 닿는 구현도 통과한다 — 사람은 그 순서를 고르지 않고,
 * 환불 신청이 오는 순서가 고른다.
 */
function compositions(total: number): readonly (readonly number[])[] {
  if (total === 0) return [[]]

  const result: (readonly number[])[] = []

  for (let first = 1; first <= total; first += 1) {
    for (const rest of compositions(total - first)) result.push([first, ...rest])
  }

  return result
}

/** 이 순서대로 나눠 환불했을 때 매번 나가는 돈. 앞선 환불이 누계로 쌓인다. */
function refundInOrder(line: RefundableLine, chunks: readonly number[]): readonly number[] {
  let already = 0

  return chunks.map((units) => {
    const amount = lineRefundAmount(line, already, units)

    already += units

    return amount
  })
}

/**
 * **이 파일이 하지 않기로 한 계산** — 누계를 보지 않고 매번 따로 `floor` 한다.
 *
 * 흉내를 여기 둔 이유는, 1절 3번이 「구현이 맞다」가 아니라 **「이렇게 했으면
 * 틀렸다」**를 실제 숫자로 보이기 위해서다. 그 대비가 없으면 누적 계산은 그냥
 * 복잡한 코드로 보이고, 언젠가 「한 줄로 줄일 수 있다」며 지워진다.
 */
function naiveInOrder(line: RefundableLine, chunks: readonly number[]): readonly number[] {
  return chunks.map((units) => Math.floor((lineNetAmount(line) * units) / line.quantity))
}

function sum(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0)
}

// ---------------------------------------------------------------------------
// 배송비
// ---------------------------------------------------------------------------

/**
 * 기본 배송비 3,000원 · 무료배송 문턱 50,000원인 가게. 조정 없는 부분 환불이다.
 *
 * **`remainingEligibleAmount` 에 무엇을 넣는지는 이 함수가 정하지 못한다.**
 * `pricing.md` 1장은 무료배송 판정을 「상품금액 **− 쿠폰 할인**」으로 재라고 못
 * 박고 「3장의 부분 취소도 같은 기준으로 다시 잰다」고 이어 적는데, 이 인자의
 * 이름과 주석은 「남는 항목의 상품금액 합」이다. 두 값이 갈리는 주문에서는
 * 부르는 쪽이 어느 쪽을 넣느냐로 배송비 3,000원이 붙거나 안 붙는다 — 순수 계산인
 * 이 파일에서는 잴 수 없어 **보고만 한다.**
 */
function shipping(overrides: Partial<ShippingAdjustmentInput> = {}): ShippingAdjustmentInput {
  return {
    full: false,
    chargedShippingFee: 0,
    standardShippingFee: 3_000,
    remainingEligibleAmount: 50_000,
    freeShippingThreshold: 50_000,
    returnFee: 0,
    // 기본은 「구매자 사정」이다. 판매자 귀책은 **재부과를 막는** 값이라, 기본으로
    // 켜 두면 이 파일의 재부과 검사가 전부 조용히 통과한다.
    sellerAtFault: false,
    ...overrides,
  }
}

/**
 * 배송비 조정액. **음의 영을 0 으로 접는다.**
 *
 * 부분 환불의 답이 `-반품비 − 재부과액` 이라, 둘 다 0 이면 IEEE 754 의 `-0` 이
 * 나온다. 값으로는 0 이고(`-0 === 0`) JSON 에도 정수 컬럼에도 0 으로 앉으므로 **돈은
 * 틀어지지 않지만**, `toBe` 는 `Object.is` 라 `-0` 과 `0` 을 다르게 본다. 여기서 한 번
 * 접고, 그 성질 자체는 3절 마지막 줄이 따로 못 박는다 — 접은 것을 적어 두지 않으면
 * 나중에 이 헬퍼가 「의미 없는 `+ 0`」으로 지워진다.
 */
function adjustment(input: ShippingAdjustmentInput): number {
  return shippingAdjustment(input) + 0
}

// ---------------------------------------------------------------------------
// 1절. 1원이 사라지지 않는다
// ---------------------------------------------------------------------------

describe('1. 1원이 사라지지 않는다', () => {
  /** 10,000원짜리 3개에 쿠폰 1,000원이 안분됐다. 순액 29,000원은 3으로 안 나뉜다. */
  const tenThousandEach = lineOf(10_000, 3, { couponDiscountAmount: 1_000 })
  /** 7,777원짜리 3개에 적립금 1원이 안분됐다. 순액 23,330원. */
  const oddPriced = lineOf(7_777, 3, { pointDiscountAmount: 1 })
  /** 1원짜리 3개에 쿠폰 1원. 순액 2원 — 나눌 것이 개수보다 적은 극단이다. */
  const oneWonEach = lineOf(1, 3, { couponDiscountAmount: 1 })

  it('한 개씩 세 번 환불한 합이 순액과 정확히 같다', () => {
    // 잔여가 **마지막 환불로 흘러가는** 것이 보이도록 몫을 통째로 적는다. 9,666원이
    // 두 번이 아니라 한 번인 것은 29,000 ÷ 3 이 9,666.67 이기 때문이고, 마지막 몫이
    // 1원 더 큰 것이 「버리지 않았다」는 뜻이다.
    expect(refundInOrder(tenThousandEach, [1, 1, 1])).toEqual([9_666, 9_667, 9_667])
    expect(sum(refundInOrder(tenThousandEach, [1, 1, 1]))).toBe(lineNetAmount(tenThousandEach))
    expect(lineNetAmount(tenThousandEach)).toBe(29_000)

    expect(refundInOrder(oddPriced, [1, 1, 1])).toEqual([7_776, 7_777, 7_777])
    expect(sum(refundInOrder(oddPriced, [1, 1, 1]))).toBe(23_330)

    // 첫 개를 환불한 사람은 **0원을 받는다.** 2원을 3개로 나눌 방법이 없어서이고,
    // 그래도 2원은 사라지지 않고 뒤의 두 번에 1원씩 남는다.
    expect(refundInOrder(oneWonEach, [1, 1, 1])).toEqual([0, 1, 1])
    expect(sum(refundInOrder(oneWonEach, [1, 1, 1]))).toBe(2)
  })

  it('「1,1,1」·「2,1」·「1,2」·「3」이 전부 같은 합에 닿는다', () => {
    const totalOf = (chunks: readonly number[]): number =>
      sum(refundInOrder(tenThousandEach, chunks))

    expect([totalOf([1, 1, 1]), totalOf([2, 1]), totalOf([1, 2]), totalOf([3])]).toEqual([
      29_000, 29_000, 29_000, 29_000,
    ])

    // 같은 합에 닿지만 **나가는 돈은 다르다.** 2개를 먼저 환불한 사람은 19,333원을
    // 받고, 1개씩 두 번 받은 사람은 9,666 + 9,667 로 같은 19,333원에 닿는다.
    expect(refundInOrder(tenThousandEach, [2, 1])).toEqual([19_333, 9_667])
    expect(refundInOrder(tenThousandEach, [1, 2])).toEqual([9_666, 19_334])
  })

  it('수량 2~12 · 순액 일곱 가지 · 모든 분할 순서에서 합계가 보존된다', () => {
    // 순액을 넓게 흩는다. 1·2 는 「나눌 것이 개수보다 적은」 쪽, 100,003 은 소수라
    // 어떤 수량으로도 나누어떨어지지 않는 쪽이다.
    const nets = [1, 2, 7, 999, 7_777, 29_000, 100_003]

    for (let quantity = 2; quantity <= 12; quantity += 1) {
      for (const net of nets) {
        const line = lineWithNet(quantity, net)

        for (const chunks of compositions(quantity)) {
          const amounts = refundInOrder(line, chunks)
          const where = `수량 ${String(quantity)} · 순액 ${String(net)} · 분할 ${chunks.join('+')}`

          // ① 합계 보존. 이 한 줄이 이 스펙의 전부다.
          expect(sum(amounts), where).toBe(net)
          // ② 어느 회차도 음수가 아니다. 음수는 **환불이 청구로 뒤집힌** 것이고,
          //    누계 계산이 뒤로 가지 않는다는 뜻이기도 하다.
          expect(
            amounts.every((amount) => amount >= 0 && Number.isInteger(amount)),
            where,
          ).toBe(true)
        }
      }
    }
  })

  it('floor 를 매번 따로 하면 실제로 1원이 사라진다', () => {
    // **이 검사가 누적 계산의 이유를 코드로 남긴다.** 같은 분할에 같은 항목인데
    // 답이 다르고, 다른 쪽이 덜 돌려준다.
    expect(naiveInOrder(tenThousandEach, [1, 1, 1])).toEqual([9_666, 9_666, 9_666])
    expect(sum(naiveInOrder(tenThousandEach, [1, 1, 1]))).toBe(28_998)
    expect(
      sum(refundInOrder(tenThousandEach, [1, 1, 1])) -
        sum(naiveInOrder(tenThousandEach, [1, 1, 1])),
    ).toBe(2)

    // 순액이 개수보다 작으면 **전액이 사라진다.** 2원을 세 번에 나눠 환불한 사람은
    // 한 푼도 못 받고, 그 2원은 어느 장부에도 환불로 적히지 않는다.
    expect(sum(naiveInOrder(oneWonEach, [1, 1, 1]))).toBe(0)
    expect(sum(refundInOrder(oneWonEach, [1, 1, 1]))).toBe(2)
  })

  it('따로 floor 한 쪽은 어떤 분할에서도 더 주지 못한다 — 늘 같거나 모자란다', () => {
    // 위 두 예제가 우연이 아니라 **방향이 정해진 손해**임을 재 둔다. 반대 방향의
    // 오차(더 돌려주는 쪽)가 나오면 그것은 또 다른 종류의 사고다.
    for (let quantity = 2; quantity <= 8; quantity += 1) {
      for (const net of [1, 2, 7, 999, 7_777, 29_000]) {
        const line = lineWithNet(quantity, net)

        for (const chunks of compositions(quantity)) {
          expect(sum(naiveInOrder(line, chunks))).toBeLessThanOrEqual(
            sum(refundInOrder(line, chunks)),
          )
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 2절. 경계
// ---------------------------------------------------------------------------

describe('2. 경계', () => {
  const threeUnits = lineOf(10_000, 3, { couponDiscountAmount: 1_000 })

  it('0개를 환불하면 0원이다', () => {
    expect(lineRefundAmount(threeUnits, 0, 0)).toBe(0)
    // 이미 두 개를 환불한 뒤에도 마찬가지다. 「지금까지」가 그대로면 나갈 돈이 없다.
    expect(lineRefundAmount(threeUnits, 2, 0)).toBe(0)
  })

  it('한 번에 전량을 환불하면 순액 그대로다', () => {
    expect(lineRefundAmount(threeUnits, 0, 3)).toBe(29_000)
    expect(refundThroughUnits(threeUnits, 3)).toBe(lineNetAmount(threeUnits))
  })

  it('이미 전량 환불된 뒤의 요청은 0원이다', () => {
    // 여기서 0이 아니면 **같은 항목을 두 번 환불한다.** 누계를 인자로 받는 설계의
    // 값이 이 한 줄에 있다 — 부르는 쪽이 누계를 넘겨주는 한, 초과 환불은 계산
    // 단계에서 이미 0으로 접힌다.
    expect(lineRefundAmount(threeUnits, 3, 1)).toBe(0)
    expect(lineRefundAmount(threeUnits, 3, 3)).toBe(0)
  })

  it('누계가 수량을 넘는 이상한 입력에도 0원으로 답한다', () => {
    // 있을 수 없는 값이지만, 있으면 **돈이 나간다.** 누계를 위에서 잘라 두면 이
    // 입력이 만드는 최악이 「0원」이고, 자르지 않으면 순액을 넘는 환불이다.
    expect(lineRefundAmount(threeUnits, 5, 1)).toBe(0)
    expect(refundThroughUnits(threeUnits, 99)).toBe(29_000)
    // 음수 쪽도 같은 자리에서 잘린다. 「지금까지 −1개」는 0개와 같은 말이어야 한다.
    expect(refundThroughUnits(threeUnits, -1)).toBe(0)
    // 다만 음수 누계는 **이번 몫을 삼킨다.** 자르기가 `누계 + 이번` 을 통째로 보므로
    // 「−5개 환불된 상태에서 3개」는 「−2개까지」에서 「−5개까지」를 뺀 값, 곧 0원이다.
    // 있을 수 없는 입력이고 틀리는 방향이 **덜 주는 쪽**이라 그대로 못 박는다 —
    // 여기서 음수를 0으로 접어 주면 반대 방향, 곧 초과 환불 쪽으로 문이 열린다.
    expect(lineRefundAmount(threeUnits, -5, 3)).toBe(0)
  })

  it('남은 것보다 많이 요청해도 남은 몫까지만 나간다', () => {
    // 2개를 환불한 뒤 5개를 더 달라고 하면 남은 1개 몫만 나간다. 19,333원까지 이미
    // 갔으므로 나머지 9,667원이 전부다.
    expect(lineRefundAmount(threeUnits, 2, 5)).toBe(9_667)
    expect(refundThroughUnits(threeUnits, 2) + lineRefundAmount(threeUnits, 2, 5)).toBe(29_000)
  })

  it('순액이 0인 항목은 어떤 분할에서도 0원이다', () => {
    // 전액 할인. 상품금액 10,000원이 쿠폰 6,000 + 적립금 4,000 으로 전부 덮였다.
    // 돌려줄 현금이 없는 것이지 환불이 거절된 것이 아니라, 답은 0이어야 한다.
    const fullyDiscounted = lineOf(2_500, 4, {
      couponDiscountAmount: 6_000,
      pointDiscountAmount: 4_000,
    })

    expect(lineNetAmount(fullyDiscounted)).toBe(0)

    for (const chunks of compositions(4)) {
      expect(sum(refundInOrder(fullyDiscounted, chunks))).toBe(0)
      expect(refundInOrder(fullyDiscounted, chunks).every((amount) => amount === 0)).toBe(true)
    }
  })

  it('수량이 1이면 나눌 것이 없다 — 전부 아니면 0이다', () => {
    const single = lineOf(10_000, 1, { couponDiscountAmount: 3 })

    expect(lineNetAmount(single)).toBe(9_997)
    expect(lineRefundAmount(single, 0, 1)).toBe(9_997)
    expect(lineRefundAmount(single, 0, 0)).toBe(0)
    expect(lineRefundAmount(single, 1, 1)).toBe(0)
  })

  it('환불 한 줄의 `units` 가 금액과 같은 자로 잘린다', () => {
    // 3개짜리 항목에 「2개 환불된 상태에서 5개 더」를 넣으면 남은 것은 1개뿐이다.
    // **수량과 금액이 같은 자를 써야** 저장된 행이 자기 금액을 설명한다 — 요청값을
    // 그대로 실으면 「7개를 환불했다」는 행이 남는데 금액은 1개 몫이고, 그 행을
    // 근거로 누계를 세는 쪽(F6)이 틀린 답에 닿는다.
    //
    // **거절은 여전히 부르는 쪽의 일이다.** 여기서 하는 것은 적히는 값이 사실이게
    // 하는 것뿐이고, 「남은 것보다 많이 요청했다」에 400 을 줄지는 서비스가 정한다.
    const breakdown = refundBreakdown({
      lines: [{ orderItemId: 'i1', line: threeUnits, alreadyRefundedUnits: 2, units: 5 }],
      shipping: shipping(),
    })

    expect(breakdown.lines).toEqual([{ orderItemId: 'i1', units: 1, amount: 9_667 }])
  })

  it('판매자 귀책이면 무료배송을 잃지 않는다', () => {
    // **잘못은 판매자가 했는데 구매자가 무료배송을 잃는 모양**을 막는 값이다.
    // 하자로 일부를 반품해 남은 금액이 문턱에 미달해도 재부과가 없다
    // (`pricing.md` 3장 — 판매자 귀책 반품은 배송비·반품비 판매자 부담).
    const facts = { remainingEligibleAmount: 10_000, freeShippingThreshold: 50_000 }

    expect(adjustment(shipping({ ...facts, sellerAtFault: true }))).toBe(0)
    expect(adjustment(shipping({ ...facts, sellerAtFault: false }))).toBe(-3_000)
  })
})

// ---------------------------------------------------------------------------
// 3절. 배송비 네 줄
// ---------------------------------------------------------------------------

describe('3. 배송비 네 줄', () => {
  it('전량 환불이면 배송비를 전액 돌려준다', () => {
    // 보낼 물건이 없어졌으니 받을 이유도 없다. 3,000원을 낸 사람은 3,000원을
    // 돌려받고, 무료배송으로 0원을 낸 사람은 돌려받을 것이 없다 — **낸 돈이
    // 기준**이지 가게의 기본 배송비가 아니다.
    expect(adjustment(shipping({ full: true, chargedShippingFee: 3_000 }))).toBe(3_000)
    expect(adjustment(shipping({ full: true, chargedShippingFee: 0 }))).toBe(0)
  })

  it('부분 환불이라도 남은 것이 문턱 이상이면 배송비는 그대로다', () => {
    // 경계는 「이상」이다. 남은 금액이 문턱과 같으면 무료배송이 그대로 성립하므로
    // 되살아날 배송비가 없다.
    expect(adjustment(shipping({ remainingEligibleAmount: 50_000 }))).toBe(0)
    expect(adjustment(shipping({ remainingEligibleAmount: 999_999 }))).toBe(0)
  })

  it('문턱에 1원 미달하면 배송비가 되살아난다', () => {
    // 49,999원. 무료배송으로 0원을 낸 사람이므로 기본 배송비 3,000원이 통째로 붙는다.
    expect(adjustment(shipping({ remainingEligibleAmount: 49_999 }))).toBe(-3_000)
  })

  it('이미 배송비를 낸 사람에게는 재부과가 0이다 — 뺄셈이 없으면 두 번 받는다', () => {
    // **이 두 줄이 같은 상황의 두 사람이다.** 문턱 미달인 것도, 가게의 기본
    // 배송비가 3,000원인 것도 같다. 다른 것은 주문 때 낸 돈뿐이고, 그래서 답이
    // 갈려야 한다 — 3,000원을 이미 낸 사람에게 3,000원을 또 붙이면 그는 한 번
    // 배송받고 배송비를 두 번 낸다.
    expect(adjustment(shipping({ remainingEligibleAmount: 49_999, chargedShippingFee: 0 }))).toBe(
      -3_000,
    )
    expect(
      adjustment(shipping({ remainingEligibleAmount: 49_999, chargedShippingFee: 3_000 })),
    ).toBe(0)

    // 낸 돈이 기본 배송비보다 큰 경우(도서산간 할증 같은 것)도 0에서 멈춘다.
    // 여기서 음수를 만들면 재부과가 **환불로 뒤집힌다.**
    expect(
      adjustment(shipping({ remainingEligibleAmount: 49_999, chargedShippingFee: 5_000 })),
    ).toBe(0)
  })

  it('무료배송이 없는 가게는 재부과할 것도 없다', () => {
    // 문턱이 `null` 이면 배송비가 애초에 조건부가 아니었다. 남은 금액이 얼마든
    // 되살아날 것이 없고, 남은 물건의 배송비는 이미 받아 둔 그대로다.
    expect(adjustment(shipping({ freeShippingThreshold: null, remainingEligibleAmount: 0 }))).toBe(
      0,
    )
    expect(
      adjustment(
        shipping({ freeShippingThreshold: null, remainingEligibleAmount: 0, returnFee: 3_000 }),
      ),
    ).toBe(-3_000)
  })

  it('반품비는 있으면 빠지고 없으면 아무 일도 없다', () => {
    // 전량 반품: 낸 배송비 3,000원을 돌려주고 반품비 3,000원을 뺀다. 합이 0이라
    // **아무 일도 없었던 것처럼 보이지만** 두 줄은 서로 다른 사실이고, 그래서
    // `returnCostShare` 는 두 값을 합치지 않는다.
    expect(adjustment(shipping({ full: true, chargedShippingFee: 3_000, returnFee: 3_000 }))).toBe(
      0,
    )
    // 반품비가 낸 배송비보다 크면 조정 자체가 음수가 된다.
    expect(adjustment(shipping({ full: true, chargedShippingFee: 3_000, returnFee: 5_000 }))).toBe(
      -2_000,
    )
    // 부분 반품에서는 재부과와 **함께** 빠진다. 두 사건이 겹치는 유일한 칸이다.
    expect(adjustment(shipping({ remainingEligibleAmount: 49_999, returnFee: 3_000 }))).toBe(-6_000)
    // 취소에는 반품비가 없다(0). 위 세 줄의 대조군이다.
    expect(adjustment(shipping({ full: true, chargedShippingFee: 3_000 }))).toBe(3_000)
  })

  it('조정할 것이 하나도 없으면 음의 영을 돌려준다 — 값으로는 0이다', () => {
    // 구현이 `-반품비 − 재부과액` 으로 답을 만들어 둘 다 0일 때 `-0` 이 나온다.
    // 돈으로는 0이고 JSON·정수 컬럼에도 0으로 앉지만, `Object.is` 로 비교하는
    // `toBe(0)` 은 여기서 실패한다. **고치지 않고 적어 둔다** — 이 부호를 이 자리에서
    // 지어내면, 조정액의 부호로 「재부과가 있었는가」를 읽는 쪽이 생겼을 때 그 판단이
    // 조용히 뒤집힌다. 위 검사들이 `adjustment` 로 접어 쓰는 근거가 이 줄이다.
    const raw = shippingAdjustment(shipping())

    expect(Object.is(raw, -0)).toBe(true)
    expect(raw === 0).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4절. 총액은 음수가 되지 않는다
// ---------------------------------------------------------------------------

describe('4. 총액은 음수가 되지 않는다', () => {
  /** 1,000원짜리 하나. 반품비가 물건값보다 비싼, 아주 싼 물건의 변심 반품이다. */
  const cheap = lineOf(1_000, 1)

  it('반품비가 항목 환불액보다 크면 0에서 바닥을 친다', () => {
    const breakdown = refundBreakdown({
      lines: [{ orderItemId: 'i1', line: cheap, alreadyRefundedUnits: 0, units: 1 }],
      shipping: shipping({ full: true, chargedShippingFee: 0, returnFee: 3_000 }),
    })

    // 1,000 − 3,000 = −2,000. 여기서 음수를 그대로 내보내면 환불이 **청구로
    // 뒤집힌다** — 프로바이더에 「−2,000원 환불」을 요청할 방법은 없다.
    expect(breakdown.total).toBe(0)
  })

  it('바닥을 쳐도 내역은 사실을 그대로 들고 있다', () => {
    const breakdown = refundBreakdown({
      lines: [{ orderItemId: 'i1', line: cheap, alreadyRefundedUnits: 0, units: 1 }],
      shipping: shipping({ full: true, chargedShippingFee: 0, returnFee: 3_000 }),
    })

    // **총액만 바닥을 치고 내역은 남는다.** 두 줄이 0으로 뭉개지면 「왜 0원인가」에
    // 답할 근거가 사라진다 — 항목이 0원이어서인지, 반품비가 2,000원 더 커서인지
    // 나중에 조사할 수 있어야 하고, 그 2,000원을 어떻게 받을지는 이 TASK 밖이다.
    expect(breakdown).toEqual({
      lines: [{ orderItemId: 'i1', units: 1, amount: 1_000 }],
      itemsAmount: 1_000,
      shippingAmount: -3_000,
      total: 0,
    })
  })

  it('재부과가 환불액보다 커도 마찬가지다', () => {
    const breakdown = refundBreakdown({
      lines: [{ orderItemId: 'i1', line: cheap, alreadyRefundedUnits: 0, units: 1 }],
      // 배송비 30,000원짜리 가게에서 1,000원짜리만 취소해 무료배송이 무너진 경우다.
      // `packages/shared` 의 `quoteRefund` 스펙이 잡아 둔 것과 같은 상황을 이 단위로
      // 옮겨 왔다.
      shipping: shipping({
        standardShippingFee: 30_000,
        remainingEligibleAmount: 49_000,
      }),
    })

    expect(breakdown.itemsAmount).toBe(1_000)
    expect(breakdown.shippingAmount).toBe(-30_000)
    expect(breakdown.total).toBe(0)
  })

  it('정확히 0이 되는 자리와 1원이 남는 자리를 가른다', () => {
    const totalFor = (unitPrice: number): number =>
      refundBreakdown({
        lines: [
          { orderItemId: 'i1', line: lineOf(unitPrice, 1), alreadyRefundedUnits: 0, units: 1 },
        ],
        shipping: shipping({ full: true, chargedShippingFee: 0, returnFee: 3_000 }),
      }).total

    // 반품비와 항목 환불액이 같은 순간에만 0이다. 1원이라도 크면 그 1원은 나가야
    // 하고, 여기서 바닥이 한 칸 높으면 **돌려줄 돈을 삼킨다.**
    expect([totalFor(2_999), totalFor(3_000), totalFor(3_001)]).toEqual([0, 0, 1])
  })

  it('여러 항목이면 항목 몫을 먼저 합치고 배송비는 한 번만 조정한다', () => {
    const breakdown = refundBreakdown({
      lines: [
        {
          orderItemId: 'i1',
          line: lineOf(10_000, 3, { couponDiscountAmount: 1_000 }),
          alreadyRefundedUnits: 0,
          units: 1,
        },
        {
          orderItemId: 'i2',
          line: lineOf(1, 3, { couponDiscountAmount: 1 }),
          alreadyRefundedUnits: 2,
          units: 1,
        },
      ],
      shipping: shipping({ remainingEligibleAmount: 49_999 }),
    })

    // 배송비는 `SellerOrder` 단위로 붙으므로(`pricing.md` 1장 ④) 항목 수와 무관하게
    // 한 번이다. 항목마다 조정하면 두 항목을 취소한 사람이 배송비를 두 번 돌려받는다.
    expect(breakdown.itemsAmount).toBe(9_667)
    expect(breakdown.shippingAmount).toBe(-3_000)
    expect(breakdown.total).toBe(6_667)
  })

  it('환불할 항목이 하나도 없으면 배송비 조정만 남는다', () => {
    const breakdown = refundBreakdown({ lines: [], shipping: shipping({ full: true }) })

    expect(breakdown).toEqual({ lines: [], itemsAmount: 0, shippingAmount: 0, total: 0 })
  })
})

// ---------------------------------------------------------------------------
// 5절. 문서와의 대조
// ---------------------------------------------------------------------------

/**
 * `pricing.md` 3장만. 문서에는 1·2·4·5장이 이어지고, 이 파일이 책임지는 것은 3장이다.
 *
 * 장을 못 찾았는데 조용히 빈 문자열을 돌려주면 이 절 전체가 「빈 것끼리 같다」로
 * 통과한다. 문서를 못 읽은 것과 문서가 비어 있는 것은 다른 사건이므로 던진다
 * (`seller-order-transitions.spec.ts` 1절이 같은 장치를 쓴다).
 */
function chapterThree(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')
  const chapter = /^## 3\. 환불 금액 계산[\s\S]*?(?=^## )/mu.exec(document)

  if (chapter === null) throw new Error('pricing.md 의 3장을 찾지 못했습니다.')

  return chapter[0]
}

/** 3장 첫 코드블록 — 환불액 공식. 뒤의 블록은 되돌리는 순서(①②③)라 여기가 아니다. */
function refundFormula(): string {
  const fence = /^```$([\s\S]*?)^```$/mu.exec(chapterThree())

  if (fence?.[1] === undefined) throw new Error('3장에서 환불액 공식을 찾지 못했습니다.')

  return fence[1]
}

/**
 * 공식의 Σ 안에 적힌 항들. `−` 는 U+2212 이지 하이픈이 아니다.
 *
 * **손으로 옮겨 적지 않는 이유**는 그 사본이 세 번째 진실이 되기 때문이다 —
 * 문서·코드·스펙이 각각 다른 말을 하는 상태가 되고, 정작 「문서와 코드가 갈라졌다」는
 * 아무도 못 잡는다.
 */
function documentTerms(): readonly string[] {
  const group = /환불액 = Σ\s*\(([^)]+)\)/u.exec(refundFormula())

  if (group?.[1] === undefined) throw new Error('환불액 공식에서 Σ 항을 찾지 못했습니다.')

  return group[1].split('−').map((term) => term.trim())
}

/** 문서가 쓴 항 이름 → 저장된 값. 이름이 바뀌거나 항이 늘면 아래에서 던진다. */
const TERM_OF: Readonly<Record<string, (line: RefundableLine) => number>> = {
  '항목 상품금액': (line) => line.productAmount,
  '항목 쿠폰안분액': (line) => line.couponDiscountAmount,
  '항목 적립금안분액': (line) => line.pointDiscountAmount,
}

/** 문서에 적힌 순서대로 「첫 항 − 나머지 항들」을 계산한다. */
function netFromDocument(line: RefundableLine): number {
  const [first, ...rest] = documentTerms()

  if (first === undefined) throw new Error('환불액 공식에 항이 하나도 없습니다.')

  const read = (term: string): number => {
    const value = TERM_OF[term]

    // 조용히 건너뛰면 이 절이 「두 항끼리 같다」로 통과하고, 정작 새로 생긴 항은
    // 아무도 못 본다.
    if (value === undefined) throw new Error(`문서의 항 「${term}」 을 코드에 붙일 수 없습니다.`)

    return value(line)
  }

  return rest.reduce((total, term) => total - read(term), read(first))
}

/** 3장 「배송비 환불」 표의 **상황** 열. 강조 표시(`**`)는 지운다. */
function shippingSituations(): readonly string[] {
  const table = /\*\*배송비 환불\*\*\n\n((?:\|.*\n)+)/u.exec(chapterThree())

  if (table?.[1] === undefined) throw new Error('3장에서 배송비 환불 표를 찾지 못했습니다.')

  return table[1]
    .trimEnd()
    .split('\n')
    .slice(2)
    .map((row) => (row.split('|')[1] ?? '').replaceAll('**', '').trim())
}

describe('5. 문서와 같은 말인가', () => {
  it('환불액 공식의 항이 셋이고, 그 셋이 순액과 같은 것을 말한다', () => {
    // 공식을 **문서에서 읽어 그대로 계산한다.** 세 값을 서로 다르게 잡아 항 하나가
    // 빠지거나 부호가 뒤집히면 답이 달라지도록 했다.
    const sample = lineOf(3_500, 4, { couponDiscountAmount: 700, pointDiscountAmount: 30 })

    expect(documentTerms()).toHaveLength(3)
    expect(netFromDocument(sample)).toBe(lineNetAmount(sample))
    expect(lineNetAmount(sample)).toBe(13_270)

    const tinySample = lineOf(1, 3, { couponDiscountAmount: 1 })

    expect(netFromDocument(tinySample)).toBe(lineNetAmount(tinySample))
  })

  it('공식의 나머지 반 「+ 배송비 환불」이 조정액 한 줄로 남는다', () => {
    expect(refundFormula()).toContain('+ 배송비 환불')

    const line = lineOf(10_000, 3, { couponDiscountAmount: 1_000 })
    const breakdown = refundBreakdown({
      lines: [{ orderItemId: 'i1', line, alreadyRefundedUnits: 0, units: 3 }],
      shipping: shipping({ full: true, chargedShippingFee: 3_000 }),
    })

    // `Σ(항목 …)` 는 `itemsAmount`, `+ 배송비 환불` 은 `shippingAmount`, 그 합이
    // `total` 이다 — 바닥을 치지 않는 한 **문서의 공식과 글자 그대로 같은 식**이다.
    expect(breakdown.itemsAmount).toBe(lineNetAmount(line))
    expect(breakdown.shippingAmount).toBe(3_000)
    expect(breakdown.total).toBe(breakdown.itemsAmount + breakdown.shippingAmount)
  })

  it('안분 잔여를 버리지 않는다는 원칙이 문서에 그대로 있다', () => {
    const root = findRepoRoot()

    if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

    // 1절 전부가 이 한 문장을 시간 축으로 옮긴 것이다. 문서에서 이 줄이 사라지면
    // 1절은 아무 근거 없이 까다롭게 구는 검사가 된다.
    expect(readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')).toContain(
      '원 단위 잔여를 버리지 않는다',
    )
  })

  it('배송비 표가 네 줄이고, 그 넷이 위에서 잰 상황들이다', () => {
    // **상황 열만 파싱한다.** 처리 열은 「배송비를 다시 부과 (환불액에서 차감)」
    // 같은 문장이라, 숫자로 옮기려면 「기본 배송비인가 낸 배송비인가」를 사람이
    // 정해야 한다 — 문서가 말하지 않은 그 판단이 3절의 뺄셈이다. 그래서 금액은
    // 3절에 손으로 적고, 여기서는 **표에서 줄이 늘거나 줄거나 이름이 바뀌면**
    // 빨개지도록 상황 열만 문서에서 읽는다.
    expect(shippingSituations()).toEqual([
      '해당 판매자 항목 전체 취소',
      '부분 취소 후 남은 금액이 무료배송 조건 미달',
      '판매자 귀책 반품',
      '단순 변심 반품',
    ])
  })

  it('판매자 귀책의 「전액 환불」은 부분 반품에서 이 함수만으로 표현되지 않는다', () => {
    // 표 셋째 줄은 「배송비·반품비 모두 판매자 부담, 구매자에게 전액 환불」이다.
    // 전량 반품이면 맞는다 — 반품비 0에 낸 배송비 전액 환불이다.
    expect(adjustment(shipping({ full: true, chargedShippingFee: 3_000, returnFee: 0 }))).toBe(
      3_000,
    )

    // **부분 반품이면 어긋난다.** `ShippingAdjustmentInput` 에는 귀책이 없어서,
    // 판매자 하자로 일부를 반품했는데 남은 금액이 문턱에 미달하면 구매자에게
    // 배송비가 재부과된다. `return-rules.ts` 의 `returnCostShare` 가 계산해 둔
    // `originalShippingRefund` 를 이 함수가 받지 못하는 것이 원인이다. 구현을 고치지
    // 않고 **지금의 답을 못 박아 보고한다** — 어느 쪽이 맞는지는 문서(`pricing.md`
    // 3장)를 먼저 고칠지 말지의 문제이고, TASK-0068 6.3 D2 가 그 순서를 정한다.
    expect(adjustment(shipping({ remainingEligibleAmount: 49_999, returnFee: 0 }))).toBe(-3_000)
  })
})
