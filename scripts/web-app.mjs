#!/usr/bin/env node
// Runs the Next.js CLI for one web app with this worktree's ports applied.
//
// Next decides its port from the command line or `PORT` long before any config
// file is evaluated, and the browser needs the API's URL baked into the page, so
// neither value can be resolved inside `next.config.ts`. This wrapper resolves
// both from `scripts/ports.mjs` — the single source of truth for every port —
// and then hands over to `next`:
//
//   node ../../scripts/web-app.mjs shop dev
//   node ../../scripts/web-app.mjs shop build
//
// One wrapper rather than three package scripts: the derivation is identical
// for shop, seller and admin, and duplicating it is how the three drift apart.
//
// Anything already exported in the shell wins, which is what lets a deployment
// platform inject `PORT` and `NEXT_PUBLIC_API_URL` and keeps
// `PORT_OFFSET=10 pnpm dev` working without editing a file.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadLocalEnv, resolveOffset, resolvePorts } from './ports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Services that are a Next.js app; the rest of `BASE_PORTS` is infrastructure. */
const WEB_APPS = ['shop', 'seller', 'admin']

/** Next subcommands that bind a port. `build` and `lint` do not. */
const PORT_BOUND = new Set(['dev', 'start'])

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

/** Loads `<root>/.env` for the values the apps share with docker compose. */
function loadSharedEnv() {
  const file = join(ROOT, '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

function hasPortFlag(args) {
  return args.some((arg) => arg === '-p' || arg === '--port' || arg.startsWith('--port='))
}

const [app, ...forwarded] = process.argv.slice(2)

if (!WEB_APPS.includes(app)) {
  fail(`사용법: node scripts/web-app.mjs <${WEB_APPS.join('|')}> <next 명령> [옵션...]`)
}
if (forwarded.length === 0) {
  fail('실행할 next 명령이 없습니다. 예: node scripts/web-app.mjs shop dev')
}

// Next owns NODE_ENV: `dev` means development, `build` and `start` mean
// production, and a value read out of `.env` (where it exists for the API and
// docker compose) would make a production build compile development React.
const inheritedNodeEnv = process.env.NODE_ENV

loadLocalEnv(ROOT)
loadSharedEnv()

let ports
try {
  ports = resolvePorts(resolveOffset())
} catch (error) {
  fail(error.message)
}

const env = { ...process.env }
if (inheritedNodeEnv === undefined) delete env.NODE_ENV
else env.NODE_ENV = inheritedNodeEnv

env.PORT ??= String(ports[app])
// Read by the app when it calls the API. Public by nature — never a secret.
env.NEXT_PUBLIC_API_URL ??= `http://localhost:${ports.api}`

const args = [...forwarded]
if (PORT_BOUND.has(args[0]) && !hasPortFlag(args)) args.push('--port', env.PORT)

// A deliberate stop is not a failure. `pnpm -r --parallel dev` aborts every
// sibling as soon as one script exits non-zero, so reporting SIGTERM as 143
// would mean that stopping shop also kills seller and admin — the opposite of
// the independence the three apps are built for (TASK-0006 F5). Any other
// signal (a segfault, the OOM killer) is still reported as the failure it is.
const CLEAN_STOP = new Set(['SIGINT', 'SIGTERM', 'SIGHUP'])

// `next` resolves through the app's node_modules/.bin, which pnpm puts on PATH.
// Spawned asynchronously rather than with spawnSync so that a signal aimed at
// this wrapper reaches the child too: spawnSync blocks the event loop, and the
// default SIGTERM action would kill the wrapper and orphan the dev server.
const child = spawn('next', args, { stdio: 'inherit', env })

/** Set once a stop was asked of us, so the child's exit code is not a failure. */
let stopRequested = false

for (const signal of CLEAN_STOP) {
  process.on(signal, () => {
    stopRequested = true
    child.kill(signal)
  })
}

child.on('error', (error) => {
  if (error.code === 'ENOENT')
    fail('next 명령을 찾을 수 없습니다. pnpm install 을 먼저 실행하세요.')
  fail(`next 실행 실패: ${error.message}`)
})

child.on('exit', (code, signal) => {
  // `next dev` turns the signal it received into an exit code of its own, so
  // the child's status alone cannot tell a requested shutdown from a crash.
  if (stopRequested) process.exit(0)
  if (signal) process.exit(CLEAN_STOP.has(signal) ? 0 : 1)
  process.exit(code ?? 1)
})
