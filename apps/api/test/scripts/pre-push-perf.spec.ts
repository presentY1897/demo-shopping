import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * The decision inside the `pre-push` hook (`scripts/pre-push-perf.mjs`,
 * TASK-0146 4.3): which pushes take the strict timing measurement and which
 * ones cost nothing.
 *
 * It lives here for the reason `reviewed-production-guard.spec.ts` gives — the
 * gates collect `src` and `test` of this package and nothing at the repository
 * root — and a hook nobody tests is a hook that quietly stops deciding. The two
 * ways it can be wrong are both silent: measuring on every docs push gets it
 * switched off, and not measuring an API push is the regression it exists for.
 *
 * Nothing here runs git, opens a socket or starts a test run. The decision is a
 * function of the environment, the lines git writes to the hook's stdin and a
 * `changedFilesOf` that is injected; the side effects sit in the script's
 * `main()`, which an import does not reach.
 */

interface PushedRef {
  localRef: string
  /** `null` when the push deletes the ref. */
  localSha: string | null
  remoteRef: string
  /** `null` when the remote has never seen the ref. */
  remoteSha: string | null
}

type Decision =
  | { action: 'skip'; reason: 'skip-requested' | 'nothing-pushed' | 'untouched' }
  | { action: 'run'; reason: 'touched'; files: string[] }
  | { action: 'run'; reason: 'unknown-range'; ref: string }

type ChangedFilesOf = (ref: PushedRef) => string[] | null

interface PrePushPerf {
  PERF_SURFACE_DIRECTORIES: readonly string[]
  PERF_SURFACE_FILES: readonly string[]
  parsePushedRefs: (text: string) => PushedRef[]
  touchesPerfSurface: (files: readonly string[]) => boolean
  decide: (input: {
    env: Record<string, string | undefined>
    refs: readonly PushedRef[]
    changedFilesOf: ChangedFilesOf
  }) => Decision
}

/**
 * The subject is ESM and this package compiles to CommonJS, so it is reached by
 * a dynamic `import()` of its URL — and from a hook, because a CommonJS module
 * has no top-level `await`.
 */
async function loadSubject(): Promise<PrePushPerf> {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const url = pathToFileURL(join(repoRoot, 'scripts', 'pre-push-perf.mjs')).href

  return (await import(url)) as PrePushPerf
}

let subject: PrePushPerf

beforeAll(async () => {
  subject = await loadSubject()
})

const ZERO = '0'.repeat(40)
const LOCAL = 'a'.repeat(40)
const REMOTE = 'b'.repeat(40)

function pushedRef(overrides: Partial<PushedRef> = {}): PushedRef {
  return {
    localRef: 'refs/heads/feature/x',
    localSha: LOCAL,
    remoteRef: 'refs/heads/feature/x',
    remoteSha: REMOTE,
    ...overrides,
  }
}

/** A `changedFilesOf` that answers per local ref and fails on one it was not told about. */
function changesByRef(table: ReadonlyMap<string, string[] | null>): ChangedFilesOf {
  return (ref) => {
    const files = table.get(ref.localRef)

    if (files === undefined) throw new Error(`unexpected ref: ${ref.localRef}`)

    return files
  }
}

