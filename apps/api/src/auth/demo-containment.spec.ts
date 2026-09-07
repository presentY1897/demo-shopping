import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

/**
 * Gate F8 of TASK-0105: `isDemo` does not spread into the business logic.
 *
 * The demo restriction is meant to be one value in the permission table — the
 * `demo` scope — not a condition every service remembers to write. The moment a
 * service starts asking whether an account is a demo, that promise is broken and
 * the next service to forget the question has a hole in it.
 *
 * So the column is readable from exactly one place per package: the mapper that
 * turns a row into `ResourceOwnership`, and the scope check that consumes it.
 * Anything else naming it fails here. A task that genuinely needs the flag —
 * issuing demo accounts (TASK-0024), sweeping expired ones (TASK-0025) — adds
 * its file to the list below in the same commit, which is the review this exists
 * to force.
 */

// Case insensitive so that `ownerIsDemo` — the same vocabulary one level up —
// counts as naming the flag too.
const MENTIONS_DEMO_FLAG = /isdemo/i

const ALLOWED = [
  // The one mapper: a row in, ownership out.
  'apps/api/src/auth/resource-ownership.ts',
  // The vocabulary itself, and the scope that reads it.
  'packages/shared/src/auth/resource-scope.ts',
  'packages/shared/src/auth/authorize.ts',
  // TASK-0024, and the review this list exists to force. Issuing an account is
  // the one thing that has to *write* the flag, and `User_demo_expiry_check`
  // means it must be written together with the expiry — so the pair lives in one
  // function whose whole job is that INSERT.
  //
  // Nothing else in that task names it. The rate limit counts
  // `demoExpiresAt IS NOT NULL`, the status endpoint answers with the expiry,
  // and the browser is never told the boolean exists — the two columns imply
  // each other, so reading the one that a screen actually needs costs nothing
  // and keeps this list one entry long (TASK-0024 4.5).
  'apps/api/src/demo/demo-account.ts',
  // TASK-0025, and the same review. The sweep has to *find* demo accounts, and
  // `isDemo` is the guard that keeps a real one out of a `deleteMany` — R1 names
  // "삭제 범위 오류로 공용 데이터 손실" as the risk and asks that every statement
  // carry it. Reading the flag here is the point, not an oversight.
  //
  // Nothing else in that task names it: the plan is a list of tables, the health
  // reporter reads a timestamp, and the force-expiry endpoint narrows by id.
  'apps/api/src/demo/demo-cleanup.service.ts',
  // M14, and the same review. 관리자 콘솔에서 데모는 **판정 조건이 아니라 주제**다 —
  // 「데모 계정만 보기」(TASK-0093), 「데모 스토어 구분 표시」(TASK-0094 F7),
  // 「데모 계정 현황」(TASK-0092 · TASK-0096)이 화면이 답해야 할 질문 자체이고,
  // 그것을 스코프로는 물어볼 수 없다. 스코프는 「이 사람이 이 행을 만져도 되는가」에
  // 답하지 「이 행이 데모인가」에 답하지 않는다.
  //
  // **권한 판정은 이 파일들에 없다.** 상품 강제 숨김의 데모 제한은 매퍼를 지난다
  // (`admin-catalog.service.ts` 의 `accountOwnershipSelect`) — 그래서 그 파일은
  // 이 목록에 없다. 여기 있는 넷은 전부 읽어서 **보여 주기만** 한다.
  'apps/api/src/admin/admin-user.service.ts',
  'apps/api/src/admin/admin-user.controller.ts',
  'apps/api/src/admin/admin-seller.service.ts',
  'apps/api/src/dashboard/dashboard.service.ts',
  'apps/api/src/admin/admin-demo.service.ts',
  'apps/api/src/admin/admin-console.controller.ts',
  // 계약도 같은 이유다. 「데모 여부」가 목록의 **필터이자 표시 항목**이므로 질의와
  // 응답의 모양에 이름이 나온다 — 화면이 물어볼 수 있어야 하는 것을 계약이 숨기면
  // 화면은 그 질문을 못 한다.
  'packages/shared/src/api/admin-users.ts',
  'packages/shared/src/api/admin-console.ts',
] as const

const SCANNED = ['apps/api/src', 'packages/shared/src'] as const

function repoRoot(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  return root
}

/** Repository-relative paths of every non-test TypeScript file in `dir`. */
function sourceFiles(root: string, dir: string): readonly string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'),
    )
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

function filesMentioningTheDemoFlag(): readonly string[] {
  const root = repoRoot()

  return SCANNED.flatMap((dir) => sourceFiles(root, dir)).filter((file) =>
    MENTIONS_DEMO_FLAG.test(readFileSync(join(root, file), 'utf8')),
  )
}

describe('demo handling stays inside the permission layer', () => {
  it('names the demo flag nowhere outside the authorization layer', () => {
    const offenders = filesMentioningTheDemoFlag().filter(
      (file) => !(ALLOWED as readonly string[]).includes(file),
    )

    expect(offenders).toEqual([])
  })

  it('keeps the allow list honest', () => {
    // An entry that no longer mentions the flag is one nobody will notice has
    // become a licence to reintroduce the branch anywhere.
    expect([...filesMentioningTheDemoFlag()].sort()).toEqual([...ALLOWED].sort())
  })
})
