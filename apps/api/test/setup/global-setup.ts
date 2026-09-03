import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'

import { resolveDatabaseUrl } from '../../src/config/database-url.js'
import { findRepoRoot } from '../../src/config/workspace.js'
import {
  MAINTENANCE_DATABASE,
  maxWorkers,
  TEMPLATE_DATABASE,
  withDatabase,
  workerDatabaseName,
} from './test-databases.js'

/**
 * Builds the databases the suite runs against — once per run, in the main
 * process, before a single worker starts.
 *
 * Two layers of isolation (QUALITY-GATES 6장, D-207):
 *
 *   between workers  a database each, cloned from a migrated template
 *   between tests    `TRUNCATE ... RESTART IDENTITY CASCADE` (see support/database.ts)
 *
 * The template is what makes that affordable. `CREATE DATABASE ... TEMPLATE`
 * copies the data directory instead of replaying SQL, so a clone costs a file
 * copy while `prisma migrate deploy` per worker would cost a CLI boot each.
 *
 * Wrapping every test in a transaction and rolling it back — the usual
 * alternative — is deliberately not used: uncommitted rows are invisible to
 * other connections, so the concurrency tests this task exists for could not
 * reproduce a race at all. D-207 has the measurements.
 */

/**
 * Located by walking up to the workspace root rather than from `import.meta`:
 * this package emits CommonJS, where `import.meta` is a compile error, and the
 * working directory depends on whether the suite was started from here or from
 * the repository root.
 */
function apiDir(): string {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')
  return join(repoRoot, 'apps', 'api')
}

const API_DIR = apiDir()
const MIGRATIONS_DIR = join(API_DIR, 'prisma', 'migrations')
const TEST_SCHEMA_FILE = join(API_DIR, 'test', 'setup', 'test-schema.sql')

/** Long enough for a container that is still starting, short enough for F11. */
const CONNECT_TIMEOUT_MS = 3_000

/** Bumped by hand when the shape of the template changes for another reason. */
const TEMPLATE_LAYOUT_VERSION = '1'

/**
 * `TEST_DB_REBUILD=1` throws the template and the worker databases away first.
 *
 * The escape hatch for the one case the fingerprint cannot see: a database left
 * in a strange state by hand or by a run that died between two statements.
 */
const REBUILD = (process.env.TEST_DB_REBUILD ?? '') !== ''

function unreachableMessage(connectionString: string, reason: string): string {
  const { hostname, port } = new URL(connectionString)

  return [
    '',
    '  테스트용 PostgreSQL 에 연결하지 못했습니다.',
    `  대상: ${hostname}:${port} (${reason})`,
    '',
    '  로컬이라면 인프라를 먼저 띄우세요:',
    '',
    '    pnpm infra:up',
    '',
    '  포트는 이 워크트리 .env.local 의 PORT_OFFSET 에서 파생됩니다 (pnpm ports 로 확인).',
    '  DB 가 없다고 해서 테스트를 건너뛰지 않습니다 — 아무것도 검증하지 않은 초록은',
    '  TASK-0106 이 없애려는 상태 그 자체입니다.',
    '',
  ].join('\n')
}

/**
 * Fingerprint of everything the template is built from.
 *
 * A rerun whose migrations have not changed reuses the template as it stands,
 * which is what keeps the second `pnpm test` of the day from paying for a
 * `migrate deploy`. CI always misses, since its cluster starts empty.
 */
function templateFingerprint(): string {
  const hash = createHash('sha256').update(TEMPLATE_LAYOUT_VERSION)

  const directories = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const name of directories) {
    hash.update(name)
    hash.update(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
  }
  hash.update(readFileSync(TEST_SCHEMA_FILE))

  return hash.digest('hex')
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS })

  await client.connect()
  return client
}

/**
 * What a database was last built from, or `null` when it does not exist.
 *
 * Kept in the database's own comment rather than in a table: it can then be read
 * from the maintenance connection alone, and reading it never attaches a session
 * to the template — which `CREATE DATABASE ... TEMPLATE` would refuse.
 */
async function fingerprintOf(maintenance: Client, name: string): Promise<string | null> {
  const { rows } = await maintenance.query<{ fingerprint: string | null }>(
    `SELECT shobj_description(oid, 'pg_database') AS fingerprint
       FROM pg_database WHERE datname = $1`,
    [name],
  )

  return rows[0]?.fingerprint ?? null
}

/**
 * `DROP DATABASE` forces an immediate checkpoint, which costs 1~2 seconds on a
 * developer machine — far more than the clone that follows it. That is why the
 * databases below are only dropped when their fingerprint no longer matches.
 *
 * `(FORCE)` also evicts sessions a crashed previous run left behind.
 */
async function dropDatabase(maintenance: Client, name: string): Promise<void> {
  await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
}

/** Hex digest, produced by {@link templateFingerprint}; never external input. */
async function stampFingerprint(
  maintenance: Client,
  name: string,
  fingerprint: string,
): Promise<void> {
  // `COMMENT ON DATABASE` takes no bind parameters, so the value is interpolated.
  await maintenance.query(`COMMENT ON DATABASE "${name}" IS '${fingerprint}'`)
}