describe('parsePushedRefs', () => {
  it('reads the four fields git writes for an updated branch', () => {
    expect(
      subject.parsePushedRefs(`refs/heads/feature/x ${LOCAL} refs/heads/feature/x ${REMOTE}\n`),
    ).toEqual([pushedRef()])
  })

  it('reads one ref per line', () => {
    const refs = subject.parsePushedRefs(
      `refs/heads/one ${LOCAL} refs/heads/one ${REMOTE}\n` +
        `refs/tags/v1 ${REMOTE} refs/tags/v1 ${ZERO}\n`,
    )

    expect(refs.map((ref) => ref.localRef)).toEqual(['refs/heads/one', 'refs/tags/v1'])
  })

  it('tolerates blank lines, a missing final newline and CRLF', () => {
    const line = `refs/heads/feature/x ${LOCAL} refs/heads/feature/x ${REMOTE}`

    expect(subject.parsePushedRefs(`\n${line}\n\n`)).toEqual([pushedRef()])
    expect(subject.parsePushedRefs(line)).toEqual([pushedRef()])
    expect(subject.parsePushedRefs(`${line}\r\n`)).toEqual([pushedRef()])
  })

  it('reads nothing from an empty stdin', () => {
    expect(subject.parsePushedRefs('')).toEqual([])
    expect(subject.parsePushedRefs('\n')).toEqual([])
  })

  it('turns the all-zero remote sha of a new branch into null', () => {
    const [ref] = subject.parsePushedRefs(`refs/heads/new ${LOCAL} refs/heads/new ${ZERO}\n`)

    expect(ref).toMatchObject({ localSha: LOCAL, remoteSha: null })
  })

  it('turns the all-zero local sha of a deleted ref into null', () => {
    const [ref] = subject.parsePushedRefs(`(delete) ${ZERO} refs/heads/gone ${REMOTE}\n`)

    expect(ref).toMatchObject({ localSha: null, remoteSha: REMOTE })
  })

  it('knows the zeros of a SHA-256 repository too', () => {
    const [ref] = subject.parsePushedRefs(
      `refs/heads/new ${'c'.repeat(64)} refs/heads/new ${'0'.repeat(64)}\n`,
    )

    expect(ref?.remoteSha).toBeNull()
  })

  it('refuses a line that is not what git writes, rather than deciding from it', () => {
    expect(() => subject.parsePushedRefs('refs/heads/x only-two-fields\n')).toThrow(
      'pre-push 입력을 읽을 수 없습니다',
    )
  })
})

describe('touchesPerfSurface', () => {
  it.each([
    ['API source', 'apps/api/src/orders/orders.service.ts'],
    ['the Prisma schema', 'apps/api/prisma/schema.prisma'],
    ['a migration', 'apps/api/prisma/migrations/20260901000000_x/migration.sql'],
    ['the test harness', 'apps/api/test/support/timing.ts'],
    ['a performance spec', 'apps/api/test/api/orders-performance.spec.ts'],
    ['a shared response schema', 'packages/shared/src/schemas/order.ts'],
    ['the lockfile', 'pnpm-lock.yaml'],
  ])('%s is on it', (_name, file) => {
    expect(subject.touchesPerfSurface([file])).toBe(true)
  })

  it.each([
    ['documentation', 'docs/tasks/README.md'],
    ['a document whose path repeats a watched one', 'docs/apps/api/src/x.md'],
    ['the API mocks, a sibling that shares a prefix', 'packages/api-mocks/src/handlers.ts'],
    ['an app that shares a prefix', 'apps/api-mocks/src/index.ts'],
    ['a package that shares a prefix', 'packages/shared-something/src/index.ts'],
    ['a lockfile that is not the root one', 'apps/api/pnpm-lock.yaml'],
    ['a file named after a watched directory', 'apps/api/src'],
    ['the API outside the watched directories', 'apps/api/README.md'],
    ['a web app', 'apps/shop/src/app/page.tsx'],
    ['CI', '.github/workflows/ci.yml'],
  ])('%s is not', (_name, file) => {
    expect(subject.touchesPerfSurface([file])).toBe(false)
  })

  it('takes one file on the surface among many that are not', () => {
    expect(
      subject.touchesPerfSurface(['docs/HANDOFF.md', 'apps/api/src/main.ts', 'README.md']),
    ).toBe(true)
  })

  it('an empty range touches nothing', () => {
    expect(subject.touchesPerfSurface([])).toBe(false)
  })

  it('watches exactly what TASK-0146 4.3 lists', () => {
    // A path added here is two more minutes on somebody's push: it should arrive
    // with a change to the TASK, not by itself.
    expect(subject.PERF_SURFACE_DIRECTORIES).toEqual([
      'apps/api/src/',
      'apps/api/prisma/',
      'apps/api/test/',
      'packages/shared/',
    ])
    expect(subject.PERF_SURFACE_FILES).toEqual(['pnpm-lock.yaml'])
  })
})

