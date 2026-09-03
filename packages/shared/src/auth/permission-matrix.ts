import type { Permission } from './permissions.js'
import { permissions } from './permissions.js'
import { rolePermissions } from './role-permissions.js'
import type { Role } from './roles.js'
import { roles } from './roles.js'

/** Shown where a role holds no grant at all — deny by default, spelled out. */
const NO_GRANT = '—'

function cell(role: Role, permission: Permission): string {
  const scopes = rolePermissions[role]
    .filter((entry) => entry.permission === permission)
    .map((entry) => `\`${entry.scope}\``)

  return scopes.length > 0 ? scopes.join(' · ') : NO_GRANT
}

function matrixTable(): readonly string[] {
  const header = `| 퍼미션 | ${roles.join(' | ')} |`
  const divider = `| --- | ${roles.map(() => '---').join(' | ')} |`
  const rows = permissions.map(
    (permission) =>
      `| \`${permission}\` | ${roles.map((role) => cell(role, permission)).join(' | ')} |`,
  )

  return [header, divider, ...rows]
}

function roleSummary(role: Role): readonly string[] {
  const grants = rolePermissions[role]
  const list = grants.map((entry) => `\`${entry.permission}:${entry.scope}\``).join(' · ')

  return [`### ${role}`, '', `퍼미션 ${grants.length.toString()}개 — ${list}`, '']
}

/**
 * Renders the authorization table as markdown.
 *
 * The document it produces is a build artefact, not a hand-written page: a table
 * maintained by hand drifts from the code the first time a grant changes, and a
 * drifted permission table is worse than none because it is still believed.
 *
 * `apps/api/scripts/write-permission-matrix.mjs` writes the file and
 * `apps/api/src/auth/permission-matrix.spec.ts` fails when the committed copy
 * and this function disagree, so CI catches the drift instead of a reader.
 */
export function renderPermissionMatrix(): string {
  const lines = [
    '# 역할 × 퍼미션 매트릭스',
    '',
    '> **이 파일은 생성물이다. 직접 수정하지 마라.**',
    '> 출처는 `packages/shared/src/auth/role-permissions.ts` 이고,',
    '> `pnpm --filter @shopping/api docs:matrix` 로 다시 만든다.',
    '> 코드와 어긋나면 `apps/api/src/auth/permission-matrix.spec.ts` 가 CI 에서 실패한다.',
    '',
    '퍼미션은 **무엇을 할 수 있나**만 답한다. **누구 것에** 할 수 있는지는 스코프가 답한다.',
    '',
    '| 스코프 | 의미 |',
    '| --- | --- |',
    '| `own` | 자기가 소유한 리소스만 (판매자 → 자기 스토어, 구매자 → 자기 주문) |',
    '| `demo` | 데모 계정이 만든 리소스만. 시드·실계정 데이터는 조회만 |',
    '| `any` | 전부 |',
    `| ${NO_GRANT} | 권한 없음. **기본 거부** — 표에 없는 조합은 전부 403 |`,
    '',
    '## 매트릭스',
    '',
    ...matrixTable(),
    '',
    '## 역할별 요약',
    '',
    ...roles.flatMap((role) => roleSummary(role)),
    '---',
    '',
    `퍼미션 ${permissions.length.toString()}개 · 역할 ${roles.length.toString()}개.`,
    '`DEMO_ADMIN` 은 `ADMIN_OPERATOR` 에서 파생된다 — 쓰기 권한만 `demo` 로 좁히고 읽기는 그대로 둔다.',
    '',
  ]

  return lines.join('\n')
}
