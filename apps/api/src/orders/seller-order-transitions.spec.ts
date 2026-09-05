import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OrderStatus } from '@shopping/shared'
import { orderStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'
import type {
  SellerOrderActor,
  TransitionDecision,
  TransitionRefusal,
  TransitionRule,
} from './seller-order-transitions.js'
import {
  availableTransitions,
  ruleFor,
  sellerOrderActors,
  sellerOrderTransitions,
  transitionDecision,
} from './seller-order-transitions.js'

/**
 * 판매자 몫 주문의 순수 판단, 남김없이 (TASK-0059 6.2 — Q5 강화, 분기 100%).
 *
 * 이 표가 틀리는 방식은 **조용하다.** 없는 전이가 한 칸 열려 있으면 발송을 건너뛴
 * 주문이 배송완료로 앉고, 주체가 한 칸 넓으면 구매자가 남의 물건을 발송 처리한다.
 * 둘 다 빨간 테스트가 아니라 나중에 주문 하나로 나타난다.
 *
 * 그래서 재는 것이 넷이다. **표가 문서와 같은 것을 말하는가**(1절), **표 밖의
 * 조합이 하나도 안 새는가**(2절), **거절이 부르는 쪽에 쓸모 있는 답인가**(3·4절),
 * **표 자체가 지켜야 할 성질을 지키는가**(5절). 1절이 없으면 나머지는 표를 표와
 * 비교하는 셈이 된다 — 2절 첫 주석이 그 이유를 적는다.
 */

/** 실패 메시지에서 어느 칸인지 바로 읽히도록 전이를 한 줄로 적는다. */
function move(from: string, to: string): string {
  return `${from} → ${to}`
}

/**
 * 한 요청의 답.
 *
 * 운송장 기본값이 「없다」인 것은 그쪽이 흔한 쪽이기 때문이다 — 판매자가 발송
 * 버튼을 누르는 순간 대개 아직 운송장이 없다.
 */
function decide(
  from: OrderStatus,
  to: OrderStatus,
  actor: SellerOrderActor,
  hasTracking = false,
): TransitionDecision {
  return transitionDecision({ from, to, actor, hasTracking })
}

/** 거절 이유, 통과했으면 `null`. 매트릭스가 칸마다 한 값으로 비교하려고 있다. */
function refusalOf(decision: TransitionDecision): TransitionRefusal | null {
  return decision.outcome === 'refused' ? decision.reason : null
}

/** 표에 정의된 전이 전부, `from → to` 로. */
function tableTransitions(): readonly string[] {
  return orderStatuses.flatMap((from) =>
    sellerOrderTransitions[from].map((rule) => move(from, rule.to)),
  )
}

/** 표의 규칙 전부를 출발 상태와 함께. 5절이 규칙 하나하나의 성질을 볼 때 쓴다. */
function tableRules(): readonly (readonly [OrderStatus, TransitionRule])[] {
  return orderStatuses.flatMap((from) =>
    sellerOrderTransitions[from].map((rule) => [from, rule] as const),
  )
}

const DEFINED = new Set(tableTransitions())

// ---------------------------------------------------------------------------
// 1절. 표와 설계 문서
// ---------------------------------------------------------------------------

/**
 * `docs/design/state-machines.md` 의 1장만 — 문서에는 재고·결제·클레임 다이어그램이
 * 이어지고, 그중 이 표가 책임지는 것은 첫 장 하나다.
 */
function chapterOne(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs/design/state-machines.md'), 'utf8')
  const chapter = /^## 1\. 주문 [\s\S]*?(?=^## )/mu.exec(document)

  // 장 제목이 바뀌었는데 여기가 조용히 빈 문자열을 돌려주면, 이 절 전체가
  // 「빈 집합끼리 같다」로 통과한다. 문서를 못 읽은 것과 문서가 비어 있는 것은
  // 다른 사건이므로 던진다.
  if (chapter === null) throw new Error('state-machines.md 의 1장을 찾지 못했습니다.')

  return chapter[0]
}

/** 1장의 mermaid 블록 본문. */
function diagramBlock(): string {
  const fence = /^```mermaid$([\s\S]*?)^```$/mu.exec(chapterOne())

  if (fence?.[1] === undefined) throw new Error('1장에서 mermaid 다이어그램을 찾지 못했습니다.')

  return fence[1]
}

/**
 * 다이어그램이 그린 화살표 전부.
 *
 * **문서를 파싱하는 이유**는, 기대값을 손으로 옮겨 적으면 그 사본이 세 번째
 * 진실이 되기 때문이다 — 문서·코드·스펙이 각각 다른 말을 하는 상태가 되고,
 * 정작 「문서와 코드가 갈라졌다」는 아무도 못 잡는다 (TASK-0059 R1).
 */
function diagramArrows(): readonly (readonly [string, string])[] {
  const arrows = [...diagramBlock().matchAll(/^\s*(\S+)\s*-->\s*(\S+)/gmu)].map(
    ([, from, to]) => [from ?? '', to ?? ''] as const,
  )

  // 정규식이 하나도 못 잡으면 아래 비교가 「빈 집합 == 빈 집합」이 되어 조용히
  // 통과한다. mermaid 문법이 바뀌는 날 빨개져야 할 자리가 정확히 여기다.
  expect(arrows.length).toBeGreaterThan(0)

  for (const [from, to] of arrows) {
    for (const node of [from, to]) {
      // 다이어그램의 오타를 「문서에만 있는 전이」로 보고하면 원인을 찾는 데
      // 오래 걸린다. 상태 이름이 아닌 것은 그 자리에서 이름을 대며 실패한다.
      if (node !== '[*]') expect(orderStatuses, `다이어그램의 ${node}`).toContain(node)
    }
  }

  return arrows
}

/** `[*]` 는 시작·끝 표시이지 상태가 아니므로 전이에서 뺀다. */
function documentTransitions(): readonly string[] {
  return diagramArrows()
    .filter(([from, to]) => from !== '[*]' && to !== '[*]')
    .map(([from, to]) => move(from, to))
}

describe('표와 설계 문서가 같은 것을 말한다 (D2)', () => {
  it('defines every transition the diagram draws, and draws every transition it defines', () => {
    // 이 저장소가 가장 싫어하는 것이 문서와 코드의 분기이고, 그것을 잡는 자리는
    // 여기 하나다. 양방향으로 비교하는 것이 요점이다 — 한쪽만 보면 「문서에만
    // 있는 화살표」나 「코드에만 있는 규칙」 중 하나는 영영 안 걸린다.
    expect([...documentTransitions()].sort()).toEqual([...tableTransitions()].sort())
  })

  it('draws every status the enum declares', () => {
    // 위 비교만으로는 **양쪽에서 동시에 빠진 상태**를 못 잡는다. 상태를 하나 더
    // 넣고 표에 `[]` 로 채워 넣으면 다이어그램에도 없고 표의 전이 목록에도 없어
    // 두 집합이 여전히 같다. 그 상태는 「아무도 도달할 수 없고 어디로도 못 가는」
    // 상태로 조용히 태어난다.
    const drawn = new Set(diagramArrows().flat())

    for (const status of orderStatuses) expect([...drawn]).toContain(status)
  })

  it('names the diagram entry and exit points, which are not statuses', () => {
    // `[*]` 를 상태로 세면 「[*] → PAYMENT_PENDING」이 표에 없는 전이로 보고된다.
    // 그것은 주문서 생성이지 전이가 아니고, 만드는 쪽은 M07 이다.
    expect(diagramArrows().some(([from]) => from === '[*]')).toBe(true)
    expect(diagramArrows().some(([, to]) => to === '[*]')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2절. 매트릭스 전수
// ---------------------------------------------------------------------------

describe('매트릭스 전수 — 9 × 9 × 4', () => {
  it('refuses every combination the table does not define, and only those', () => {
    // **이 검사가 못 잡는 것.** 기대값을 표에서 파생시키므로, 표 자체가 틀려도
    // — 없는 전이가 한 줄 들어와 있거나 있어야 할 전이가 빠져 있어도 — 여기는
    // 초록이다. 표를 표와 비교하는 셈이기 때문이다.
    //
    // 그 구멍은 1절이 메운다. 저쪽의 기대값은 코드가 아니라 설계 문서에서
    // 나오므로, 표가 통째로 틀린 경우는 저기서 걸린다. 둘은 짝이고 하나만
    // 남으면 뜻이 절반으로 준다.
    const undefinedCells: string[] = []
    const definedCells: string[] = []

    for (const from of orderStatuses) {
      for (const to of orderStatuses) {
        for (const actor of sellerOrderActors) {
          const cell = `${move(from, to)} (${actor})`
          // 운송장은 채워 둔다. 여기서 보려는 것은 「정의됐는가」 하나이고,
          // 조건까지 비워 두면 정의된 칸의 거절이 두 가지 이유로 갈려 무엇을
          // 재는 검사인지 흐려진다.
          const reason = refusalOf(decide(from, to, actor, true))

          if (DEFINED.has(move(from, to))) {
            expect(reason, cell).not.toBe('undefined_transition')
            definedCells.push(cell)
            continue
          }

          expect(decide(from, to, actor, true), cell).toEqual({
            outcome: 'refused',
            reason: 'undefined_transition',
          })
          undefinedCells.push(cell)
        }
      }
    }

    // 루프가 실제로 전부 돌았는지 센다. `orderStatuses` 가 늘면 이 숫자가 먼저
    // 어긋나고, 그때 손대야 할 곳이 여기가 아니라 표라는 것이 드러난다.
    expect(definedCells.length + undefinedCells.length).toBe(9 * 9 * 4)
    expect(DEFINED.size).toBe(9)
    expect(definedCells).toHaveLength(9 * 4)
    expect(undefinedCells).toHaveLength(9 * 9 * 4 - 9 * 4)
  })

  it('counts the statuses and actors this matrix claims to cover', () => {
    // 위 검사의 `9 × 9 × 4` 가 진짜 전수인지는 이 두 줄에 달려 있다. 상태나
    // 주체가 늘면 여기가 먼저 빨개진다.
    expect(orderStatuses).toHaveLength(9)
    expect(sellerOrderActors).toEqual(['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'])
  })

  it('answers null from ruleFor for a move the table never defined', () => {
    // 매트릭스가 `transitionDecision` 을 통해 보는 것을 한 번은 직접 본다.
    expect(ruleFor('PAID', 'DELIVERED')).toBeNull()
    expect(ruleFor('PREPARING', 'SHIPPED')).toEqual({
      to: 'SHIPPED',
      actors: ['SELLER'],
      requires: 'tracking',
    })
  })
})

// ---------------------------------------------------------------------------
// 3절. 거절 이유의 순서
// ---------------------------------------------------------------------------

/**
 * 거절 이유는 **앞의 것부터** 나온다.
 *
 * 순서가 뒤집히면 답이 거짓말을 한다. 애초에 정의되지 않은 전이에 「권한이
 * 없다」고 답하면 권한을 얻으면 될 것처럼 들리고, 실제로 그 요청은 누가 보내도
 * 안 된다. 화면은 이 이유를 그대로 문장으로 바꾸므로, 순서는 문구의 문제가
 * 아니라 **사용자가 다음에 무엇을 하느냐**의 문제다.
 */
describe('거절 이유는 앞의 것부터 나온다', () => {
  it('names the undefined transition first when all three are wrong', () => {
    // 셋이 동시에 어긋난 요청이다. 발송을 건너뛴 배송완료(정의 없음)를,
    // `PAID` 에서 아무것도 못 하는 구매자가(권한 없음), 운송장 없이(조건 미달).
    expect(decide('PAID', 'DELIVERED', 'BUYER', false)).toEqual({
      outcome: 'refused',
      reason: 'undefined_transition',
    })
  })

  it('names the actor before the requirement', () => {
    // 구매자에게 「운송장을 입력해 주세요」라고 답하면, 운송장을 구해 오면 될
    // 것처럼 들린다. 구매자는 무엇을 들고 와도 발송할 수 없다.
    expect(decide('PREPARING', 'SHIPPED', 'BUYER', false)).toMatchObject({
      reason: 'actor_forbidden',
    })
  })

  it('advances the answer exactly one step for each fault repaired', () => {
    // 순서가 있다는 것을 「하나씩 고치면 답이 하나씩 나아간다」로 본다. 어느 두
    // 검사가 뒤바뀌어도 이 사다리의 한 칸이 무너진다.
    expect(refusalOf(decide('PAID', 'DELIVERED', 'BUYER', false))).toBe('undefined_transition')
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'BUYER', false))).toBe('actor_forbidden')
    // 운송장을 갖춰도 주체가 그대로면 답은 안 바뀐다 — 조건은 아직 보지도 않는다.
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'BUYER', true))).toBe('actor_forbidden')
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'SELLER', false))).toBe('requirement_unmet')
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'SELLER', true))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4절. 이유 하나하나가 실제로 나온다
// ---------------------------------------------------------------------------

