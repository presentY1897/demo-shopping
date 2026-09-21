#!/usr/bin/env node
// The `pre-push` hook: takes the strict timing verdict (QUALITY-GATES A1) before
// a push that could have moved it, and stays out of the way of every other push.
//
// A1 promises its p95 budgets for a *local* measurement, and CI's shared runners
// showed why: on 2026-09-18 the same code ran 2.6 times slower on one runner
// than on another and a docs-only commit turned `main` red. Since TASK-0146 CI
// judges loosely and the number as written is taken here — but only when the
// pushed commits touch something that can change how long the API takes. A push
// of `docs/` costs nothing.
//
// `.husky/pre-push` is one line that runs this file. The decision lives here and
// not in shell because shell cannot be put under a spec: everything that decides
// is a pure export (`apps/api/test/scripts/pre-push-perf.spec.ts`), while git,
// sockets and the test run stay inside `main()`, which an import never reaches.
//
// This is a reminder, not a lock. `--no-verify` and `SKIP_PERF=1` both get past
// it, on purpose (TASK-0146 R1).

import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadLocalEnv, resolveOffset, resolvePorts } from './ports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Directories whose contents can move an API timing. The trailing slash is what
 * keeps `packages/shared-anything/` and `apps/api-mocks/` out.
 */
export const PERF_SURFACE_DIRECTORIES = Object.freeze([
  'apps/api/src/',
  'apps/api/prisma/',
  // The harness and the performance specs themselves: a changed sample count or
  // a changed fixture is a changed measurement.
  'apps/api/test/',
  // Response schemas live here, and they decide what serialisation costs.
  'packages/shared/',
])

/** Prisma and the pg driver change version here and nowhere else. */
export const PERF_SURFACE_FILES = Object.freeze(['pnpm-lock.yaml'])

/** What a new branch is measured from: it has no remote side to diff against. */
const MAIN_UPSTREAM = 'origin/main'

/** How the person pushing gets past the hook. Printed wherever it stops them. */
const SKIP_HINT = '검사 없이 푸시하려면: SKIP_PERF=1 git push'

/** Long enough for a local container, short enough that a dead port is not a wait. */
const CONNECT_TIMEOUT_MS = 1_000

/** Forty zeros, or sixty-four in a SHA-256 repository. */
const ZERO_SHA = /^0+$/

/**
 * Reads what git writes to a `pre-push` hook's stdin, one line per pushed ref:
 *
 *   <local ref> <local sha> <remote ref> <remote sha>
 *
 * A side that does not exist arrives as all zeros and leaves as `null`, so that
 * nothing downstream compares strings of zeros: a `null` local side is a
 * deleted ref, a `null` remote side is a branch the remote has never seen.
 */
export function parsePushedRefs(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)

      if (remoteSha === undefined) {
        // git has written four fields since the hook exists. Anything else is
        // not a push, and guessing a verdict from it would be exactly that.
        throw new Error(`pre-push 입력을 읽을 수 없습니다: "${line}"`)
      }

      return {
        localRef,
        localSha: ZERO_SHA.test(localSha) ? null : localSha,
        remoteRef,
        remoteSha: ZERO_SHA.test(remoteSha) ? null : remoteSha,
      }
    })
}

function onPerfSurface(file) {
  return (
    PERF_SURFACE_FILES.includes(file) ||
    PERF_SURFACE_DIRECTORIES.some((directory) => file.startsWith(directory))
  )
}

/** Whether any of these repository-relative paths can change an API timing. */
export function touchesPerfSurface(files) {
  return files.some(onPerfSurface)
}

/**
 * Decides whether this push takes the measurement.
 *
 * `changedFilesOf(ref)` answers with the paths a pushed ref changes, or with
 * `null` when it cannot tell. It is handed the ref as parsed — `remoteSha: null`
 * for a new branch — because where to diff from is its business (the remote
 * sha, or the merge-base with main), and it is injected so that a spec decides
 * without a repository.
 *
 * A range that cannot be computed **runs** the check. Two minutes spent on a
 * push that did not need them is the cheap mistake; the other one is a
 * regression that went out unmeasured because a fetch was stale.
 *
 * @returns {{ action: 'skip', reason: 'skip-requested' | 'nothing-pushed' | 'untouched' }
 *   | { action: 'run', reason: 'touched', files: string[] }
 *   | { action: 'run', reason: 'unknown-range', ref: string }}
 */
export function decide({ env, refs, changedFilesOf }) {
  // Exactly `1`, the one spelling the messages advertise. Any other value runs
  // the check, which is the direction a typo should fall in.
  if (env.SKIP_PERF === '1') return { action: 'skip', reason: 'skip-requested' }

  // A deleted ref sends no commits anywhere.
  const pushed = refs.filter((ref) => ref.localSha !== null)
  if (pushed.length === 0) return { action: 'skip', reason: 'nothing-pushed' }

  const touched = new Set()

  for (const ref of pushed) {
    const files = changedFilesOf(ref)
    if (files === null) return { action: 'run', reason: 'unknown-range', ref: ref.localRef }

    for (const file of files) {
      if (onPerfSurface(file)) touched.add(file)
    }
  }

  return touched.size > 0
    ? { action: 'run', reason: 'touched', files: [...touched] }
    : { action: 'skip', reason: 'untouched' }
}

// ---------------------------------------------------------------------------
// Side effects. Nothing below runs on import.
// ---------------------------------------------------------------------------

/** stdout of a git command, or `null` when it failed. git's own stderr is dropped. */
function git(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    // A first push of a long-lived branch can name a great many files.
    maxBuffer: 64 * 1024 * 1024,
  })

  return result.status === 0 ? result.stdout : null
}

