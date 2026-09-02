#!/usr/bin/env node
// Single source of truth for every port in the repository.
//
// Several git worktrees are developed in parallel (see CLAUDE.md), and each one
// runs its own API, three Next.js apps, Postgres and Meilisearch. Fixed ports
// would make the second worktree fail to boot, so every port is derived from a
// single `PORT_OFFSET` declared in that worktree's `.env.local`.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Base port per service. `PORT_OFFSET` shifts all of them by the same amount. */
export const BASE_PORTS = Object.freeze({
  shop: 3000,
  seller: 3001,
  admin: 3002,
  api: 4000,
  postgres: 5432,
  meilisearch: 7700,
  // Prisma Studio defaults to a fixed 5555, which collides the moment a second
  // worktree opens it. Routed through the offset like everything else.
  studio: 5555,
})

/** Highest offset that keeps every derived port inside the unprivileged range. */
const MAX_OFFSET = 900

/**
 * Loads `<root>/.env.local` if present. Variables already set in the shell win,
 * so `PORT_OFFSET=10 pnpm dev` overrides the file without editing it.
 */
export function loadLocalEnv(root = ROOT) {
  const file = join(root, '.env.local')
  if (existsSync(file)) process.loadEnvFile(file)
  return file
}

export function resolveOffset(raw = process.env.PORT_OFFSET) {
  if (raw === undefined || raw === '') return 0

  const offset = Number(raw)
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new Error(`PORT_OFFSET must be an integer between 0 and ${MAX_OFFSET}, received "${raw}"`)
  }
  return offset
}

export function resolvePorts(offset = resolveOffset()) {
  return Object.fromEntries(Object.entries(BASE_PORTS).map(([name, port]) => [name, port + offset]))
}

/** Port for one service, for use by that service's own dev/start script. */
export function portFor(service) {
  const ports = resolvePorts()
  if (!(service in ports)) {
    throw new Error(`Unknown service "${service}". Known: ${Object.keys(BASE_PORTS).join(', ')}`)
  }
  return ports[service]
}

if (import.meta.filename === process.argv[1]) {
  loadLocalEnv()

  let offset
  try {
    offset = resolveOffset()
  } catch (error) {
    console.error(`\n  ${error.message}\n`)
    process.exit(1)
  }
  const ports = resolvePorts(offset)

  const portFlag = process.argv.indexOf('--port')
  if (portFlag !== -1) {
    // `--port <service>` prints one number and nothing else, so that a package
    // script can use it directly: `prisma studio --port $(... --port studio)`.
    const service = process.argv[portFlag + 1]
    try {
      console.log(portFor(service))
    } catch (error) {
      console.error(`\n  ${error.message}\n`)
      process.exit(1)
    }
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ offset, ports }))
  } else {
    const width = Math.max(...Object.keys(ports).map((name) => name.length))
    console.log(`PORT_OFFSET=${offset}${offset === 0 ? '  (기본값)' : ''}\n`)
    for (const [name, port] of Object.entries(ports)) {
      console.log(`  ${name.padEnd(width)}  ${port}`)
    }
    console.log(`\n  COMPOSE_PROJECT_NAME  ${process.env.COMPOSE_PROJECT_NAME ?? '(미설정)'}`)
  }
}
