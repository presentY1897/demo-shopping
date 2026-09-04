import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module.js'
import { AttributeService } from '../catalog/attribute.service.js'
import { CategoryService } from '../catalog/category.service.js'
import { ProductService } from '../catalog/product.service.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { EnvValidationError } from '../config/env-validation.error.js'
import { loadAppConfig } from '../config/load-app-config.js'
import { findRepoRoot } from '../config/workspace.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SellerService } from '../sellers/seller.service.js'
import type { ObjectStorage } from '../storage/object-storage.js'
import { OBJECT_STORAGE } from '../storage/object-storage.js'
import { SeedImages } from './images.js'
import type { SeedScale } from './product-plan.js'
import { SEED_SCALES } from './product-plan.js'
import { SeedRunner } from './seed-runner.js'

/**
 * `pnpm db:seed` — the demo catalogue (TASK-0037).
 *
 * **This runs against `dist`, not against the sources, and that is not a
 * preference.** Prisma's configured seed command is `node prisma/seed.mts`, and
 * Node's type stripping cannot load a NestJS service: parameter properties are
 * not erasable syntax, and the DI container needs `emitDecoratorMetadata`, which
 * no stripping mode emits. Writing the catalogue **through the services** is the
 * whole point (F3 · F4), so the seed is compiled with everything else and
 * `prisma/seed.mts` launches the build output.
 *
 * The application context is the real `AppModule` with the real config loader —
 * the same code the API boots with — so the seed can never write to a different
 * database than the one that was just migrated, and can never disagree with the
 * API about what a valid product is.
 */

/** `seed.version` in `AppMeta`, so a database can say what shape it is in. */
const SEED_MARKER = 'seed.version'
const SEED_VERSION = '1'

/**
 * `AppMeta` key holding the object keys the seed has already uploaded.
 *
 * The bucket cannot be asked: the storage port has no `list`, and the public URL
 * only answers when `R2_PUBLIC_BASE_URL` is actually bound to the bucket — it
 * is a custom domain and returns 404 until somebody wires it, at which point
 * every rerun re-uploads the whole catalogue. Remembering is cheaper and does
 * not depend on a DNS record.
 */
const IMAGE_KEYS_MARKER = 'seed.imageKeys'

function parseKeys(value: string | undefined): ReadonlySet<string> {
  if (value === undefined) return new Set()

  try {
    const parsed: unknown = JSON.parse(value)

    return new Set(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [])
  } catch {
    // A hand-edited or truncated value is not worth failing a seed over; the
    // cost of being wrong is uploading objects that were already there.
    return new Set()
  }
}

function scaleFrom(argv: readonly string[]): SeedScale {
  const flag = argv.find((value) => value.startsWith('--scale='))
  const label = flag?.slice('--scale='.length) ?? 'full'

  if (label !== 'small' && label !== 'full') {
    throw new Error(`--scale 은 small 또는 full 입니다: ${label}`)
  }

  return SEED_SCALES[label]
}

function print(report: Awaited<ReturnType<SeedRunner['run']>>): void {
  const seconds = (report.elapsedMs / 1_000).toFixed(1)
  const rows = [
    ['카테고리', report.categories],
    ['속성 정의', report.attributes],
    ['스토어', report.sellers],
    ['상품', report.products],
  ] as const

  console.log('')
  for (const [label, counts] of rows) {
    console.log(
      `  ${label.padEnd(9)} 생성 ${String(counts.created).padStart(4)} · 기존 ${String(counts.existing).padStart(4)}`,
    )
  }
  if (report.products.refreshed > 0) {
    console.log(
      `  ${'이미지 갱신'.padEnd(9)} ${String(report.products.refreshed).padStart(4)}개 상품`,
    )
  }
  console.log(`  ${'조합'.padEnd(9)} 생성 ${String(report.variants).padStart(4)}`)
  console.log(
    `  ${'이미지'.padEnd(9)} 업로드 ${String(report.images.uploaded)} · 재사용 ${String(report.images.reused)}`,
  )
  if (report.images.note !== null) console.log(`  ⚠ ${report.images.note}`)
  console.log(`\n  scale=${report.scale} · ${seconds}초\n`)
}

async function main(): Promise<void> {
  const scale = scaleFrom(process.argv.slice(2))
  const { config } = await loadAppConfig()
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    // The seed prints its own progress; Nest's module map is noise around it.
    logger: ['error', 'warn'],
  })

  try {
    const prisma = app.get(PrismaService, { strict: false })
    const clock = app.get<Clock>(CLOCK, { strict: false })
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE, { strict: false })
    const remembered = await prisma.appMeta.findUnique({ where: { key: IMAGE_KEYS_MARKER } })
    const images = new SeedImages(
      storage,
      () => clock.now(),
      findRepoRoot(),
      parseKeys(remembered?.value),
    )

    const runner = new SeedRunner({
      prisma,
      categories: app.get(CategoryService, { strict: false }),
      attributes: app.get(AttributeService, { strict: false }),
      products: app.get(ProductService, { strict: false }),
      sellers: app.get(SellerService, { strict: false }),
      images,
      now: () => clock.now(),
      log: (line) => {
        console.log(`  ${line}`)
      },
    })

    console.log(`\n시드 시작 — scale=${scale.label}\n`)

    const report = await runner.run(scale)

    const keys = JSON.stringify(
      [...new Set([...parseKeys(remembered?.value), ...images.report().keys])].sort(),
    )

    await prisma.appMeta.upsert({
      where: { key: SEED_MARKER },
      update: { value: SEED_VERSION },
      create: { key: SEED_MARKER, value: SEED_VERSION },
    })
    await prisma.appMeta.upsert({
      where: { key: IMAGE_KEYS_MARKER },
      update: { value: keys },
      create: { key: IMAGE_KEYS_MARKER, value: keys },
    })

    print(report)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error('\n시드 실행에 실패했습니다.\n')
  console.error(error instanceof EnvValidationError ? error.message : error)
  process.exit(1)
})
