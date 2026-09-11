import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { useDatabase } from '../../test/support/database.js'
import {
  createUser,
  createSeller,
  createCategory,
  createProduct,
} from '../../test/support/factories.js'
import { ThumbnailQueue } from './thumbnail-queue.js'

const db = useDatabase()
let prisma: PrismaClient
beforeAll(() => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) })
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await db.execute('INSERT INTO "ThumbnailPool"("id") VALUES (1) ON CONFLICT DO NOTHING')
})
async function enqueue(index: number) {
  return db.one<{ id: string }>(
    `INSERT INTO "ProductImageDerivative" ("sellerId","sourceUrl") VALUES ('11111111-1111-4111-8111-111111111111',$1) RETURNING "id"`,
    [`https://example.invalid/${index}.png`],
  )
}
describe('global thumbnail slot', () => {
  it('allows exactly one claim across concurrent consumers, then releases for the next job', async () => {
    await enqueue(1)
    await enqueue(2)
    const queues = Array.from({ length: 8 }, () => new ThumbnailQueue(prisma))
    const claims = await Promise.all(queues.map((queue) => queue.claim()))
    const held = claims.filter((job) => job !== null)
    expect(held).toHaveLength(1)
    await queues[0]!.finish(held[0]!, null)
    expect(await queues[0]!.claim()).not.toBeNull()
  })
  it('recovers an expired claim and fences its old completion', async () => {
    await enqueue(1)
    const queue = new ThumbnailQueue(prisma)
    const old = (await queue.claim())!
    await db.execute(`UPDATE "ThumbnailPool" SET "leaseUntil"=now()-interval '1 second'`)
    await db.execute(`UPDATE "ProductImageDerivative" SET "leaseUntil"=now()-interval '1 second'`)
    const current = (await queue.claim())!
    expect(current.token).not.toBe(old.token)
    await queue.finish(old, { thumbnailUrl: 'old', cardImageUrl: 'old', metadata: '[]' })
    const row = await db.one<{ status: string; token: string }>(
      'SELECT "status","token" FROM "ProductImageDerivative"',
    )
    expect(row).toEqual({ status: 'PROCESSING', token: current.token })
  })
  it('stops retrying after three failed attempts', async () => {
    await enqueue(1)
    const queue = new ThumbnailQueue(prisma)
    for (let i = 0; i < 3; i++) {
      const job = (await queue.claim())!
      expect(job).not.toBeNull()
      await queue.finish(job, null)
      await db.execute(
        `UPDATE "ProductImageDerivative" SET "nextAttemptAt"=now()-interval '1 second'`,
      )
    }
    expect(await queue.claim()).toBeNull()
    expect(
      (await db.one<{ status: string }>('SELECT "status" FROM "ProductImageDerivative"')).status,
    ).toBe('FAILED')
  })
  it('enqueues atomically and publishes only to images still referencing the source', async () => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })
    const category = await createCategory(db)
    const product = await createProduct(db, { sellerId: seller.id, categoryId: category.id })
    const source = `https://images.example/products/${seller.id}/22222222-2222-4222-8222-222222222222.png`
    await db.execute(
      `INSERT INTO "ProductImage"("id","productId","url") VALUES (gen_random_uuid(),$1,$2)`,
      [product.id, source],
    )
    const queue = new ThumbnailQueue(prisma)
    const job = (await queue.claim())!
    await queue.finish(job, {
      thumbnailUrl: 'https://images.example/256.webp',
      cardImageUrl: 'https://images.example/768.webp',
      metadata: '[]',
    })
    const image = await db.one<{ url: string; thumbnailUrl: string }>(
      'SELECT "url","thumbnailUrl" FROM "ProductImage"',
    )
    expect(image).toEqual({ url: source, thumbnailUrl: 'https://images.example/256.webp' })
    expect(
      await db.query('SELECT 1 FROM "SearchOutbox" WHERE "productId"=$1', [product.id]),
    ).toHaveLength(1)
    // Reordering recreates image rows in this catalogue. The ready file must remain attached.
    await db.execute('DELETE FROM "ProductImage" WHERE "productId"=$1', [product.id])
    await db.execute(
      `INSERT INTO "ProductImage"("id","productId","url") VALUES (gen_random_uuid(),$1,$2)`,
      [product.id, source],
    )
    expect(
      (await db.one<{ thumbnailUrl: string }>('SELECT "thumbnailUrl" FROM "ProductImage"'))
        .thumbnailUrl,
    ).toBe('https://images.example/256.webp')
  })
})
