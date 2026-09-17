import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * The guard in front of the one script in this repository that writes to the
 * production database (`scripts/import-reviewed-products.cjs`, TASK-0142).
 *
 * It lives under `test/` and not beside the script because that is the only
 * place the gates look: `vitest.config.mjs` collects `src` and `test`, and CI
 * has no `node --test` step. The original `node:test` file sat next to the
 * guard and ran nowhere — a refusal nothing runs is a refusal nobody knows is
 * still there.
 *
 * Nothing here opens a connection. The guard is a function of a URL string, a
 * plan object, the export bytes and two files on disk, so the subject is loaded
 * exactly as the script loads it (`require` of the `.cjs`) and fed fixtures: a
 * hostname that does not exist and a temp directory.
 *
 * Every refusal is its own case, each one change away from an input the guard
 * accepts. `scripts/**` is outside the coverage report on purpose, so this
 * list — not a percentage — is what says each condition is reached.
 */

interface ProductionPlan {
  version: number
  databaseHost: string
  databasePath: string
  bucket: string
  publicBaseUrl: string
  exportSha256: string
  assetCount: number
  backupVerified?: boolean
  backupFile?: string
  backupSha256?: string
  dryRunVerified?: boolean
  dryRunFile?: string
  dryRunSha256?: string
}

interface MappedAsset {
  verified: boolean
  publicUrl: string
}

interface GuardInput {
  target: string
  plan: ProductionPlan
  exportBytes: Buffer
  mapped: { assets: unknown }
  apply: boolean
  planOnly: boolean
}

interface Guard {
  assertLocalTarget: (target: string) => void
  validateProductionPlan: (input: GuardInput) => void
}

/** `import.meta` is unavailable in this package's CommonJS output, hence the walk. */
function loadGuard(): Guard {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const scripts = join(repoRoot, 'apps', 'api', 'scripts')

  return createRequire(join(scripts, 'index.cjs'))('./reviewed-production-guard.cjs') as Guard
}

const { assertLocalTarget, validateProductionPlan } = loadGuard()

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

const PINNED = 'does not match pinned plan'
const UNVERIFIED = 'requires verified backup and dry run'
const EVIDENCE = 'backup or dry-run evidence does not match'

/** A dry run the guard accepts. No credentials in the URL: the guard never reads them. */
function dryRunInput(): GuardInput & { mapped: { assets: MappedAsset[] } } {
  const exportBytes = Buffer.from('{"productCount":66}')

  return {
    target: 'postgresql://ep-example.neon.tech/neondb?sslmode=verify-full',
    plan: {
      version: 1,
      databaseHost: 'ep-example.neon.tech',
      databasePath: '/neondb',
      bucket: 'shopping-prod',
      publicBaseUrl: 'https://cdn.demo-shopping.com',
      exportSha256: sha256(exportBytes),
      assetCount: 1,
    },
    exportBytes,
    mapped: {
      assets: [{ verified: true, publicUrl: 'https://cdn.demo-shopping.com/products/test.png' }],
    },
    apply: false,
    planOnly: false,
  }
}

describe('assertLocalTarget — no production plan', () => {
  it('accepts the confirmed local database under either loopback name', () => {
    expect(() => {
      assertLocalTarget('postgresql://localhost:5582/shopping')
    }).not.toThrow()
    expect(() => {
      assertLocalTarget('postgresql://127.0.0.1:5582/shopping')
    }).not.toThrow()
  })

  it.each([
    ['a remote host', 'postgresql://ep-example.neon.tech/neondb?sslmode=require'],
    [
      'a remote host dressed as the local port and database',
      'postgresql://db.invalid:5582/shopping',
    ],
    ['another local port', 'postgresql://localhost:5432/shopping'],
    ['another local database', 'postgresql://localhost:5582/shopping_image_preview'],
  ])('refuses %s', (_name, target) => {
    expect(() => {
      assertLocalTarget(target)
    }).toThrow('Only the confirmed localhost:5582/shopping target is allowed')
  })
})

