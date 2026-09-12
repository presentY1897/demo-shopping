import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * 시간을 재는 검사는 커버리지 실행에서 **빠져 있어야 한다** (D-223).
 *
 * 그 사실이 두 파일에 적혀 있고 서로를 읽지 못한다. `package.json` 의
 * `test:coverage` 가 로컬에서 쓰는 명령이고, CI 의 샤드는 같은 제외를 직접 적는다 —
 * pnpm 이 `run` 으로 넘기는 인자의 `=` 를 뭉개서 샤드 플래그를 스크립트에 실어
 * 보낼 수 없기 때문이다.
 *
 * **갈라지면 조용하다.** CI 에서만 빠지고 로컬 `test:coverage` 에는 남으면 개발자가
 * 재현할 수 없는 실패를 보고, 반대면 CI 의 샤드가 계측 아래에서 벽시계를 재다가
 * 아무 결함 없이 빨개진다 — 실제로 그것 때문에 두 번 빨개졌다.
 *
 * 파일을 읽는 모양이 맞는 이유는 `postgres-image-parity.spec.ts` 와 같다: 파일
 * 자체가 대상이다.
 */

/** 두 곳이 같아야 하는 그 문자열. 여기 적힌 것이 세 번째 사본은 아니다 — 아래 두 단언이 이것을 **두 파일에서 찾아** 견준다. */
const PERF_GLOB = "'**/*-performance.spec.ts'"

function read(relativePath: string): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  return readFileSync(join(root, relativePath), 'utf8')
}

describe('시간을 재는 검사는 커버리지 실행에서 빠진다', () => {
  it('로컬 `test:coverage` 가 그것들을 제외한다', () => {
    const scripts = JSON.parse(read('apps/api/package.json')) as {
      scripts: Record<string, string>
    }

    expect(scripts.scripts['test:coverage']).toContain(`--exclude ${PERF_GLOB}`)
  })

  it('CI 의 샤드도 같은 글롭으로 제외한다', () => {
    const workflow = read('.github/workflows/ci.yml')

    expect(workflow).toContain(`--exclude ${PERF_GLOB}`)
  })

  /**
   * 그리고 **어딘가에서는 돌아야 한다.** 제외만 남고 실행이 사라지면 A1 은
   * 아무도 재지 않는 게이트가 되고, 그 상태는 초록으로 보인다.
   */
  it('전용 명령이 그것들을 실제로 돌린다', () => {
    const scripts = JSON.parse(read('apps/api/package.json')) as {
      scripts: Record<string, string>
    }
    const perf = scripts.scripts['test:perf'] ?? ''

    // 파일 이름의 조각이다. 앞에 `-` 를 붙이면 vitest 의 인자 파서가 그것을
    // 플래그로 읽는다.
    expect(perf).toContain('performance.spec.ts')
    // 워커 하나. 지연을 재는 동안 같은 러너에서 다른 파일이 코어를 다투면 재는
    // 값이 그 경합이 된다.
    expect(perf).toContain('--maxWorkers=1')
    expect(perf).toContain('VITEST_MAX_WORKERS=1')
    expect(read('.github/workflows/ci.yml')).toContain('run test:perf')
  })
})