function runMigrations(connectionString: string): void {
  const result = spawnSync(join(API_DIR, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: API_DIR,
    // Set explicitly so `prisma.config.mts` — which otherwise derives the URL
    // from PORT_OFFSET, exactly as the API does — points at the template.
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: 'utf8',
  })

  if (result.status === 0) return

  throw new Error(
    `템플릿 DB 마이그레이션에 실패했습니다 (exit ${String(result.status)}).\n` +
      `${result.stdout ?? ''}${result.stderr ?? ''}`,
  )
}

/** Builds the template from scratch: migrations, fixture tables, fingerprint. */
async function buildTemplate(
  maintenance: Client,
  baseUrl: string,
  fingerprint: string,
): Promise<void> {
  await dropDatabase(maintenance, TEMPLATE_DATABASE)
  await maintenance.query(`CREATE DATABASE "${TEMPLATE_DATABASE}"`)

  const templateUrl = withDatabase(baseUrl, TEMPLATE_DATABASE)

  runMigrations(templateUrl)

  // The fixture tables go in over a connection of our own, which is then closed:
  // `CREATE DATABASE ... TEMPLATE` fails while any session is attached to the
  // source, and this is the one every implementer trips over.
  const template = await connect(templateUrl)
  try {
    await template.query(readFileSync(TEST_SCHEMA_FILE, 'utf8'))
  } finally {
    await template.end()
  }

  await stampFingerprint(maintenance, TEMPLATE_DATABASE, fingerprint)
}

/**
 * Clones the template, retrying once after evicting whatever is still attached.
 *
 * A failure here means a leftover session — a killed watch mode, a `psql`
 * someone forgot — so terminating it is the right answer rather than failing the
 * whole run (risk R1).
 */
async function cloneTemplate(maintenance: Client, target: string): Promise<void> {
  try {
    await maintenance.query(`CREATE DATABASE "${target}" TEMPLATE "${TEMPLATE_DATABASE}"`)
  } catch {
    await maintenance.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEMPLATE_DATABASE],
    )
    await maintenance.query(`CREATE DATABASE "${target}" TEMPLATE "${TEMPLATE_DATABASE}"`)
  }
}

/**
 * Makes sure worker `poolId` has a database cloned from the current template.
 *
 * An untouched rerun reuses what is there, which is what keeps the second
 * `pnpm test` of the day from paying four checkpoints for nothing: rows are
 * cleared by `TRUNCATE` before every test anyway, so a reused database is
 * indistinguishable from a fresh one by the time a test sees it.
 */
async function ensureWorkerDatabase(
  maintenance: Client,
  poolId: number,
  fingerprint: string,
): Promise<'reused' | 'created'> {
  const name = workerDatabaseName(poolId)

  if (!REBUILD && (await fingerprintOf(maintenance, name)) === fingerprint) return 'reused'

  await dropDatabase(maintenance, name)
  await cloneTemplate(maintenance, name)
  await stampFingerprint(maintenance, name, fingerprint)

  return 'created'
}

export default async function setup(): Promise<void> {
  const baseUrl = await resolveDatabaseUrl()
  const maintenanceUrl = withDatabase(baseUrl, MAINTENANCE_DATABASE)

  let maintenance: Client
  try {
    maintenance = await connect(maintenanceUrl)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    // Printed rather than only thrown: vitest renders a thrown global setup
    // error as a stack trace, and the operator needs the command, not the frame.
    console.error(unreachableMessage(maintenanceUrl, reason))
    throw new Error('PostgreSQL 에 연결하지 못해 테스트를 시작할 수 없습니다.', { cause: error })
  }

  try {
    const fingerprint = templateFingerprint()

    if (REBUILD || (await fingerprintOf(maintenance, TEMPLATE_DATABASE)) !== fingerprint) {
      const startedAt = performance.now()

      await buildTemplate(maintenance, baseUrl, fingerprint)
      console.info(
        `[test-db] 템플릿 ${TEMPLATE_DATABASE} 생성 — ${(performance.now() - startedAt).toFixed(0)}ms`,
      )
    } else {
      console.info(`[test-db] 템플릿 ${TEMPLATE_DATABASE} 재사용 (마이그레이션 지문 일치)`)
    }

    const workers = maxWorkers()
    const startedAt = performance.now()
    let created = 0

    for (let poolId = 1; poolId <= workers; poolId += 1) {
      if ((await ensureWorkerDatabase(maintenance, poolId, fingerprint)) === 'created') created += 1
    }

    const elapsed = performance.now() - startedAt

    console.info(
      `[test-db] 워커 DB ${String(workers)}개 준비 — 신규 ${String(created)}개 · ` +
        `합계 ${elapsed.toFixed(0)}ms (워커당 ${(elapsed / workers).toFixed(0)}ms)`,
    )
  } finally {
    await maintenance.end()
  }
}
