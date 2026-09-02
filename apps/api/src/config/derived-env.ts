import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { z } from 'zod'

import type { EnvIssue } from './env.schema.js'

/**
 * The slice of `scripts/ports.mjs` this module uses.
 *
 * That script is the single source of truth for every port in the repository
 * (see its header). It is plain ESM outside of `apps/api`'s `rootDir`, so it is
 * loaded at runtime by path rather than imported: duplicating the base ports
 * here would create a second source of truth, which is exactly the failure the
 * script exists to prevent.
 */
interface PortsModule {
  resolveOffset: (raw?: string) => number
  resolvePorts: (offset?: number) => unknown
}

const resolvedPortsSchema = z.object({
  shop: z.number().int().positive(),
  seller: z.number().int().positive(),
  admin: z.number().int().positive(),
  api: z.number().int().positive(),
  postgres: z.number().int().positive(),
  meilisearch: z.number().int().positive(),
})

type ResolvedPorts = z.infer<typeof resolvedPortsSchema>

/** Defaults for the postgres credentials, mirroring `docker-compose.yml`. */
const POSTGRES_FALLBACKS = {
  host: 'localhost',
  user: 'shopping',
  password: 'shopping',
  database: 'shopping',
} as const

export interface DerivedEnv {
  /** Values to use for variables the environment did not set. */
  readonly values: Readonly<Record<string, string>>
  /** Populated when `PORT_OFFSET` itself is unusable. */
  readonly issues: readonly EnvIssue[]
  /** `null` when nothing could be derived (deployed build, no workspace). */
  readonly offset: number | null
}

const NOTHING_DERIVED: DerivedEnv = { values: {}, issues: [], offset: null }

/** Treats an empty string as "not set", the way an env file does. */
function valueOr(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value
}

async function importPortsModule(repoRoot: string): Promise<PortsModule | null> {
  const file = join(repoRoot, 'scripts', 'ports.mjs')
  if (!existsSync(file)) return null

  return (await import(pathToFileURL(file).href)) as PortsModule
}

function buildDatabaseUrl(
  source: Readonly<Record<string, string | undefined>>,
  port: number,
): string {
  const user = encodeURIComponent(valueOr(source.POSTGRES_USER, POSTGRES_FALLBACKS.user))
  const password = encodeURIComponent(
    valueOr(source.POSTGRES_PASSWORD, POSTGRES_FALLBACKS.password),
  )
  const host = valueOr(source.POSTGRES_HOST, POSTGRES_FALLBACKS.host)
  const database = valueOr(source.POSTGRES_DB, POSTGRES_FALLBACKS.database)

  return `postgresql://${user}:${password}@${host}:${port}/${database}`
}

/** The three Next.js apps, on both spellings of the loopback address. */
function buildCorsOrigins(ports: ResolvedPorts): string {
  const webPorts = [ports.shop, ports.seller, ports.admin]

  return ['localhost', '127.0.0.1']
    .flatMap((hostname) => webPorts.map((port) => `http://${hostname}:${port}`))
    .join(',')
}

/**
 * Derives every port bearing variable from `PORT_OFFSET`.
 *
 * Each worktree runs its own API, three web apps, Postgres and Meilisearch, so
 * the ports differ per worktree while `.env.example` is copied verbatim. The
 * caller merges these values *underneath* the real environment: anything the
 * operator set explicitly wins, which is what keeps a managed database URL or a
 * platform assigned port working in a deployment.
 */
export async function deriveEnvFromPortOffset(
  repoRoot: string | null,
  source: Readonly<Record<string, string | undefined>>,
): Promise<DerivedEnv> {
  if (repoRoot === null) return NOTHING_DERIVED

  const portsModule = await importPortsModule(repoRoot)
  if (portsModule === null) return NOTHING_DERIVED

  let offset: number
  try {
    offset = portsModule.resolveOffset(source.PORT_OFFSET)
  } catch {
    // The thrown message quotes the received value; ours must not.
    return {
      ...NOTHING_DERIVED,
      issues: [{ variable: 'PORT_OFFSET', reason: '0~900 사이의 정수여야 합니다' }],
    }
  }

  const parsed = resolvedPortsSchema.safeParse(portsModule.resolvePorts(offset))
  if (!parsed.success) {
    return {
      ...NOTHING_DERIVED,
      issues: [
        { variable: 'PORT_OFFSET', reason: 'scripts/ports.mjs 가 예상과 다른 포트를 반환했습니다' },
      ],
    }
  }

  const ports = parsed.data

  return {
    offset,
    issues: [],
    values: {
      API_PORT: String(ports.api),
      MEILI_HOST: `http://localhost:${ports.meilisearch}`,
      DATABASE_URL: buildDatabaseUrl(source, ports.postgres),
      CORS_ORIGINS: buildCorsOrigins(ports),
    },
  }
}
