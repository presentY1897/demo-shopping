import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { notificationTypes } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * 설계 문서의 알림 유형 표가 **계약과 같은가** (TASK-0090 D2).
 *
 * 표는 손으로 쓴다. 그래서 유형이 하나 늘거나 이름이 바뀌면 코드는 멀쩡히 돌고
 * 문서만 조용히 틀린다 — 그리고 이 저장소에서 문서는 기준이다(CLAUDE.md 4장).
 * **틀린 기준은 없는 기준보다 나쁘다**: 다음 사람이 그것을 믿고 판단한다.
 *
 * 그래서 문서를 **읽어서** 맞춰 본다. 손으로 옮겨 적은 목록을 여기 한 벌 더 두면
 * 어긋날 수 있는 자리가 둘에서 셋이 될 뿐이다 — `perf-suite-parity.spec.ts` 가
 * 같은 사정을 같은 방식으로 다룬다.
 */

const DOC = 'docs/design/notifications.md'

/** 표의 첫 칸에 백틱으로 적힌 유형들, 적힌 순서 그대로. */
function documented(): readonly string[] {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const text = readFileSync(join(root, DOC), 'utf8')

  return [...text.matchAll(/^\| `([A-Z_]+)` \|/gmu)].map((match) => match[1] ?? '')
}

describe('알림 유형 표 (docs/design/notifications.md)', () => {
  it('lists every type the contract has, and nothing it does not', () => {
    // 순서까지 같아야 한다 — 계약의 순서가 곧 표의 순서이면, 유형이 하나 늘었을 때
    // 「어디에 넣지」를 고민할 자리가 없다.
    expect(documented()).toEqual([...notificationTypes])
  })

  it('actually found the table it claims to read', () => {
    // 표를 못 찾으면 조용히 빈 배열이 된다. 그때 위 검사는 「계약에 유형이 하나도
    // 없다」로 실패해 원인을 엉뚱한 곳으로 가리킨다.
    expect(documented().length).toBeGreaterThan(0)
  })
})
