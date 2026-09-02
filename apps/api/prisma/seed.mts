import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * Seed entry point — skeleton only.
 *
 * The actual demo catalogue (fashion products, sellers, categories, orders)
 * arrives in M05. What exists here is the part that has to be right before any
 * data is written: a client that talks to the same database the migrations ran
 * against, an idempotent write, and an exit code the CLI can act on.
 *
 * Run it with `pnpm db:seed`. The connection string is resolved by
 * `prisma.config.ts` — the very code the API uses at boot — and handed to this
 * process through the environment, so seeding can never hit a different
 * database than the one that was just migrated.
 */
const SEED_MARKER = 'seed.version'
const SEED_VERSION = '0'

function connectionString(): string {
  const url = process.env.DATABASE_URL

  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL 이 없습니다. `pnpm db:seed` 로 실행하세요 (prisma.config.ts 가 값을 채웁니다).',
    )
  }
  return url
}

async function seed(prisma: PrismaClient): Promise<void> {
  // Upsert rather than create: a seed has to be safe to run twice, otherwise it
  // is only usable on an empty database and stops being run at all.
  await prisma.appMeta.upsert({
    where: { key: SEED_MARKER },
    update: { value: SEED_VERSION },
    create: { key: SEED_MARKER, value: SEED_VERSION },
  })

  // 실제 데모 데이터는 M05 에서 채운다.
  console.log(`시드 완료 — ${SEED_MARKER}=${SEED_VERSION} (데모 데이터는 M05 에서 추가됩니다)`)
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString() }),
  })

  try {
    await seed(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('\n시드 실행에 실패했습니다.\n')
  console.error(error)
  process.exit(1)
})
