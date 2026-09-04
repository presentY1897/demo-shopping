import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `prisma db seed` — a launcher, because the seed cannot run from source.
 *
 * Prisma's configured command is `node prisma/seed.mts`, and Node loads a `.mts`
 * by **stripping** its types. That is enough for a script that only talks to
 * `@prisma/client`, which is what this file used to be. It is not enough for the
 * real seed: TASK-0037 writes the catalogue **through `ProductService` and
 * `StockService`** so that 속성 유효성 and 재고 = 원장 hold by construction, and
 * a NestJS service cannot be stripped —
 *
 * ```
 * SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
 *   TypeScript parameter property is not supported in strip-only mode
 * ```
 *
 * — and even past that, the DI container reads `design:paramtypes`, which only
 * `emitDecoratorMetadata` writes and no stripping mode emits.
 *
 * So the seed is compiled with the rest of `apps/api` and this file runs the
 * output. The build is **always** run rather than checked for staleness: it is
 * incremental and takes about three seconds, and a seed that quietly used a
 * stale `dist` would write yesterday's rules into today's database.
 */
const ENTRY = fileURLToPath(new URL('../dist/seed/run.js', import.meta.url))
const API_DIR = fileURLToPath(new URL('..', import.meta.url))

function build(): void {
  const result = spawnSync('pnpm', ['exec', 'nest', 'build'], {
    cwd: API_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error('시드를 실행하려면 먼저 apps/api 가 빌드돼야 하는데 빌드가 실패했습니다.')
  }
}

build()

if (!existsSync(ENTRY)) {
  throw new Error(`빌드는 됐지만 진입점이 없습니다: ${ENTRY}`)
}

await import(ENTRY)