describe('decide', () => {
  it('F7 — a push that changes only docs/ does not run', () => {
    const decision = subject.decide({
      env: {},
      refs: [pushedRef()],
      changedFilesOf: () => ['docs/tasks/README.md', 'docs/decisions/DECISIONS.md'],
    })

    expect(decision).toEqual({ action: 'skip', reason: 'untouched' })
  })

  it('F8 — a push that changes apps/api/src runs, and says which file did it', () => {
    const decision = subject.decide({
      env: {},
      refs: [pushedRef()],
      changedFilesOf: () => ['docs/tasks/README.md', 'apps/api/src/orders/orders.service.ts'],
    })

    expect(decision).toEqual({
      action: 'run',
      reason: 'touched',
      files: ['apps/api/src/orders/orders.service.ts'],
    })
  })

  it('F7 and F8 hold from the raw stdin text as well', () => {
    const refs = subject.parsePushedRefs(
      `refs/heads/feature/x ${LOCAL} refs/heads/feature/x ${REMOTE}\n`,
    )

    expect(subject.decide({ env: {}, refs, changedFilesOf: () => ['docs/a.md'] }).action).toBe(
      'skip',
    )
    expect(
      subject.decide({ env: {}, refs, changedFilesOf: () => ['apps/api/src/a.ts'] }).action,
    ).toBe('run')
  })

  describe('SKIP_PERF', () => {
    it('=1 skips even when API files changed, without looking at the range', () => {
      const changedFilesOf = vi.fn<ChangedFilesOf>(() => ['apps/api/src/main.ts'])

      const decision = subject.decide({
        env: { SKIP_PERF: '1' },
        refs: [pushedRef()],
        changedFilesOf,
      })

      expect(decision).toEqual({ action: 'skip', reason: 'skip-requested' })
      expect(changedFilesOf).not.toHaveBeenCalled()
    })

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['0', '0'],
      ['false', 'false'],
    ])('%s does not skip', (_name, value) => {
      const decision = subject.decide({
        env: { SKIP_PERF: value },
        refs: [pushedRef()],
        changedFilesOf: () => ['apps/api/src/main.ts'],
      })

      expect(decision.action).toBe('run')
    })
  })

  it('hands a new branch over with no remote side, so the range can start at the merge-base', () => {
    const changedFilesOf = vi.fn<ChangedFilesOf>(() => ['docs/a.md'])
    const refs = subject.parsePushedRefs(`refs/heads/new ${LOCAL} refs/heads/new ${ZERO}\n`)

    subject.decide({ env: {}, refs, changedFilesOf })

    expect(changedFilesOf).toHaveBeenCalledExactlyOnceWith({
      localRef: 'refs/heads/new',
      localSha: LOCAL,
      remoteRef: 'refs/heads/new',
      remoteSha: null,
    })
  })

  it('a new branch that touches the API runs like any other', () => {
    const decision = subject.decide({
      env: {},
      refs: [pushedRef({ remoteSha: null })],
      changedFilesOf: () => ['packages/shared/src/schemas/order.ts'],
    })

    expect(decision.action).toBe('run')
  })

  it('a deleted ref contributes nothing and is never asked about', () => {
    const changedFilesOf = vi.fn<ChangedFilesOf>(() => ['apps/api/src/main.ts'])

    const decision = subject.decide({
      env: {},
      refs: [pushedRef({ localRef: '(delete)', localSha: null })],
      changedFilesOf,
    })

    expect(decision).toEqual({ action: 'skip', reason: 'nothing-pushed' })
    expect(changedFilesOf).not.toHaveBeenCalled()
  })

  it('a deletion beside a docs push is still a docs push', () => {
    const decision = subject.decide({
      env: {},
      refs: [
        pushedRef({ localRef: '(delete)', localSha: null }),
        pushedRef({ localRef: 'refs/heads/docs' }),
      ],
      changedFilesOf: changesByRef(new Map([['refs/heads/docs', ['docs/a.md']]])),
    })

    expect(decision).toEqual({ action: 'skip', reason: 'untouched' })
  })

  it('an empty stdin — nothing to push — does not run', () => {
    expect(subject.decide({ env: {}, refs: [], changedFilesOf: () => null })).toEqual({
      action: 'skip',
      reason: 'nothing-pushed',
    })
  })

  describe('several refs in one push', () => {
    it('run when any one of them touches the surface', () => {
      const decision = subject.decide({
        env: {},
        refs: [
          pushedRef({ localRef: 'refs/heads/docs' }),
          pushedRef({ localRef: 'refs/heads/api' }),
        ],
        changedFilesOf: changesByRef(
          new Map([
            ['refs/heads/docs', ['docs/a.md']],
            ['refs/heads/api', ['apps/api/prisma/schema.prisma']],
          ]),
        ),
      })

      expect(decision).toMatchObject({ action: 'run', reason: 'touched' })
    })

    it('report the union of what they touch, each file once', () => {
      const decision = subject.decide({
        env: {},
        refs: [
          pushedRef({ localRef: 'refs/heads/one' }),
          pushedRef({ localRef: 'refs/heads/two' }),
        ],
        changedFilesOf: changesByRef(
          new Map([
            ['refs/heads/one', ['apps/api/src/a.ts', 'pnpm-lock.yaml', 'docs/a.md']],
            ['refs/heads/two', ['pnpm-lock.yaml', 'apps/api/test/support/timing.ts']],
          ]),
        ),
      })

      expect(decision).toEqual({
        action: 'run',
        reason: 'touched',
        files: ['apps/api/src/a.ts', 'pnpm-lock.yaml', 'apps/api/test/support/timing.ts'],
      })
    })

    it('skip when none of them does', () => {
      const decision = subject.decide({
        env: {},
        refs: [
          pushedRef({ localRef: 'refs/heads/one' }),
          pushedRef({ localRef: 'refs/heads/two' }),
        ],
        changedFilesOf: changesByRef(
          new Map([
            ['refs/heads/one', ['docs/a.md']],
            ['refs/heads/two', ['apps/shop/src/app/page.tsx']],
          ]),
        ),
      })

      expect(decision).toEqual({ action: 'skip', reason: 'untouched' })
    })
  })

  describe('a range that cannot be computed', () => {
    it('runs, and names the ref', () => {
      const decision = subject.decide({
        env: {},
        refs: [pushedRef({ localRef: 'refs/heads/orphan', remoteSha: null })],
        changedFilesOf: () => null,
      })

      expect(decision).toEqual({
        action: 'run',
        reason: 'unknown-range',
        ref: 'refs/heads/orphan',
      })
    })

    it('runs even when every range that could be computed is docs only', () => {
      const decision = subject.decide({
        env: {},
        refs: [
          pushedRef({ localRef: 'refs/heads/docs' }),
          pushedRef({ localRef: 'refs/heads/orphan' }),
        ],
        changedFilesOf: changesByRef(
          new Map<string, string[] | null>([
            ['refs/heads/docs', ['docs/a.md']],
            ['refs/heads/orphan', null],
          ]),
        ),
      })

      expect(decision.action).toBe('run')
    })

    it('SKIP_PERF=1 still wins over it', () => {
      const decision = subject.decide({
        env: { SKIP_PERF: '1' },
        refs: [pushedRef()],
        changedFilesOf: () => null,
      })

      expect(decision.action).toBe('skip')
    })
  })
})
