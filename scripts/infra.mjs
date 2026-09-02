#!/usr/bin/env node
// Wrapper around `docker compose` for the local Postgres + Meilisearch stack.
//
// It exists so that nobody has to remember (or forget) the two variables that
// keep parallel git worktrees apart:
//
//   PORT_OFFSET           shifts every published port  (scripts/ports.mjs)
//   COMPOSE_PROJECT_NAME  namespaces containers, volumes and the network
//
// Both are read from this worktree's `.env.local`; a value already present in
// the shell wins, so `PORT_OFFSET=40 COMPOSE_PROJECT_NAME=x pnpm infra:up`
// brings up a second, fully independent stack without editing any file.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadLocalEnv, resolveOffset, resolvePorts } from './ports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_FILE = join(ROOT, 'docker-compose.yml')

/** Compose project names accept lowercase alphanumerics plus `-` and `_`. */
function sanitizeProjectName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
}

/** Loads `<root>/.env` for values shared with the apps (master key, credentials). */
function loadSharedEnv() {
  const file = join(ROOT, '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function resolveProjectName() {
  const declared = process.env.COMPOSE_PROJECT_NAME
  if (declared) return sanitizeProjectName(declared)

  const fallback = sanitizeProjectName(`shopping-${basename(ROOT)}`)
  console.warn(
    `\n  경고: COMPOSE_PROJECT_NAME 이 없어 "${fallback}" 로 대체합니다.` +
      `\n  .env.local 에 COMPOSE_PROJECT_NAME 을 워크트리마다 다르게 적어주세요.` +
      `\n  같은 이름을 쓰면 두 워크트리가 같은 DB 컨테이너를 공유합니다.\n`,
  )
  return fallback
}

/** Runs `docker compose` with the resolved project name and derived ports. */
function compose(args, ports, project) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', project, '--file', COMPOSE_FILE, ...args],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        POSTGRES_PORT: String(ports.postgres),
        MEILI_PORT: String(ports.meilisearch),
      },
    },
  )

  if (result.error) {
    if (result.error.code === 'ENOENT') fail('docker 명령을 찾을 수 없습니다. Docker 를 설치하고 다시 시도하세요.')
    fail(`docker compose 실행 실패: ${result.error.message}`)
  }
  return result.status ?? 1
}

function printSummary(ports, project, elapsedMs) {
  console.log(`\n  인프라 기동 완료 (${(elapsedMs / 1000).toFixed(1)}초)\n`)
  console.log(`  프로젝트  ${project}`)
  console.log(`  포트      postgres ${ports.postgres} · meilisearch ${ports.meilisearch}\n`)
  // Do not print DATABASE_URL / MEILI_HOST as values to copy into `.env`.
  // Since TASK-0004 the API derives both from PORT_OFFSET at boot, and writing
  // them into `.env` would pin them and silently disable that derivation.
  console.log('  API 는 이 포트들을 PORT_OFFSET 에서 직접 계산합니다.')
  console.log('  .env 에 DATABASE_URL · MEILI_HOST 를 적지 마세요 — 적으면 파생이 꺼집니다.\n')
}

const COMMANDS = {
  up(ports, project, extra) {
    const startedAt = Date.now()
    // `--wait` blocks until every healthcheck passes, so the elapsed time below
    // is the real "up to healthy" number, not just "container created".
    const status = compose(['up', '--detach', '--wait', ...extra], ports, project)
    if (status !== 0) return status

    printSummary(ports, project, Date.now() - startedAt)
    return 0
  },

  down(ports, project, extra) {
    // Volumes survive on purpose — this is the "stop for today" command.
    return compose(['down', '--remove-orphans', ...extra], ports, project)
  },

  reset(ports, project, extra) {
    console.log(`\n  ${project} 의 컨테이너와 볼륨을 삭제하고 다시 띄웁니다. DB 데이터는 사라집니다.\n`)
    const status = compose(['down', '--volumes', '--remove-orphans'], ports, project)
    if (status !== 0) return status
    return COMMANDS.up(ports, project, extra)
  },

  logs(ports, project, extra) {
    const args = extra.length > 0 ? extra : ['--follow', '--tail', '100']
    return compose(['logs', ...args], ports, project)
  },

  ps(ports, project, extra) {
    return compose(['ps', ...extra], ports, project)
  },
}

function main() {
  const [command, ...extra] = process.argv.slice(2)

  if (!command || !Object.hasOwn(COMMANDS, command)) {
    fail(
      `사용법: pnpm infra:<${Object.keys(COMMANDS).join('|')}>` +
        (command ? `\n  알 수 없는 명령: "${command}"` : ''),
    )
  }

  // `.env.local` first: process.loadEnvFile never overwrites an existing value,
  // so the earlier file wins and the shell — already set — wins over both.
  loadLocalEnv()
  loadSharedEnv()

  let ports
  try {
    ports = resolvePorts(resolveOffset())
  } catch (error) {
    fail(error.message)
  }

  process.exit(COMMANDS[command](ports, resolveProjectName(), extra))
}

main()
