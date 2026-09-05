import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { orderStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'
import { sellerOrderActors } from '../orders/seller-order-transitions.js'
import type {
  ClaimEligibility,
  ClaimRefusal,
  ClaimRequestCheck,
  ClaimStatus,
  ClaimTransitionDecision,
  ClaimTransitionRefusal,
  ClaimTransitionRule,
  ClaimType,
} from './claim-rules.js'
import {
  CLAIM_INITIAL,
  claimEligibility,
  claimRouteFor,
  claimRuleFor,
  claimStatuses,
  claimTransitionDecision,
  claimTransitions,
  claimTypes,
  remainingQuantity,
} from './claim-rules.js'

/**
 * 클레임의 순수 판단, 남김없이 (TASK-0065 6.2 — Q5 강화, 분기 100%).
 *
 * 이 표가 틀리는 방식은 주문 쪽과 똑같이 **조용하다.** 없는 화살표가 한 칸 열려
 * 있으면 검수하지 않은 반품이 환불로 앉아 물건은 안 왔는데 돈만 나가고, 주체가
 * 한 칸 넓으면 **신청한 사람이 자기 신청을 승인한다.** 둘 다 빨간 검사가 아니라
 * 나중에 클레임 하나로 나타난다.
 *
 * 그래서 재는 것이 여섯이다. **표가 설계 문서와 같은 것을 말하는가**(1절), **표
 * 밖의 조합이 하나도 안 새는가**(2절), **표가 지켜야 할 성질을 지키는가**(3절),
 * **주문 상태가 경로를 제대로 가르는가**(4절), **거절이 사람에게 쓸모 있는
 * 답인가 — 그 순서까지**(5절), **잔여 수량이 음수로 새지 않는가**(6절).
 * 1절이 없으면 나머지는 표를 표와 비교하는 셈이 된다 — 2절 첫 주석이 그 이유를
 * 적는다.
 */

/** 실패 메시지에서 어느 칸인지 바로 읽히도록 전이를 한 줄로 적는다. */
function move(from: string, to: string): string {
  return `${from} → ${to}`
}

/** 거절 이유, 통과했으면 `null`. 매트릭스가 칸마다 한 값으로 비교하려고 있다. */
function refusalOf(decision: ClaimTransitionDecision): ClaimTransitionRefusal | null {
  return decision.outcome === 'refused' ? decision.reason : null
}

/** 표에 정의된 전이 전부, `from → to` 로. */
function tableTransitions(): readonly string[] {
  return claimStatuses.flatMap((from) => claimTransitions[from].map((rule) => move(from, rule.to)))
}

/** 표의 규칙 전부를 출발 상태와 함께. 3절이 규칙 하나하나의 성질을 볼 때 쓴다. */
function tableRules(): readonly (readonly [ClaimStatus, ClaimTransitionRule])[] {
  return claimStatuses.flatMap((from) =>
    claimTransitions[from].map((rule) => [from, rule] as const),
  )
}

const DEFINED = new Set(tableTransitions())

// ---------------------------------------------------------------------------
// 1절. 표와 설계 문서
// ---------------------------------------------------------------------------

/**
 * `docs/design/state-machines.md` 의 4장만 — 문서에는 주문·재고·결제·정산
 * 다이어그램이 함께 있고, 그중 이 표가 책임지는 것은 클레임 한 장이다.
 */
function chapterFour(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs/design/state-machines.md'), 'utf8')
  const chapter = /^## 4\. 클레임 [\s\S]*?(?=^## )/mu.exec(document)

  // 장 제목이 바뀌었는데 여기가 조용히 빈 문자열을 돌려주면, 이 절 전체가
  // 「빈 집합끼리 같다」로 통과한다. 문서를 못 읽은 것과 문서가 비어 있는 것은
  // 다른 사건이므로 던진다.
  if (chapter === null) throw new Error('state-machines.md 의 4장을 찾지 못했습니다.')

  return chapter[0]
}

/** 4장의 mermaid 블록 본문. */
function diagramBlock(): string {
  const fence = /^```mermaid$([\s\S]*?)^```$/mu.exec(chapterFour())

  if (fence?.[1] === undefined) throw new Error('4장에서 mermaid 다이어그램을 찾지 못했습니다.')

  return fence[1]
}

/**
 * `state "..." as X { ... }` 덩어리 하나.
 *
 * **4장은 주문 쪽과 모양이 다르다.** 취소와 반품이 각각 중첩된 덩어리로 그려져
 * 있고, 덩어리마다 자기 `[*]` 시작점을 갖는다. 그래서 파서가 「이 화살표가 어느
 * 덩어리 것인가」를 알아야 하고, `[*]` 도 하나가 아니라 덩어리마다 하나다.
 */
interface DiagramGroup {
  /** 따옴표 안의 이름. 이 화살표들이 어느 경로인지는 이것만이 말한다. */
  readonly label: string
  /** `[*] --> X` 의 X. **전이가 아니라 시작점**이므로 화살표와 따로 담는다. */
  readonly starts: string[]
  /** `X --> [*]` 의 X. 4장은 쓰지 않는 표기이고, 그것을 아래에서 못 박는다. */
  readonly exits: string[]
  readonly arrows: (readonly [string, string])[]
}

const GROUP_OPEN = /^\s*state\s+"([^"]+)"\s+as\s+\S+\s*\{\s*$/u
const GROUP_CLOSE = /^\s*\}\s*$/u
const ARROW = /^\s*(\S+)\s*-->\s*(\S+)/u