describe('validateProductionPlan — dry run', () => {
  it('accepts a target and reviewed inputs that match the pinned plan', () => {
    expect(() => {
      validateProductionPlan(dryRunInput())
    }).not.toThrow()
  })

  it('accepts sslmode=require as well as verify-full', () => {
    const input = dryRunInput()

    input.target = input.target.replace('verify-full', 'require')
    expect(() => {
      validateProductionPlan(input)
    }).not.toThrow()
  })

  it('refuses --plan-only, which would skip the public byte check', () => {
    const input = dryRunInput()

    input.planOnly = true
    expect(() => {
      validateProductionPlan(input)
    }).toThrow('Production requires public asset verification')
  })

  const refusals: readonly (readonly [string, (input: ReturnType<typeof dryRunInput>) => void])[] =
    [
      [
        'an unknown plan version',
        (x) => {
          x.plan.version = 2
        },
      ],
      [
        'a target that is not PostgreSQL',
        (x) => {
          x.target = x.target.replace('postgresql:', 'https:')
        },
      ],
      [
        'a different host',
        (x) => {
          x.target = x.target.replace('ep-example', 'ep-other')
        },
      ],
      [
        'a different database',
        (x) => {
          x.target = x.target.replace('/neondb?', '/other?')
        },
      ],
      [
        'a pinned host outside neon.tech',
        (x) => {
          // Host and plan agree with each other, so only the suffix rule is left to refuse.
          x.target = x.target.replace('ep-example.neon.tech', 'db.invalid')
          x.plan.databaseHost = 'db.invalid'
        },
      ],
      [
        'a target without sslmode',
        (x) => {
          x.target = x.target.replace('?sslmode=verify-full', '')
        },
      ],
      [
        'a target whose sslmode allows a plaintext fallback',
        (x) => {
          x.target = x.target.replace('verify-full', 'prefer')
        },
      ],
      [
        'the development bucket',
        (x) => {
          x.plan.bucket = 'shopping-dev'
        },
      ],
      [
        'a plan pinned to another public origin, even when the assets agree with it',
        (x) => {
          x.plan.publicBaseUrl = 'https://example.r2.dev'
          x.mapped.assets = [{ verified: true, publicUrl: 'https://example.r2.dev/image.png' }]
        },
      ],
      [
        'a plan pinned below the root of the production origin',
        (x) => {
          x.plan.publicBaseUrl = 'https://cdn.demo-shopping.com/products'
        },
      ],
      [
        'a changed export',
        (x) => {
          x.exportBytes = Buffer.from('{}')
        },
      ],
      [
        'an asset map without an asset list',
        (x) => {
          ;(x.mapped as { assets: unknown }).assets = undefined
        },
      ],
      [
        'an asset count other than the pinned one',
        (x) => {
          x.plan.assetCount = 2
        },
      ],
      [
        'an unverified asset',
        (x) => {
          x.mapped.assets = [{ ...x.mapped.assets[0]!, verified: false }]
        },
      ],
      [
        'an asset on the development public URL',
        (x) => {
          x.mapped.assets = [{ verified: true, publicUrl: 'https://example.r2.dev/image.png' }]
        },
      ],
      [
        'an asset URL with a query',
        (x) => {
          x.mapped.assets = [{ verified: true, publicUrl: `${x.mapped.assets[0]!.publicUrl}?v=2` }]
        },
      ],
      [
        'an asset URL with a fragment',
        (x) => {
          x.mapped.assets = [{ verified: true, publicUrl: `${x.mapped.assets[0]!.publicUrl}#x` }]
        },
      ],
      [
        'an asset URL with a user name',
        (x) => {
          x.mapped.assets = [
            {
              verified: true,
              publicUrl: 'https://someone@cdn.demo-shopping.com/products/test.png',
            },
          ]
        },
      ],
      [
        'an asset URL with a password',
        (x) => {
          // Built at run time so that no credential-shaped literal sits in the repository.
          const url = new URL(x.mapped.assets[0]!.publicUrl)

          url.password = 'x'
          x.mapped.assets = [{ verified: true, publicUrl: url.href }]
        },
      ],
    ]

  it.each(refusals)('refuses %s', (_name, change) => {
    const input = dryRunInput()

    change(input)
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(PINNED)
  })

  it('throws rather than passes when an asset URL cannot be parsed', () => {
    const input = dryRunInput()

    input.mapped.assets = [{ verified: true, publicUrl: 'not a url' }]
    expect(() => {
      validateProductionPlan(input)
    }).toThrow()
  })
})

