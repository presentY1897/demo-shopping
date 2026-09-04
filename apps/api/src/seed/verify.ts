import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module.js'
import { AttributeService } from '../catalog/attribute.service.js'
import { loadAppConfig } from '../config/load-app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { StockService } from '../stock/stock.service.js'
import { SEED_BRANDS } from './vocabulary.js'

/**
 * `pnpm db:seed:verify` — the 정합성 점검 스크립트 TASK-0037 6.1 asks for.
 *
 * **Every check here reads the database, not the plan.** `product-plan.spec.ts`
 * already proves the *requests* are valid, which is a different claim: it says
 * the seed asked for the right thing. This says the database ended up in the
 * right state — and the two can disagree, because between them sit a service
 * layer, a transaction, and eleven check constraints.
 *
 * F3 in particular cannot be answered any other way. "전 상품 속성 검증 실행,
 * 위반 0건" means running the API's own validator over what is stored, with the
 * rules resolved from the categories as they actually exist.
 */

interface Check {
  readonly id: string
  readonly what: string
  readonly detail: string
  readonly ok: boolean
}

/** How many combinations the task expects, give or take. */
const VARIANT_TARGET = [2_500, 4_000] as const

async function main(): Promise<void> {
  const { config } = await loadAppConfig()
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })

  try {
    const prisma = app.get(PrismaService, { strict: false })
    const attributes = app.get(AttributeService, { strict: false })
    const stock = app.get(StockService, { strict: false })
    const checks: Check[] = []

    // ------------------------------------------------------------ F1 · counts
    const [categories, definitions, sellers, products, variants] = await Promise.all([
      prisma.category.count(),
      prisma.attributeDefinition.count({ where: { deletedAt: null } }),
      prisma.seller.count(),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.productVariant.count({ where: { deletedAt: null } }),
    ])

    checks.push({
      id: 'F1',
      what: '전체 생성',
      detail: `카테고리 ${String(categories)} · 속성 ${String(definitions)} · 스토어 ${String(sellers)} · 상품 ${String(products)} · 조합 ${String(variants)}`,
      ok:
        categories === 40 &&
        sellers === 15 &&
        products === 800 &&
        variants >= VARIANT_TARGET[0] &&
        variants <= VARIANT_TARGET[1],
    })

    // ------------------------------------------------- F3 · attribute validity
    const rows = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, categoryId: true, attributes: true, status: true },
    })
    const offenders: string[] = []

    for (const row of rows) {
      const result = await attributes.validateAttributes(row.categoryId, row.attributes)

      if (!result.ok) offenders.push(`${row.name}: ${result.issues.map((i) => i.key).join(', ')}`)
    }

    checks.push({
      id: 'F3',
      what: '속성 유효성',
      detail:
        offenders.length === 0
          ? `${String(rows.length)}개 전부 통과`
          : `${String(offenders.length)}건 위반 — ${offenders.slice(0, 3).join(' / ')}`,
      ok: offenders.length === 0,
    })

    // ------------------------------------------------------ F4 · stock ledger
    const discrepancies = await stock.reconcile()

    checks.push({
      id: 'F4',
      what: '재고 정합성',
      detail:
        discrepancies.length === 0
          ? `조합 ${String(variants)}개 전부 원장과 일치`
          : `${String(discrepancies.length)}건 불일치 — 첫 건 ${discrepancies[0]?.variantId ?? ''}`,
      ok: discrepancies.length === 0,
    })

    // ------------------------------------------------ F5 · price distribution
    const prices = await prisma.productVariant.findMany({
      where: { deletedAt: null, isActive: true },
      select: { price: true },
      orderBy: { price: 'asc' },
    })
    const low = prices[0]?.price ?? 0
    const high = prices[prices.length - 1]?.price ?? 0
    const mid = prices[Math.floor(prices.length / 2)]?.price ?? 0
    const spread = low === 0 ? 0 : high / low

    checks.push({
      id: 'F5',
      what: '가격 분포',
      detail: `${String(low)} ~ ${String(high)} (중앙 ${String(mid)}) — ${spread.toFixed(1)}배`,
      ok: spread >= 20,
    })

    // ------------------------------------------------------- F6 · brand names
    const stores = await prisma.seller.findMany({
      select: { brandName: true },
      orderBy: { slug: 'asc' },
    })
    const unexpected = stores.filter(
      (store) => !SEED_BRANDS.some(([name]) => name === store.brandName),
    )

    checks.push({
      id: 'F6',
      what: '상표 미포함',
      detail:
        unexpected.length === 0
          ? stores.map((store) => store.brandName).join(' · ')
          : `목록에 없는 이름 ${String(unexpected.length)}개`,
      ok: unexpected.length === 0,
    })

    // ------------------------------------------------------------- F6b · 갤러리
    const galleries = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { images: { select: { id: true } } },
    })
    const withImages = galleries.filter((row) => row.images.length > 0).length
    const showcase = galleries.filter((row) => row.images.length >= 4).length

    checks.push({
      id: 'F6b',
      what: '쇼케이스 갤러리',
      detail: `이미지 있는 상품 ${String(withImages)} · 4장 이상 ${String(showcase)}`,
      ok: showcase >= 20,
    })

    console.log('')
    for (const check of checks) {
      console.log(
        `  ${check.ok ? '✅' : '❌'} ${check.id.padEnd(4)} ${check.what.padEnd(10)} ${check.detail}`,
      )
    }
    console.log('')

    if (checks.some((check) => !check.ok)) process.exitCode = 1
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error('\n점검에 실패했습니다.\n')
  console.error(error)
  process.exit(1)
})
