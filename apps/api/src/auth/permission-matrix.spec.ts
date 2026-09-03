import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { permissions, renderPermissionMatrix, rolePermissions, roles } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

/**
 * Keeps `docs/design/permission-matrix.md` and the code that grants permissions
 * from ever describing different systems.
 *
 * The document is generated (`pnpm --filter @shopping/api docs:matrix`), so the
 * only way it can be wrong is by not being regenerated — which is exactly what
 * this fails on. A permission table nobody can trust is worse than no table,
 * because people still read it before deciding a role is safe.
 */

function matrixPath(): string {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  return join(repoRoot, 'docs', 'design', 'permission-matrix.md')
}

describe('generated permission matrix', () => {
  it('matches the committed document byte for byte', () => {
    expect(readFileSync(matrixPath(), 'utf8')).toBe(renderPermissionMatrix())
  })

  it('lists every permission and every role', () => {
    const rendered = renderPermissionMatrix()

    for (const permission of permissions) expect(rendered).toContain(`\`${permission}\``)
    for (const role of roles) expect(rendered).toContain(role)
  })

  it('shows a role that holds nothing as denied rather than blank', () => {
    // BUYER has no settlement grant at all; the cell has to say so.
    expect(rolePermissions.BUYER.some((entry) => entry.permission === 'settlement.pay')).toBe(false)
    expect(renderPermissionMatrix()).toContain('| `settlement.pay` | — |')
  })
})
