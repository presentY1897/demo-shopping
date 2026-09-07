import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * 관리자의 거래액은 **모든 판매자 매출의 합**이어야 한다 (TASK-0092 F1).
 *
 * 두 화면이 「팔린 것」을 다르게 세면 그 합이 안 맞는다. 그리고 그 어긋남은 두 화면을
 * 나란히 놓고 더해 보기 전까지 아무도 모른다 — 판매자는 자기 수만 보고, 관리자는
 * 전체 수만 본다.
 *
 * 목록을 공용 모듈로 빼지 않은 이유는 **두 곳이 같아야 할 이유가 우연이 아니기**
 * 때문이다: 같은 질문(「이 기간에 얼마 팔렸나」)에 답하므로 같아야 하고, 다른 질문이
 * 생기면 갈라져야 한다. 공용 상수로 묶으면 갈라져야 할 날 한쪽을 고치는 사람이 다른
 * 쪽까지 조용히 바꾼다. 그래서 **묶지 않고 견준다.**
 */

const FILES = {
  seller: 'apps/api/src/settlement/seller-revenue.service.ts',
  admin: 'apps/api/src/dashboard/dashboard.service.ts',
}

function soldStatusesIn(relativePath: string): readonly string[] {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const text = readFileSync(join(root, relativePath), 'utf8')
  const match = /const SOLD_STATUSES = \[(?<list>[^\]]*)\]/u.exec(text)

  if (match?.groups?.list === undefined) {
    throw new Error(`SOLD_STATUSES 를 찾지 못했습니다: ${relativePath}`)
  }

  return [...match.groups.list.matchAll(/'(?<name>[A-Z_]+)'/gu)].map(
    (entry) => entry.groups?.name ?? '',
  )
}

describe('매출로 세는 상태', () => {
  it('is the same list on both dashboards', () => {
    expect(soldStatusesIn(FILES.admin)).toEqual(soldStatusesIn(FILES.seller))
  })

  /**
   * `RETURNED` 가 들어 있는 것이 이 목록의 판단이다 — 팔린 적이 있는 것이고, 그
   * 되돌림은 정산의 차감으로 따로 나타난다. 빼면 「지난달에 얼마 팔았나」의 답이
   * 반품이 들어올 때마다 **과거로 거슬러** 바뀐다.
   */
  it('counts a returned order as a sale that happened', () => {
    expect(soldStatusesIn(FILES.admin)).toContain('RETURNED')
  })

  it('leaves out what was never paid for', () => {
    for (const never of ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELED']) {
      expect(soldStatusesIn(FILES.admin)).not.toContain(never)
    }
  })
})