/**
 * 중첩 덩어리를 지키며 다이어그램을 읽는다.
 *
 * **문서를 파싱하는 이유**는, 기대값을 손으로 옮겨 적으면 그 사본이 세 번째
 * 진실이 되기 때문이다 — 문서·코드·스펙이 각각 다른 말을 하는 상태가 되고,
 * 정작 「문서와 코드가 갈라졌다」는 아무도 못 잡는다.
 *
 * 조용히 통과하는 길을 전부 막는다. 괄호가 어긋나면 그 뒤의 화살표가 엉뚱한
 * 덩어리에 담기고, 덩어리 밖 화살표를 버리면 그 전이만 비교에서 빠진다 — 둘 다
 * 초록으로 끝나는 종류라 여기서 던진다.
 */
function parseGroups(body: string): readonly DiagramGroup[] {
  const groups: DiagramGroup[] = []
  const open: DiagramGroup[] = []

  for (const line of body.split('\n')) {
    const opened = GROUP_OPEN.exec(line)

    if (opened !== null) {
      const group: DiagramGroup = { label: opened[1] ?? '', starts: [], exits: [], arrows: [] }

      groups.push(group)
      open.push(group)
      continue
    }

    if (GROUP_CLOSE.test(line)) {
      if (open.pop() === undefined) throw new Error('4장 다이어그램의 괄호가 맞지 않습니다.')
      continue
    }

    const arrow = ARROW.exec(line)

    if (arrow === null) continue

    const [, from = '', to = ''] = arrow
    const group = open.at(-1)

    if (group === undefined) {
      throw new Error(`4장 다이어그램에 덩어리 밖 화살표가 있습니다: ${line.trim()}`)
    }

    if (from === '[*]') group.starts.push(to)
    else if (to === '[*]') group.exits.push(from)
    else group.arrows.push([from, to] as const)
  }

  if (open.length > 0) throw new Error('4장 다이어그램의 괄호가 닫히지 않았습니다.')
  // 덩어리가 하나도 없으면 아래 비교가 「빈 집합 == 빈 집합」이 된다. mermaid
  // 문법이나 4장의 모양이 바뀌는 날 빨개져야 할 자리가 정확히 여기다.
  if (groups.length === 0) throw new Error('4장 다이어그램에서 상태 덩어리를 찾지 못했습니다.')

  return groups
}

/** 파싱 결과 + 이름 검사. */
function diagramGroups(): readonly DiagramGroup[] {
  const groups = parseGroups(diagramBlock())

  for (const group of groups) {
    for (const node of [...group.starts, ...group.exits, ...group.arrows.flat()]) {
      // 다이어그램의 오타를 「문서에만 있는 전이」로 보고하면 원인을 찾는 데
      // 오래 걸린다. 상태 이름이 아닌 것은 그 자리에서 이름을 대며 실패한다.
      expect(claimStatuses, `다이어그램의 ${node}`).toContain(node)
    }
  }

  return groups
}

/** 덩어리를 걷어낸 화살표 전부. 시작점(`[*] -->`)은 여기 없다. */
function diagramArrows(): readonly (readonly [string, string])[] {
  const arrows = diagramGroups().flatMap((group) => group.arrows)

  // 정규식이 하나도 못 잡으면 아래 비교가 조용히 통과한다.
  expect(arrows.length).toBeGreaterThan(0)

  return arrows
}

function documentTransitions(): readonly string[] {
  return diagramArrows().map(([from, to]) => move(from, to))
}

/**
 * 덩어리 이름과 유형.
 *
 * 문서는 한국어로 「취소」·「반품」이라 쓰고 코드는 `CANCEL`·`RETURN` 이라 쓴다.
 * 그 번역만은 어느 쪽에서도 파생시킬 수 없어 **여기 손으로 적는다** — 두 줄이고,
 * 틀리면 바로 아래 검사가 빨개진다.
 */
