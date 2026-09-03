// Regenerates `docs/design/permission-matrix.md` from the role→permission table.
//
//   pnpm --filter @shopping/api docs:matrix
//
// The document is an artefact, never edited by hand. A permission table written
// twice — once as code and once as prose — is wrong within a week, and a stale
// permission table is worse than none because people still trust it. CI enforces
// the equality from the other side: `src/auth/permission-matrix.spec.ts` fails
// when the committed file and the code disagree.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// `@shopping/shared` is CommonJS; a default import is the one form that works
// regardless of how well the named exports are detected from an ESM script.
import shared from '@shopping/shared'

const repoRoot = dirname(dirname(dirname(import.meta.dirname)))
const target = join(repoRoot, 'docs', 'design', 'permission-matrix.md')

writeFileSync(target, shared.renderPermissionMatrix(), 'utf8')

console.log(`권한 매트릭스를 갱신했습니다: ${target}`)