describe('validateProductionPlan — apply', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reviewed-production-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** What a completed production dry run leaves behind, as the import script writes it. */
  function dryRunReport(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      mode: 'dry-run',
      target: 'confirmed-production',
      verifiedAssets: 1,
      products: Array.from({ length: 66 }, () => ({})),
      ...overrides,
    })
  }

  /** An apply the guard accepts: a backup and a dry-run report on disk, both pinned by SHA. */
  function applyInput(
    evidence: { backup?: Buffer; dryRun?: string } = {},
  ): ReturnType<typeof dryRunInput> {
    const input = dryRunInput()
    const backup = evidence.backup ?? Buffer.from('PGDMP-test-fixture')
    const dryRun = evidence.dryRun ?? dryRunReport()
    const backupFile = join(dir, 'backup.dump')
    const dryRunFile = join(dir, 'dry-run.json')

    writeFileSync(backupFile, backup)
    writeFileSync(dryRunFile, dryRun)
    input.apply = true
    Object.assign(input.plan, {
      backupVerified: true,
      dryRunVerified: true,
      backupFile,
      dryRunFile,
      backupSha256: sha256(backup),
      dryRunSha256: sha256(dryRun),
    })

    return input
  }

  it('accepts an intact backup and a completed dry run of the same input', () => {
    expect(() => {
      validateProductionPlan(applyInput())
    }).not.toThrow()
  })

  it('refuses a plan that names neither a backup nor a dry run', () => {
    const input = dryRunInput()

    input.apply = true
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(UNVERIFIED)
  })

  it.each(['backupVerified', 'dryRunVerified'] as const)('refuses a plan without %s', (flag) => {
    const input = applyInput()

    input.plan[flag] = false
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(UNVERIFIED)
  })

  it('still applies the pinned-plan checks before looking at the evidence', () => {
    const input = applyInput()

    input.plan.bucket = 'shopping-dev'
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(PINNED)
  })

  it('refuses a backup that was overwritten after it was pinned', () => {
    const input = applyInput()

    writeFileSync(input.plan.backupFile ?? '', 'corrupted')
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(EVIDENCE)
  })

  it('refuses a pinned file that is not a pg_dump archive', () => {
    // The SHA matches, so the `PGDMP` signature is the only thing left to refuse it.
    expect(() => {
      validateProductionPlan(applyInput({ backup: Buffer.from('plain SQL, not an archive') }))
    }).toThrow(EVIDENCE)
  })

  it('refuses a pg_dump archive other than the pinned one', () => {
    const input = applyInput()

    writeFileSync(input.plan.backupFile ?? '', 'PGDMP-another-archive')
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(EVIDENCE)
  })

  it('refuses a dry-run report that was replaced after it was pinned', () => {
    const input = applyInput()

    writeFileSync(input.plan.dryRunFile ?? '', '{}')
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(EVIDENCE)
  })

  it('refuses a dry-run report that was edited, even into one that still reads as complete', () => {
    const input = applyInput()

    // Every field the guard reads is intact, so the SHA is the only thing left to refuse it.
    writeFileSync(input.plan.dryRunFile ?? '', dryRunReport({ note: 'edited after pinning' }))
    expect(() => {
      validateProductionPlan(input)
    }).toThrow(EVIDENCE)
  })

  it.each([
    ['came from an apply', { mode: 'apply' }],
    ['came from a plan-only run', { mode: 'plan-only' }],
    ['ran against the local database', { target: 'localhost:5582/shopping' }],
    ['verified fewer assets than the plan pins', { verifiedAssets: 0 }],
    ['planned fewer products than the export holds', { products: [{}] }],
  ])('refuses a pinned dry-run report that %s', (_name, overrides) => {
    // Each report is pinned by its own SHA, so it is the content that is refused.
    expect(() => {
      validateProductionPlan(applyInput({ dryRun: dryRunReport(overrides) }))
    }).toThrow(EVIDENCE)
  })

  it('throws rather than passes when the backup file is gone', () => {
    const input = applyInput()

    rmSync(input.plan.backupFile ?? '')
    expect(() => {
      validateProductionPlan(input)
    }).toThrow('ENOENT')
  })
})
