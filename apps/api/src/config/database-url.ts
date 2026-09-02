import { deriveEnvFromPortOffset } from './derived-env.js'
import { isBlank } from './env-value.js'
import { mergeEnv } from './merge-env.js'
import { findRepoRoot, loadEnvFiles } from './workspace.js'

const MISSING =
  'DATABASE_URL 을 확인할 수 없습니다.\n' +
  '  워크트리 안에서 실행했는지 확인하고(.env.local 의 PORT_OFFSET 에서 파생됩니다),\n' +
  '  원격 DB 를 쓰는 경우에는 DATABASE_URL 을 환경변수로 직접 지정하세요.'

/**
 * Picks the connection string out of the environment, derived values included.
 *
 * Split out from {@link resolveDatabaseUrl} so the precedence and the failure
 * message can be tested without loading env files into the test process. The
 * message names the variable and never the value — a connection string carries
 * a password, and this one is printed by a CLI.
 */
export function databaseUrlFrom(
  source: Readonly<Record<string, string | undefined>>,
  derived: Readonly<Record<string, string>>,
): string {
  const url = mergeEnv(source, derived).DATABASE_URL

  if (url === undefined || isBlank(url)) throw new Error(MISSING)
  return url
}

/**
 * Resolves the connection string the same way the API does at boot.
 *
 * The Prisma CLI runs as its own process — it never loads `AppModule` — so
 * without this the two would disagree: the API derives `DATABASE_URL` from the
 * worktree's `PORT_OFFSET`, while a migration would see an unset variable
 * (`.env` deliberately does not pin the URL; see `scripts/infra.mjs`). Both
 * paths therefore go through {@link deriveEnvFromPortOffset} and
 * {@link mergeEnv}, which is what makes "migrated" and "connected" mean the same
 * database.
 *
 * Validation of the URL's shape stays in `env.schema.ts`; a CLI invocation only
 * needs to know that a value exists.
 */
export async function resolveDatabaseUrl(): Promise<string> {
  const repoRoot = findRepoRoot()
  if (repoRoot !== null) loadEnvFiles(repoRoot)

  const derived = await deriveEnvFromPortOffset(repoRoot, process.env)

  return databaseUrlFrom(process.env, derived.values)
}
