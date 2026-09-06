import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * The postgres image tag is written in two files that cannot read each other:
 * `docker-compose.yml` brings the local container up, and a GitHub Actions
 * workflow cannot interpolate a value out of a compose file into `services:`.
 *
 * A minor version drift between them is the worst kind of failure — everything
 * passes locally and CI breaks on something that has nothing to do with the
 * change. So the two strings are compared here.
 *
 * Reading files is the right shape for this one: the files *are* the subject,
 * exactly as in `src/prisma/schema-guards.spec.ts` where the migration is the
 * deployed artefact. It is not a stand-in for asking a running system, which is
 * what the constraint checks used to be and no longer are.
 */

function repoRoot(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')
  return root
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot(), relativePath), 'utf8')
}

/** Every `image: postgres:<tag>` in a file, in order of appearance. */
function postgresImages(source: string): string[] {
  return [...source.matchAll(/image:\s*(postgres:[\w.-]+)/g)].map((match) => match[1] ?? '')
}

describe('postgres image tag', () => {
  it('is declared once locally and at least once in the workflow', () => {
    expect(postgresImages(read('docker-compose.yml'))).toHaveLength(1)
    // 워크플로에는 여럿이다. 데이터베이스를 쓰는 job 마다 자기 서비스를 세우고
    // (샤드 셋과 시간을 재는 job 하나 — D-223), 그중 하나라도 다른 태그를 쓰면
    // 「로컬에서는 되는데 CI 에서만 깨진다」가 된다. 개수를 못 박는 대신 **전부**를
    // 견주는 이유가 그것이다.
    expect(postgresImages(read('.github/workflows/ci.yml')).length).toBeGreaterThan(0)
  })

  it('is the same in docker-compose.yml and in every CI service', () => {
    const [compose] = postgresImages(read('docker-compose.yml'))
    const workflow = postgresImages(read('.github/workflows/ci.yml'))

    expect(new Set(workflow)).toEqual(new Set([compose]))
  })

  it('is pinned to a patch version, not to a moving tag', () => {
    // `postgres:17` or `postgres:latest` would let the two files agree today and
    // still run different servers tomorrow.
    const [compose] = postgresImages(read('docker-compose.yml'))

    expect(compose).toMatch(/^postgres:\d+\.\d+-\w+$/)
  })
})