const GROUP_TYPES: readonly (readonly [string, ClaimType])[] = [
  ['취소', 'CANCEL'],
  ['반품', 'RETURN'],
]

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
    const drawn = new Set(
      diagramGroups().flatMap((group) => [...group.starts, ...group.arrows.flat()]),
    )

    for (const status of claimStatuses) expect([...drawn]).toContain(status)
  })

  it('nests the two paths as separate blocks', () => {
    // 4장의 모양 자체가 검사 대상이다. 두 덩어리가 하나로 합쳐지면 「경로가 섞이지
    // 않는다」(3절)를 문서가 더 이상 말하지 않는 것이고, 그때는 파서가 아니라
    // 설계를 다시 봐야 한다.
    expect(diagramGroups()).toHaveLength(claimTypes.length)
  })

  it('starts each block where CLAIM_INITIAL says the claim starts', () => {
    // `[*] --> CANCEL_REQUESTED` 는 전이가 아니라 **생성**이다. 전이표에 넣으면
    // 「신청된 적 없는 클레임을 신청됨으로 옮기는」 화살표가 생기고, 그것을 여기서
    // 따로 확인하지 않으면 `CLAIM_INITIAL` 은 아무 검사도 받지 않는다.
    const starts: Partial<Record<ClaimType, readonly string[]>> = {}

    for (const group of diagramGroups()) {
      for (const [word, type] of GROUP_TYPES) {
        if (group.label.includes(word)) starts[type] = group.starts
      }
    }

    // 이름이 하나도 안 걸린 덩어리는 키가 비어 실패하고, 둘 다 걸린 덩어리는 한쪽
    // 시작점이 어긋나 실패한다.
    expect(starts).toEqual({
      CANCEL: [CLAIM_INITIAL.CANCEL],
      RETURN: [CLAIM_INITIAL.RETURN],
    })
  })

  it('draws no exit arrows, because terminal here means "nothing leaves"', () => {
    // 주문 쪽 1장은 `CONFIRMED --> [*]` 로 끝을 그리지만 4장은 그러지 않는다.
    // 종착의 뜻이 두 가지가 되면 3절의 「나가는 전이가 없다」와 문서가 갈리므로,
    // 표기가 늘어나는 날 여기서 멈춘다.
    expect(diagramGroups().flatMap((group) => group.exits)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2절. 매트릭스 전수
// ---------------------------------------------------------------------------

describe('매트릭스 전수 — 10 × 10 × 4', () => {
  it('refuses every combination the table does not define, and only those', () => {
    // **이 검사가 못 잡는 것.** 기대값을 표에서 파생시키므로, 표 자체가 틀려도
    // — 없는 전이가 한 줄 들어와 있거나 있어야 할 전이가 빠져 있어도 — 여기는
    // 초록이다. 표를 표와 비교하는 셈이기 때문이다.
    //
    // 그 구멍은 1절이 메운다. 저쪽의 기대값은 코드가 아니라 4장 다이어그램에서
    // 나오므로, 표가 통째로 틀린 경우는 저기서 걸린다. 둘은 짝이고 하나만 남으면
    // 뜻이 절반으로 준다.
    const definedCells: string[] = []
    const undefinedCells: string[] = []

    for (const from of claimStatuses) {
      for (const to of claimStatuses) {
        for (const actor of sellerOrderActors) {
          const cell = `${move(from, to)} (${actor})`

          if (DEFINED.has(move(from, to))) {
            expect(refusalOf(claimTransitionDecision(from, to, actor)), cell).not.toBe(
              'undefined_transition',
            )
            definedCells.push(cell)
            continue
          }

          expect(claimTransitionDecision(from, to, actor), cell).toEqual({
            outcome: 'refused',
            reason: 'undefined_transition',
          })
          undefinedCells.push(cell)
        }
      }
    }

    // 루프가 실제로 전부 돌았는지 센다. `claimStatuses` 가 늘면 이 숫자가 먼저
    // 어긋나고, 그때 손대야 할 곳이 여기가 아니라 표라는 것이 드러난다.
    expect(definedCells.length + undefinedCells.length).toBe(10 * 10 * 4)
    expect(DEFINED.size).toBe(10)
    expect(definedCells).toHaveLength(10 * 4)
    expect(undefinedCells).toHaveLength(10 * 10 * 4 - 10 * 4)
  })

  it('counts the statuses and actors this matrix claims to cover', () => {
    // 위 검사의 `10 × 10 × 4` 가 진짜 전수인지는 이 두 줄에 달려 있다.
    expect(claimStatuses).toHaveLength(10)
    expect(sellerOrderActors).toEqual(['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'])
  })

  it('answers null from claimRuleFor for a move the table never defined', () => {
    // 매트릭스가 `claimTransitionDecision` 을 통해 보는 것을 한 번은 직접 본다.
    expect(claimRuleFor('CANCEL_REQUESTED', 'REFUNDED')).toBeNull()
    expect(claimRuleFor('CANCEL_APPROVED', 'REFUNDED')).toEqual({
      to: 'REFUNDED',
      actors: ['SYSTEM'],
    })
  })

  it('names the actor once the move itself is defined', () => {
    // 거절 둘이 각각 도달한다는 것. 정의 밖 전이에 「권한이 없다」고 답하면 권한을
    // 얻으면 될 것처럼 들리고, 실제로 그 요청은 누가 보내도 안 된다.
    expect(claimTransitionDecision('CANCEL_REQUESTED', 'CANCEL_APPROVED', 'BUYER')).toEqual({
      outcome: 'refused',
      reason: 'actor_forbidden',
    })
    expect(claimTransitionDecision('CANCEL_REQUESTED', 'CANCEL_APPROVED', 'SELLER')).toEqual({
      outcome: 'allowed',
      rule: { to: 'CANCEL_APPROVED', actors: ['SELLER', 'ADMIN', 'SYSTEM'] },
    })
  })
})

// ---------------------------------------------------------------------------
// 3절. 표가 지켜야 할 성질
// ---------------------------------------------------------------------------

/** 종착 셋. **손으로 적은 목록**이고, 아래에서 표에서 파생시킨 것과 맞춰 본다. */
const TERMINAL: readonly ClaimStatus[] = ['CANCEL_REJECTED', 'RETURN_REJECTED', 'REFUNDED']

/**
 * 두 경로의 상태를 **손으로** 갈라 적는다.
 *
 * 표에서 파생시키면(예: 이름이 `CANCEL_` 로 시작하는 것) 이름과 소속이 어긋나는
 * 경우를 영영 못 잡고, 무엇보다 `PICKING_UP`·`INSPECTING` 처럼 이름에 경로가
 * 없는 상태는 파생시킬 근거가 아예 없다. `REFUNDED` 는 둘 중 어디에도 없다 —
 * 두 경로가 만나는 유일한 자리이고, 그것이 이 목록들이 말하려는 전부다.
 */
const CANCEL_PATH: readonly ClaimStatus[] = [
  'CANCEL_REQUESTED',
  'CANCEL_APPROVED',
  'CANCEL_REJECTED',
]

const RETURN_PATH: readonly ClaimStatus[] = [
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  'PICKING_UP',
  'INSPECTING',
  'RETURN_COMPLETED',
  'RETURN_REJECTED',
]

describe('신청한 사람은 자기 클레임을 승인하지 못한다', () => {
  it('never names BUYER on any arrow', () => {
    // **이 표에서 가장 중요한 성질이다.** 구매자가 하는 일은 신청(생성)이고 그
    // 뒤는 파는 쪽의 판단이다. `BUYER` 가 한 칸이라도 들어오면 신청과 승인이 같은
    // 사람 손에서 일어나고, 그 클레임의 이력은 아무것도 증명하지 못한다 — 환불이
    // 정당했는지 물을 곳이 없어진다.
    for (const [from, rule] of tableRules()) {
      expect(rule.actors, move(from, rule.to)).not.toContain('BUYER')
    }
  })

  it('refuses the buyer on every defined move, for both paths', () => {
    // 위 검사의 반대편. 표를 읽는 것과 실제로 물어보는 것을 둘 다 한다.
    for (const [from, rule] of tableRules()) {
      expect(refusalOf(claimTransitionDecision(from, rule.to, 'BUYER')), move(from, rule.to)).toBe(
        'actor_forbidden',
      )
    }
  })
})

describe('환불은 SYSTEM 뿐이다', () => {
  it('leaves both roads into REFUNDED to SYSTEM alone', () => {
    // 사람이 「환불됨」을 누르는 화면은 없다. 그것은 돈이 실제로 나갔다는 사실의
    // 결과이고, 그 사실을 아는 것은 결제 쪽이다 (TASK-0068). 여기에 사람을
    // 하나라도 넣으면 **돈이 나가지 않은 클레임이 환불됨으로 앉는다.**
    const roads = tableRules().filter(([, rule]) => rule.to === 'REFUNDED')

    expect(roads.map(([from]) => from)).toEqual(['CANCEL_APPROVED', 'RETURN_COMPLETED'])

    for (const [from, rule] of roads) {
      expect(rule.actors, move(from, rule.to)).toEqual(['SYSTEM'])
    }
  })

  it('refuses everyone else on both of them', () => {
    for (const from of ['CANCEL_APPROVED', 'RETURN_COMPLETED'] as const) {
      for (const actor of sellerOrderActors) {
        const expected = actor === 'SYSTEM' ? null : 'actor_forbidden'

        expect(refusalOf(claimTransitionDecision(from, 'REFUNDED', actor)), actor).toBe(expected)
      }
    }
  })
})

describe('종착 셋에서는 아무 데도 못 간다', () => {
  it('agrees with the hand written list of terminal statuses', () => {
    const derived = claimStatuses.filter((status) => claimTransitions[status].length === 0)

    expect([...derived].sort()).toEqual([...TERMINAL].sort())
  })

  it('refuses every move out of a terminal status, for every actor', () => {
    // 매트릭스가 이미 덮는 칸이지만 따로 적는다. 이것이 깨졌을 때 알아야 할 사실은
    // 「어떤 칸이 샜다」가 아니라 **「끝난 클레임이 다시 움직인다」**이고 — 거절된
    // 반품이 되살아나 환불로 가거나, 환불된 건이 한 번 더 환불된다 — 그 문장이
    // 실패 목록에 그대로 뜨는 편이 낫다.
    for (const from of TERMINAL) {
      for (const to of claimStatuses) {
        for (const actor of sellerOrderActors) {
          expect(
            refusalOf(claimTransitionDecision(from, to, actor)),
            `${move(from, to)} (${actor})`,
          ).toBe('undefined_transition')
        }
      }
    }
  })
})

describe('두 경로가 섞이지 않는다', () => {
  it('accounts for every status exactly once, with REFUNDED shared', () => {
    // 손으로 적은 두 목록이 낡으면 아래 교차 검사가 조용히 좁아진다 — 빠진 상태는
    // 어느 쪽 집합에도 없어 한 번도 대조되지 않는다.
    expect([...CANCEL_PATH, ...RETURN_PATH, 'REFUNDED'].sort()).toEqual([...claimStatuses].sort())
  })

  it('draws no arrow from one path to the other, in either direction', () => {
    // 섞이면 배송된 물건이 취소 경로로 흘러 **회수도 검수도 없이 환불된다.** 열거형
    // 하나에 두 경로를 담은 대가가 정확히 이것이고, 그것을 막는 것은 표뿐이다.
    for (const [left, right] of [
      [CANCEL_PATH, RETURN_PATH],
      [RETURN_PATH, CANCEL_PATH],
    ] as const) {
      for (const from of left) {
        for (const to of right) {
          for (const actor of sellerOrderActors) {
            expect(
              claimTransitionDecision(from, to, actor),
              `${move(from, to)} (${actor})`,
            ).toEqual({ outcome: 'refused', reason: 'undefined_transition' })
          }
        }
      }
    }
  })
})

describe('규칙 하나하나가 성립한다', () => {
  it('gives every rule at least one actor', () => {
    // 주체가 빈 규칙은 「정의됐지만 아무도 못 하는」 전이다. 표에 있으면 화면은 그
    // 전이를 그리고 서버는 언제나 거절하므로, 눌리지 않는 버튼이 생긴다.
    for (const [from, rule] of tableRules()) {
      expect(rule.actors.length, move(from, rule.to)).toBeGreaterThan(0)
    }
  })

  it('defines each destination once per state', () => {
    // 같은 목적지가 두 줄이면 `claimRuleFor` 가 앞의 것만 돌려주고 뒤의 것은 아무도
    // 모르게 죽는다. 주체가 다른 두 줄이면 특히 조용하다 — `INSPECTING` 에서
    // `RETURN_REJECTED` 로 가는 줄이 그런 모양이 되기 쉽다.
    for (const from of claimStatuses) {
      const destinations = claimTransitions[from].map((rule) => rule.to)

      expect(new Set(destinations).size, from).toBe(destinations.length)
    }
  })
})

// ---------------------------------------------------------------------------
// 4절. 주문 상태가 정하는 경로
// ---------------------------------------------------------------------------

describe('경로는 주문 상태가 정한다 (F3)', () => {
  it('sorts every order status into cancel, return, or nothing', () => {
    // **아홉 개를 전부 적는다.** 이 표는 4장의 첫 불릿과 TASK 4장의 표에서 손으로
    // 옮겨 온 것이라 파생시킬 곳이 없고, 그래서 「나머지 전부」를 `null` 로 뭉뚱그리는
    // 대신 상태마다 한 줄씩 적었다 — 주문 상태가 늘면 타입이 아니라 이 목록이 먼저
    // 어긋나야 한다.
    const routes = Object.fromEntries(
      orderStatuses.map((status) => [status, claimRouteFor(status)]),
    )

    expect(routes).toEqual({
      PAYMENT_PENDING: null,
      PAYMENT_FAILED: null,
      PAID: 'CANCEL',
      PREPARING: 'CANCEL',
      SHIPPED: null,
      DELIVERED: 'RETURN',
      CONFIRMED: null,
      CANCELED: null,
      RETURNED: null,
    })
  })

  it('gives the buyer nothing at all while the goods are in transit (F4)', () => {
    // **따로 못 박는다.** `SHIPPED` 가 `CANCEL` 로 새면 이미 떠난 물건이 취소되어
    // 재고가 두 번 늘고, `RETURN` 으로 새면 도착하지도 않은 물건의 회수가 시작된다.
    // 둘 다 정상적으로 보이는 화면을 만든다.
    expect(claimRouteFor('SHIPPED')).toBeNull()
  })

  it('leaves exactly three statuses with a route', () => {
    // 위 표가 통째로 틀리는 경우 — 예를 들어 전부 `null` 이 되는 경우 — 를 세는 것으로
    // 한 번 더 본다.
    const routed = orderStatuses.filter((status) => claimRouteFor(status) !== null)

    expect(routed).toEqual(['PAID', 'PREPARING', 'DELIVERED'])
  })
})

// ---------------------------------------------------------------------------
// 5절. 신청을 받아도 되는가
// ---------------------------------------------------------------------------

/** 배송완료로 선언된 순간. 반품 기간은 여기서 잰다. */
const DELIVERED_AT = new Date('2026-09-01T00:00:00.000Z')

/** 배송완료 D+7 (R2). 구매확정 기간과 같은 축을 쓴다. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function after(ms: number): Date {
  return new Date(DELIVERED_AT.getTime() + ms)
}

/** 기간 안에 도착해 두 개 중 하나를 반품하려는, 아무 문제 없는 신청. */
function check(overrides: Partial<ClaimRequestCheck> = {}): ClaimRequestCheck {
  return {
    orderStatus: 'DELIVERED',
    deliveredAt: DELIVERED_AT,
    now: after(60_000),
    windowMs: WINDOW_MS,
    requested: 1,
    remaining: 2,
    ...overrides,
  }
}

/** 거절 이유, 통과했으면 `null`. */
function reasonOf(eligibility: ClaimEligibility): ClaimRefusal | null {
  return eligibility.outcome === 'refused' ? eligibility.reason : null
}

describe('거절 여섯이 각각 도달한다', () => {
  it('refuses a claim while the goods are in transit (F4)', () => {
    expect(claimEligibility(check({ orderStatus: 'SHIPPED' }))).toEqual({
      outcome: 'refused',
      reason: 'in_transit',
      remaining: 2,
    })
  })

  it('refuses a return once the buyer confirmed the purchase (F5)', () => {
    // 일반 반품은 끝났고 관리자 개입만 남는다. 다른 이유로 답하면 사람은 관리자를
    // 찾아가지 않는다.
    expect(reasonOf(claimEligibility(check({ orderStatus: 'CONFIRMED' })))).toBe('confirmed')
  })

  it('refuses a return after the window closed (F6)', () => {
    expect(reasonOf(claimEligibility(check({ now: after(WINDOW_MS + 1) })))).toBe('window_closed')
  })

  it('refuses a claim on an order that never had one', () => {
    // 결제 전이거나 이미 끝난 주문이다. 네 개를 전부 돌리는 이유는 `claimRouteFor`
    // 의 「나머지 전부」가 여기서 답이 되기 때문이다.
    for (const orderStatus of [
      'PAYMENT_PENDING',
      'PAYMENT_FAILED',
      'CANCELED',
      'RETURNED',
    ] as const) {
      expect(reasonOf(claimEligibility(check({ orderStatus }))), orderStatus).toBe('not_claimable')
    }
  })

  it('refuses a quantity of zero or less', () => {
    for (const requested of [0, -1]) {
      expect(reasonOf(claimEligibility(check({ requested }))), `${requested}개`).toBe(
        'invalid_quantity',
      )
    }
  })

  it('refuses more than what is left, and says how much that is (F2 · F8)', () => {
    // `remaining` 을 함께 답하는 것이 F2 의 「잔여 수량 안내」다. 이유만 돌려주면
    // 화면은 「몇 개까지 되는지」를 물어볼 곳이 없어 다시 부르게 된다.
    expect(claimEligibility(check({ requested: 3, remaining: 2 }))).toEqual({
      outcome: 'refused',
      reason: 'exceeds_remaining',
      remaining: 2,
    })
  })

  it('echoes the remaining quantity on every refusal, not just that one', () => {
    // 화면이 이유마다 다른 모양을 받으면 결국 이유로 분기하게 된다.
    const refusals: readonly ClaimRequestCheck[] = [
      check({ orderStatus: 'SHIPPED' }),
      check({ orderStatus: 'CONFIRMED' }),
      check({ orderStatus: 'CANCELED' }),
      check({ now: after(WINDOW_MS + 1) }),
      check({ requested: 0 }),
      check({ requested: 9 }),
    ]

    for (const input of refusals) {
      expect(claimEligibility(input)).toMatchObject({ outcome: 'refused', remaining: 2 })
    }
  })
})

/**
 * 거절 이유의 **순서**.
 *
 * 여러 조건이 동시에 어긋난 입력에 어떤 답이 오는지가 이 절의 전부다. 이 이유는
 * 그대로 사용자에게 보여 줄 문장이 되므로, 순서는 문구의 문제가 아니라 **사람이
 * 다음에 무엇을 하느냐**의 문제다.
 */
describe('거절 이유는 앞의 것부터 나온다', () => {
  it('names the transit before the quantity', () => {
    // 배송 중인 주문에 「수량이 모자랍니다」라고 답하면 사람은 수량을 고쳐 다시
    // 시도한다. 몇 개를 적어도 그 주문은 지금 아무것도 할 수 없다.
    expect(
      reasonOf(claimEligibility(check({ orderStatus: 'SHIPPED', requested: 9, remaining: 0 }))),
    ).toBe('in_transit')
  })

  it('names the confirmation before the window', () => {
    // 확정한 주문에 「기간이 지났습니다」는 반쯤 맞는 말이라 더 나쁘다 — 기다렸으면
    // 됐다는 뜻으로 읽힌다. 실제로는 기다린 것이 문제가 아니라 확정을 눌렀기
    // 때문이고, 남은 길은 관리자 개입뿐이다.
    expect(
      reasonOf(
        claimEligibility(
          check({
            orderStatus: 'CONFIRMED',
            now: after(WINDOW_MS * 10),
            requested: 9,
            remaining: 0,
          }),
        ),
      ),
    ).toBe('confirmed')
  })

  it('names the window before the quantity', () => {
    // 기간이 닫힌 반품에 수량을 따지면, 수량을 고쳐 다시 시도하게 된다.
    expect(reasonOf(claimEligibility(check({ now: after(WINDOW_MS + 1), requested: 9 })))).toBe(
      'window_closed',
    )
    expect(reasonOf(claimEligibility(check({ now: after(WINDOW_MS + 1), requested: 0 })))).toBe(
      'window_closed',
    )
  })

  it('refuses a zero quantity even when nothing is left', () => {
    // 두 수량 검사의 순서가 여기서 드러난다. 뒤집으면 `0 > 0` 이 거짓이라 **0개
    // 신청이 그대로 통과한다** — 아무것도 반품하지 않는 클레임이 생기고, 그 뒤의
    // 환불 안분은 0원짜리 환불을 만든다.
    expect(reasonOf(claimEligibility(check({ requested: 0, remaining: 0 })))).toBe(
      'invalid_quantity',
    )
  })

  it('advances the answer exactly one step for each fault repaired', () => {
    // 순서가 있다는 것을 「하나씩 고치면 답이 하나씩 나아간다」로 본다. 어느 두 검사가
    // 뒤바뀌어도 이 사다리의 한 칸이 무너진다.
    const broken = {
      orderStatus: 'SHIPPED',
      now: after(WINDOW_MS + 1),
      requested: 0,
      remaining: 0,
    } as const

    expect(reasonOf(claimEligibility(check(broken)))).toBe('in_transit')
    expect(reasonOf(claimEligibility(check({ ...broken, orderStatus: 'CONFIRMED' })))).toBe(
      'confirmed',
    )
    expect(reasonOf(claimEligibility(check({ ...broken, orderStatus: 'DELIVERED' })))).toBe(
      'window_closed',
    )
    expect(
      reasonOf(claimEligibility(check({ ...broken, orderStatus: 'DELIVERED', now: after(0) }))),
    ).toBe('invalid_quantity')
    expect(
      reasonOf(
        claimEligibility(
          check({ ...broken, orderStatus: 'DELIVERED', now: after(0), requested: 1 }),
        ),
      ),
    ).toBe('exceeds_remaining')
    expect(
      reasonOf(
        claimEligibility(
          check({ ...broken, orderStatus: 'DELIVERED', now: after(0), requested: 1, remaining: 1 }),
        ),
      ),
    ).toBeNull()
  })
})

describe('반품 기간의 경계', () => {
  it('accepts the claim at the very last millisecond', () => {
    // 정확히 `windowMs` 인 순간은 **아직 기간 안**이다. 여기가 한 칸 어긋나면 D+7
    // 정각에 신청한 사람이 거절당하고, 그 사람은 왜인지 알 방법이 없다.
    expect(claimEligibility(check({ now: after(WINDOW_MS) }))).toEqual({
      outcome: 'allowed',
      type: 'RETURN',
    })
  })

  it('refuses the claim one millisecond later', () => {
    expect(reasonOf(claimEligibility(check({ now: after(WINDOW_MS + 1) })))).toBe('window_closed')
  })

  it('accepts a claim filed the instant the parcel arrived', () => {
    expect(reasonOf(claimEligibility(check({ now: after(0) })))).toBeNull()
  })

  it('treats a DELIVERED order with no deliveredAt as out of window', () => {
    // 구현이 고른 답이다. 상태를 옮기는 문이 이력을 함께 쓰므로(TASK-0059) 이런
    // 주문은 있을 수 없지만, 부르는 쪽은 그것을 증명할 수 없다. 그때 「아직 기간이
    // 남았다」고 답할 근거가 우리에게 없다 — 언제 도착했는지 모르는 물건이다.
    expect(reasonOf(claimEligibility(check({ deliveredAt: null, now: after(0) })))).toBe(
      'window_closed',
    )
    expect(reasonOf(claimEligibility(check({ deliveredAt: null, now: DELIVERED_AT })))).toBe(
      'window_closed',
    )
  })

  it('never asks about the window on the cancel path', () => {
    // 취소는 물건이 아직 떠나지 않은 상태라 기다릴 것이 없다. 여기에 기간이 걸리면
    // **결제한 지 오래된 주문을 취소할 수 없게 된다** — 판매자가 준비를 늦게 하는
    // 것이 구매자의 취소 권리를 지우는 모양이다.
    for (const orderStatus of ['PAID', 'PREPARING'] as const) {
      expect(
        claimEligibility(check({ orderStatus, deliveredAt: null, now: after(WINDOW_MS * 100) })),
        orderStatus,
      ).toEqual({ outcome: 'allowed', type: 'CANCEL' })
    }
  })
})

describe('통과하면 경로를 함께 답한다 (F1 · F3)', () => {
  it('answers the same type claimRouteFor would', () => {
    // 판정과 경로가 갈리면 취소 신청이 반품으로 만들어진다 — 회수 단계가 붙고,
    // 아무도 보내지 않은 물건을 기다리는 클레임이 생긴다.
    for (const orderStatus of ['PAID', 'PREPARING', 'DELIVERED'] as const) {
      expect(claimEligibility(check({ orderStatus })), orderStatus).toEqual({
        outcome: 'allowed',
        type: claimRouteFor(orderStatus),
      })
    }
  })

  it('allows a partial claim — one of the two that remain (F1)', () => {
    expect(claimEligibility(check({ requested: 1, remaining: 2 }))).toMatchObject({
      outcome: 'allowed',
    })
  })

  it('allows a claim for exactly everything that is left', () => {
    // 경계다. 남은 만큼은 되고 한 개 더는 안 된다.
    expect(reasonOf(claimEligibility(check({ requested: 2, remaining: 2 })))).toBeNull()
    expect(reasonOf(claimEligibility(check({ requested: 3, remaining: 2 })))).toBe(
      'exceeds_remaining',
    )
  })
})

// ---------------------------------------------------------------------------
// 6절. 남은 수량
// ---------------------------------------------------------------------------

describe('잔여 수량 (F8)', () => {
  it('subtracts what live claims are holding', () => {
    expect(remainingQuantity(3, 0)).toBe(3)
    expect(remainingQuantity(3, 1)).toBe(2)
  })

  it('lands on zero when everything is claimed', () => {
    expect(remainingQuantity(3, 3)).toBe(0)
    expect(remainingQuantity(0, 0)).toBe(0)
  })

  it('never answers a negative number, however over claimed the row is', () => {
    // **넘겨 신청된 데이터가 실제로 들어온다.** 잠금 없이 동시에 두 신청이 통과한
    // 흔적(R1)이거나, 항목 수량을 나중에 줄인 주문이다. 그때 음수를 돌려주면 화면은
    // 「-1개 남았습니다」를 그리고, 이 값을 상한으로 쓰는 쪽은 어떤 신청도 받지
    // 못하게 된다 — 원인은 여기가 아니라 저기서 찾게 된다.
    expect(remainingQuantity(2, 3)).toBe(0)
    expect(remainingQuantity(0, 5)).toBe(0)
  })

  it('closes the door on an over claimed item through claimEligibility', () => {
    // 두 함수를 잇는다. 잔여가 0이면 어떤 양수 신청도 `exceeds_remaining` 이고, 그
    // 답에 실리는 잔여도 0이다.
    const remaining = remainingQuantity(2, 3)

    expect(claimEligibility(check({ requested: 1, remaining }))).toEqual({
      outcome: 'refused',
      reason: 'exceeds_remaining',
      remaining: 0,
    })
  })
})
