import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { SCHEDULERS } from '../../src/dashboard/scheduler-registry.js'
import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * 대시보드가 **모든** 배치를 지켜보는가 (TASK-0092 F4).
 *
 * 배치를 하나 더 만들고 목록에 안 적으면 아무것도 빨개지지 않는다 — 화면은 멀쩡히
 * 그려지고 그 배치만 **아무도 안 보는** 상태가 된다. 그리고 그것이 정확히 이 화면이
 * 막으려던 일이다: 「하나가 멈추면 조용히 문제가 쌓인다」(TASK-0092 4장).
 *
 * 그래서 소스를 읽어 센다. 손으로 옮겨 적은 목록을 여기 한 벌 더 두면 어긋날 수 있는
 * 자리가 둘에서 셋이 될 뿐이다 (`notification-catalogue-parity.spec.ts` 와 같은 장치).
 */

/** `export const X_LAST_RUN_KEY = 'a.b.lastRunAt'` 이 선언한 열쇠들. */
function declaredKeys(): readonly string[] {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const found = execFileSync(
    'grep',
    ['-rhoP', "_LAST_RUN_KEY = '\\K[^']+", `${root}/apps/api/src`, '--include=*.ts'],
    { encoding: 'utf8' },
  )

  return [...new Set(found.split('\n').filter((line) => line !== ''))].sort()
}

describe('배치 목록 (dashboard/scheduler-registry.ts)', () => {
  it('watches every scheduler that records a last run', () => {
    expect(SCHEDULERS.map((entry) => entry.key).sort()).toEqual(declaredKeys())
  })

  it('actually found the declarations it claims to read', () => {
    // 못 찾으면 조용히 빈 배열이 되고, 위 검사는 「목록이 비어 있다」로 실패해 원인을
    // 엉뚱한 곳으로 가리킨다.
    expect(declaredKeys().length).toBeGreaterThan(0)
  })

  it('gives every scheduler a bound its own module declared', () => {
    // 0이나 음수는 「언제나 stale」이라는 뜻이고, 그것은 임계치를 안 정한 것과 같다.
    for (const entry of SCHEDULERS) expect(entry.staleAfterMs).toBeGreaterThan(0)
  })
})