describe('세 이유가 각각 도달한다', () => {
  it('refuses a delivery that skipped the shipment (F2)', () => {
    // 다이어그램에 `PAID --> DELIVERED` 화살표가 없다는 사실이 여기서 답이 된다.
    // 통과하면 발송된 적 없는 주문이 배송완료로 앉고, 그 뒤 D+7 자동 확정이
    // 정산까지 밀어 준다.
    for (const actor of sellerOrderActors) {
      expect(decide('PAID', 'DELIVERED', actor, true)).toEqual({
        outcome: 'refused',
        reason: 'undefined_transition',
      })
    }
  })

  it('refuses a buyer shipping the goods (F3)', () => {
    expect(decide('PREPARING', 'SHIPPED', 'BUYER', true)).toEqual({
      outcome: 'refused',
      reason: 'actor_forbidden',
    })
  })

  it('refuses a shipment with no tracking number (F4)', () => {
    expect(decide('PREPARING', 'SHIPPED', 'SELLER', false)).toEqual({
      outcome: 'refused',
      reason: 'requirement_unmet',
    })
  })

  it('allows the same shipment once the tracking number is there (F1)', () => {
    // **위 검사와 짝이다.** 거절만 재면 「이 전이는 늘 거절된다」와 구별되지
    // 않는다 — 규칙에서 `actors` 를 지워도 위 검사는 여전히 통과한다.
    expect(decide('PREPARING', 'SHIPPED', 'SELLER', true)).toEqual({
      outcome: 'allowed',
      rule: { to: 'SHIPPED', actors: ['SELLER'], requires: 'tracking' },
    })
  })

  it('ignores the tracking number on a move that never asked for one', () => {
    // 조건이 없는 전이는 운송장 유무로 갈리지 않는다. 갈리면 조건이 규칙이
    // 아니라 함수 안에 숨어 있다는 뜻이다.
    for (const hasTracking of [false, true]) {
      expect(decide('PAID', 'PREPARING', 'SELLER', hasTracking)).toMatchObject({
        outcome: 'allowed',
      })
    }
  })

  it('walks the happy path the task names (F1)', () => {
    expect(refusalOf(decide('PAYMENT_PENDING', 'PAID', 'SYSTEM'))).toBeNull()
    expect(refusalOf(decide('PAID', 'PREPARING', 'SELLER'))).toBeNull()
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'SELLER', true))).toBeNull()
    expect(refusalOf(decide('SHIPPED', 'DELIVERED', 'SYSTEM'))).toBeNull()
    expect(refusalOf(decide('DELIVERED', 'CONFIRMED', 'BUYER'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5절. 표가 지켜야 할 성질
// ---------------------------------------------------------------------------

/**
 * 종착 상태 넷. **손으로 적은 목록**이고, 아래에서 표에서 파생시킨 것과 맞춰 본다.
 *
 * 파생값만 쓰면 표에 종착 상태가 하나 더 생겨도 「그렇군」 하고 통과한다. 둘을
 * 나란히 두어야 **어느 쪽이 틀려도** 빨개진다 — 표가 전이를 잃어도, 이 목록이
 * 낡아도.
 */
const TERMINAL: readonly OrderStatus[] = ['CONFIRMED', 'CANCELED', 'RETURNED', 'PAYMENT_FAILED']

/** `SYSTEM` 만 할 수 있는 전이. 결제로 움직이는 둘이고, 그것이 설계의 요점이다. */
const SYSTEM_ONLY: readonly string[] = [
  move('PAYMENT_PENDING', 'PAID'),
  move('PAYMENT_PENDING', 'PAYMENT_FAILED'),
]

/** 사람만 할 수 있는 전이. 자동으로 일어나면 안 되는 것들이다. */
const HUMAN_ONLY: readonly string[] = [
  move('PAID', 'CANCELED'),
  move('PREPARING', 'SHIPPED'),
  move('PREPARING', 'CANCELED'),
  move('DELIVERED', 'RETURNED'),
]

describe('종착 상태에서는 아무 데도 못 간다', () => {
  it('agrees with the hand written list of terminal statuses', () => {
    const derived = orderStatuses.filter((status) => sellerOrderTransitions[status].length === 0)

    expect([...derived].sort()).toEqual([...TERMINAL].sort())
  })

  it('refuses every move out of a terminal status, for every actor', () => {
    // 매트릭스가 이미 덮는 칸이지만 따로 적는다. 이것이 깨졌을 때 알아야 할
    // 사실은 「어떤 칸이 샜다」가 아니라 **「끝난 주문이 다시 움직인다」**이고,
    // 그 문장이 실패 목록에 그대로 뜨는 편이 낫다.
    for (const from of TERMINAL) {
      for (const to of orderStatuses) {
        for (const actor of sellerOrderActors) {
          expect(refusalOf(decide(from, to, actor, true)), `${move(from, to)} (${actor})`).toBe(
            'undefined_transition',
          )
        }
      }
    }
  })

  it('offers a terminal status no buttons at all', () => {
    for (const status of TERMINAL) {
      for (const actor of sellerOrderActors) {
        expect(availableTransitions(status, actor), `${status} / ${actor}`).toEqual([])
      }
    }
  })
})

describe('규칙 하나하나가 성립한다', () => {
  it('gives every rule at least one actor', () => {
    // 주체가 빈 규칙은 「정의됐지만 아무도 못 하는」 전이다. 표에 있으면 화면은
    // 그 전이를 그리고 서버는 언제나 거절하므로, 눌리지 않는 버튼이 생긴다.
    for (const [from, rule] of tableRules()) {
      expect(rule.actors.length, move(from, rule.to)).toBeGreaterThan(0)
    }
  })

  it('never names the same actor twice in one rule', () => {
    // 중복은 그 자체로 해가 없지만, 아래 「SYSTEM 전용」 세는 자리와 사람이 표를
    // 읽는 눈을 동시에 흐린다.
    for (const [from, rule] of tableRules()) {
      expect(new Set(rule.actors).size, move(from, rule.to)).toBe(rule.actors.length)
    }
  })

  it('defines each destination once per state', () => {
    // 같은 목적지가 두 줄이면 `ruleFor` 가 앞의 것만 돌려주고 뒤의 것은 아무도
    // 모르게 죽는다. 주체나 조건이 다른 두 줄이면 특히 조용하다.
    for (const from of orderStatuses) {
      const destinations = sellerOrderTransitions[from].map((rule) => rule.to)

      expect(new Set(destinations).size, from).toBe(destinations.length)
    }
  })

  it('asks for a tracking number on the shipment and nowhere else', () => {
    const required = tableRules()
      .filter(([, rule]) => rule.requires !== undefined)
      .map(([from, rule]) => move(from, rule.to))

    expect(required).toEqual([move('PREPARING', 'SHIPPED')])
  })
})

describe('주체가 나뉘는 자리', () => {
  it('leaves the two payment driven moves to SYSTEM alone', () => {
    // 사람이 「결제됨」을 누르는 화면은 없다. 그것은 결제가 끝났다는 사실의
    // 결과이고, 여기에 사람을 하나라도 넣으면 결제 없이 주문을 결제됨으로
    // 옮기는 길이 열린다.
    const derived = tableRules()
      .filter(([, rule]) => rule.actors.every((actor) => actor === 'SYSTEM'))
      .map(([from, rule]) => move(from, rule.to))

    expect(derived).toEqual(SYSTEM_ONLY)
    expect(derived).toHaveLength(2)
  })

  it('keeps SYSTEM out of the moves a person has to decide', () => {
    // 반대쪽. 발송·취소·반품이 자동으로 일어나면 물건과 돈이 사람의 판단 없이
    // 움직인다.
    const derived = tableRules()
      .filter(([, rule]) => rule.actors.every((actor) => actor !== 'SYSTEM'))
      .map(([from, rule]) => move(from, rule.to))

    expect(derived).toEqual(HUMAN_ONLY)
    expect(derived).toHaveLength(4)
  })

  it('leaves the remaining three open to both', () => {
    // 아홉에서 둘과 넷을 빼면 셋. 이 뺄셈이 맞아야 위 두 목록이 「전부」다.
    expect(tableRules()).toHaveLength(9)
    expect(SYSTEM_ONLY.length + HUMAN_ONLY.length + 3).toBe(9)
  })

  it('never lets the buyer cancel by themselves', () => {
    // 취소는 클레임 절차의 결론이지 버튼이 아니다 (M10). 구매자를 여기 넣으면
    // 신청·승인 없이 취소가 일어나고, 그 취소에는 환불 근거가 남지 않는다.
    for (const [from, rule] of tableRules()) {
      if (rule.to !== 'CANCELED') continue

      expect(rule.actors, move(from, rule.to)).not.toContain('BUYER')
    }
  })
})

describe('가능한 액션 목록 (F7)', () => {
  it('gives each actor a different list from the same state', () => {
    expect(availableTransitions('PREPARING', 'SELLER').map((rule) => rule.to)).toEqual([
      'SHIPPED',
      'CANCELED',
    ])
    expect(availableTransitions('PREPARING', 'ADMIN').map((rule) => rule.to)).toEqual(['CANCELED'])
    expect(availableTransitions('PREPARING', 'BUYER')).toEqual([])
    expect(availableTransitions('PREPARING', 'SYSTEM')).toEqual([])
  })

  it('splits the two moves out of DELIVERED between the buyer and the seller', () => {
    // 같은 상태에서 구매자는 확정을, 판매자는 반품을 본다. 목록이 주체마다
    // 다르지 않으면 화면이 결국 상태로 분기하게 되고, 그 판단이 세 앱에 흩어진다.
    expect(availableTransitions('DELIVERED', 'BUYER').map((rule) => rule.to)).toEqual(['CONFIRMED'])
    expect(availableTransitions('DELIVERED', 'SELLER').map((rule) => rule.to)).toEqual(['RETURNED'])
    expect(availableTransitions('DELIVERED', 'ADMIN').map((rule) => rule.to)).toEqual(['RETURNED'])
    expect(availableTransitions('DELIVERED', 'SYSTEM').map((rule) => rule.to)).toEqual([
      'CONFIRMED',
    ])
  })

  it('keeps a move whose requirement is unmet in the list', () => {
    // **버튼을 감추지 않는다는 결정이 여기 걸린다.** 운송장이 없다고 발송을
    // 목록에서 빼면 판매자는 그 버튼을 찾다가 포기한다. 목록에 남기고, 누르면
    // 무엇이 필요한지 말해 주는 편이 낫다.
    expect(availableTransitions('PREPARING', 'SELLER').map((rule) => rule.to)).toContain('SHIPPED')
    expect(refusalOf(decide('PREPARING', 'SHIPPED', 'SELLER', false))).toBe('requirement_unmet')
  })

  it('offers exactly the moves the decision does not turn away on the actor', () => {
    // 목록과 판단이 갈리면 화면은 서버가 거절할 버튼을 그린다. 조건은 일부러
    // 빼고 본다 — 운송장은 목록이 아니라 판단이 볼 몫이다.
    for (const status of orderStatuses) {
      for (const actor of sellerOrderActors) {
        const offered = availableTransitions(status, actor).map((rule) => rule.to)
        const passable = sellerOrderTransitions[status]
          .filter((rule) => refusalOf(decide(status, rule.to, actor, true)) === null)
          .map((rule) => rule.to)

        expect(offered, `${status} / ${actor}`).toEqual(passable)
      }
    }
  })

  it('hands back the rule itself, requirement included', () => {
    // 화면이 「운송장이 필요한 버튼」을 미리 알 수 있어야 입력란을 함께 그린다.
    expect(availableTransitions('PREPARING', 'SELLER')).toEqual([
      { to: 'SHIPPED', actors: ['SELLER'], requires: 'tracking' },
      { to: 'CANCELED', actors: ['SELLER', 'ADMIN'] },
    ])
  })
})
