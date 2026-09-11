import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { loadAppConfig } from '../config/load-app-config.js'
import { thumbnailSourceKey } from './thumbnail-targets.js'

/** Read-only by default. A UUID cursor lets a stopped batch resume without holding image bytes. */
async function main(): Promise<void> {
  const { config } = await loadAppConfig()
  if (config.storage === null) throw new Error('storage_not_configured')
  const apply = process.argv.includes('--apply')
  const retryFailed = process.argv.includes('--retry-failed')
  const after = process.argv.find((arg) => arg.startsWith('--after='))?.slice(8)
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url, max: 1 }),
  })
  try {
    const rows = await db.productImage.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, url: true, product: { select: { sellerId: true } } },
    })
    let eligible = 0,
      skipped = 0
    for (const row of rows) {
      const job = { id: row.id, token: row.id, sellerId: row.product.sellerId, sourceUrl: row.url }
      try {
        thumbnailSourceKey(job, config.storage)
      } catch {
        skipped++
        continue
      }
      eligible++
      if (apply) {
        await db.productImageDerivative.upsert({
          where: { sellerId_sourceUrl: { sellerId: job.sellerId, sourceUrl: job.sourceUrl } },
          create: { sellerId: job.sellerId, sourceUrl: job.sourceUrl },
          update: {},
        })
        if (retryFailed)
          await db.productImageDerivative.updateMany({
            where: { sellerId: job.sellerId, sourceUrl: job.sourceUrl, status: 'FAILED' },
            data: { status: 'PENDING', attempts: 0, token: null, leaseUntil: null },
          })
      }
    }
    console.log(
      JSON.stringify({
        apply,
        scanned: rows.length,
        eligible,
        skipped,
        nextCursor: rows.at(-1)?.id ?? null,
        hasMore: rows.length === 100,
      }),
    )
  } finally {
    await db.$disconnect()
  }
}
void main().catch(() => {
  console.error('썸네일 보완 작업 실패')
  process.exitCode = 1
})