/**
 * The real `changedFilesOf`. Diffs from the remote's sha when there is one and
 * this clone has it; otherwise — a new branch, or a remote tip nobody fetched —
 * from the merge-base with main.
 */
function changedFilesOf(ref) {
  const remoteIsKnown =
    ref.remoteSha !== null && git(['cat-file', '-e', `${ref.remoteSha}^{commit}`]) !== null
  const base = remoteIsKnown
    ? ref.remoteSha
    : git(['merge-base', ref.localSha, MAIN_UPSTREAM])?.trim()

  if (!base) return null

  // `-z` because git quotes and escapes a non-ASCII path otherwise, and a quoted
  // path matches no prefix. `--no-renames` because a file moved out of
  // `apps/api/src` would be listed under its new name alone.
  const names = git(['diff', '--name-only', '--no-renames', '-z', base, ref.localSha, '--'])

  return names === null ? null : names.split('\0').filter((name) => name !== '')
}

/** A TCP connect and nothing more: the question is "is it up", not "is it healthy". */
function reachable(port) {
  return new Promise((resolve) => {
    // `localhost`, as the API itself dials it (`derived-env.ts`).
    const socket = connect({ host: 'localhost', port })
    const settle = (answer) => {
      socket.destroy()
      resolve(answer)
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

/** The services the performance specs need, with this worktree's ports. */
function localInfra() {
  // `.env.local` carries this worktree's PORT_OFFSET. The hook never knows a
  // port by itself: on this machine 5432–5434 belong to other projects, and a
  // connect that succeeded there would say nothing about ours (TASK-0146 R4).
  loadLocalEnv(ROOT)
  const ports = resolvePorts(resolveOffset())

  return [
    { name: 'postgres', port: ports.postgres },
    { name: 'meilisearch', port: ports.meilisearch },
  ]
}

async function readStdin() {
  // Run by hand from a terminal there is no git on the other end, and waiting
  // for one would hang.
  if (process.stdin.isTTY) return ''

  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) text += chunk

  return text
}

function runPerfSuite() {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@shopping/api', 'run', 'test:perf'], {
      cwd: ROOT,
      // git's pipe has been read to its end by now; the suite has no use for it.
      stdio: ['ignore', 'inherit', 'inherit'],
      // Spelled out even though strict is the local default: a shell that
      // exports `CI` would otherwise take the loose verdict here.
      env: { ...process.env, PERF_TIMING: 'strict' },
    })

    child.once('error', (error) => {
      console.error(
        error.code === 'ENOENT'
          ? '\n  pnpm 명령을 찾을 수 없습니다.'
          : `\n  성능 검사를 시작하지 못했습니다: ${error.message}`,
      )
      // `null`: it never ran, so there is no verdict for `main()` to explain.
      resolve(null)
    })
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

async function main() {
  const decision = decide({
    env: process.env,
    refs: parsePushedRefs(await readStdin()),
    changedFilesOf,
  })

  if (decision.action === 'skip') {
    // The other two reasons say nothing: a push that has nothing to do with the
    // API should not hear about the API.
    if (decision.reason === 'skip-requested') {
      console.log('\n  성능 검사를 건너뛰었습니다 (SKIP_PERF=1)\n')
    }
    return 0
  }

  const infra = localInfra()
  const answers = await Promise.all(infra.map((service) => reachable(service.port)))
  const down = infra.filter((_service, index) => !answers[index])

  if (down.length > 0) {
    const width = Math.max(...down.map((service) => service.name.length))

    console.error('\n  로컬 인프라에 연결할 수 없어 성능 검사를 시작하지 않았습니다.\n')
    for (const service of down) {
      console.error(`    ${service.name.padEnd(width)}  localhost:${service.port}  연결 안 됨`)
    }
    console.error('\n  pnpm infra:up 으로 띄운 뒤 다시 푸시하세요.')
    console.error(`  ${SKIP_HINT}\n`)
    return 1
  }

  if (decision.reason === 'touched') {
    const [first, ...rest] = decision.files
    const others = rest.length > 0 ? ` 외 ${rest.length}개` : ''

    console.log(`\n  이 푸시는 API 응답 시간에 닿는 파일을 바꿉니다 — ${first}${others}`)
  } else {
    console.log(
      `\n  ${decision.ref} 의 푸시 범위를 계산하지 못했습니다 — 모를 때는 재는 쪽을 택합니다.`,
    )
  }
  console.log('  성능 검사(A1 · 엄격 모드)를 돌립니다. 1~2분 걸립니다.')
  console.log(`  ${SKIP_HINT}\n`)

  const status = await runPerfSuite()

  if (status === null) return 1

  if (status !== 0) {
    console.error('\n  성능 검사가 통과하지 못해 푸시를 멈췄습니다.\n')
    console.error(
      '  로컬에서만 도는 엄격한 A1 검사입니다 — 워밍업 뒤 p95 를 예산과 그대로 비교합니다.',
    )
    console.error(
      '  실패한 단언의 [perf:strict] 요약 줄에서 중앙값을 보세요. 중앙값은 예산 안인데 p95 · 최대만',
    )
    console.error(
      '  튀었다면 이 머신이 잠깐 느렸던 것이고(다시 푸시), 중앙값이 함께 올랐다면 회귀입니다.',
    )
    console.error(`  ${SKIP_HINT}\n`)
  }

  return status
}

// Same test as `ports.mjs`: true for `node scripts/pre-push-perf.mjs`, false for
// the spec's `import()`, where argv[1] is the test runner.
if (import.meta.filename === process.argv[1]) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      console.error(`\n  ${error.message}\n`)
      process.exit(1)
    },
  )
}
