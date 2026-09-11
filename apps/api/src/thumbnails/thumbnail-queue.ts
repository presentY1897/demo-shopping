import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export interface ThumbnailJob {
  readonly id: string
  readonly sellerId: string
  readonly sourceUrl: string
  readonly token: string
}

/** The singleton row serialises claims across all API replicas. No image bytes enter a transaction. */
export class ThumbnailQueue {
  constructor(private readonly db: PrismaClient) {}

  async claim(): Promise<ThumbnailJob | null> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "ThumbnailPool"("id") VALUES (1) ON CONFLICT DO NOTHING`
      const token = randomUUID()
      const slot = await tx.$queryRaw<{ id: number }[]>`
        UPDATE "ThumbnailPool" SET "token"=${token}::uuid, "leaseUntil"=clock_timestamp()+interval '120 seconds'
        WHERE "id"=1 AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp()) RETURNING "id"`
      if (slot.length === 0) return null
      const jobs = await tx.$queryRaw<ThumbnailJob[]>`
        UPDATE "ProductImageDerivative" SET "status"='PROCESSING', "token"=${token}::uuid,
          "attempts"="attempts"+1, "leaseUntil"=clock_timestamp()+interval '120 seconds'
        WHERE "id"=(SELECT "id" FROM "ProductImageDerivative"
          WHERE (("status"='PENDING' AND "nextAttemptAt"<=clock_timestamp()) OR
                 ("status"='PROCESSING' AND "leaseUntil"<clock_timestamp())) AND "attempts"<3
          ORDER BY "nextAttemptAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING "id", "sellerId", "sourceUrl", "token"`
      if (jobs[0] !== undefined) return jobs[0]
      await tx.$executeRaw`UPDATE "ThumbnailPool" SET "token"=NULL,"leaseUntil"=NULL WHERE "token"=${token}::uuid`
      await tx.$executeRaw`UPDATE "ProductImageDerivative" SET "status"='FAILED' WHERE "status"='PROCESSING' AND "leaseUntil"<clock_timestamp() AND "attempts">=3`
      return null
    })
  }

  async finish(
    job: ThumbnailJob,
    result: { thumbnailUrl: string; cardImageUrl: string; metadata: string } | null,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<
        { id: number }[]
      >`SELECT "id" FROM "ThumbnailPool" WHERE "token"=${job.token}::uuid AND "leaseUntil">clock_timestamp() FOR UPDATE`
      if (owned.length === 0) return
      if (result === null) {
        await tx.$executeRaw`UPDATE "ProductImageDerivative" SET "status"=CASE WHEN "attempts">=3 THEN 'FAILED' ELSE 'PENDING' END,
          "nextAttemptAt"=clock_timestamp()+interval '60 seconds',"leaseUntil"=NULL,"token"=NULL WHERE "id"=${job.id}::uuid AND "token"=${job.token}::uuid`
      } else {
        // Product writes lock the parent before recreating image rows and touching the queue trigger.
        // Follow that order, so finalisation cannot hold the job while waiting on an editor's image.
        await tx.$queryRaw`SELECT p."id" FROM "Product" p
          WHERE p."sellerId"=${job.sellerId}::uuid AND EXISTS
            (SELECT 1 FROM "ProductImage" i WHERE i."productId"=p."id" AND i."url"=${job.sourceUrl})
          ORDER BY p."id" FOR UPDATE OF p`
        await tx.$executeRaw`UPDATE "ProductImageDerivative" SET "status"='READY',"thumbnailUrl"=${result.thumbnailUrl},"cardImageUrl"=${result.cardImageUrl},"metadata"=${result.metadata}::jsonb,"token"=NULL,"leaseUntil"=NULL WHERE "id"=${job.id}::uuid AND "token"=${job.token}::uuid`
        const changed = await tx.$queryRaw<
          { productId: string }[]
        >`UPDATE "ProductImage" i SET "thumbnailUrl"=${result.thumbnailUrl},"cardImageUrl"=${result.cardImageUrl}
          FROM "Product" p WHERE i."productId"=p."id" AND p."sellerId"=${job.sellerId}::uuid AND i."url"=${job.sourceUrl} RETURNING i."productId"`
        if (changed.length > 0)
          await tx.searchOutbox.createMany({
            data: [...new Set(changed.map((row) => row.productId))].map((productId) => ({
              productId,
              kind: 'UPSERT',
            })),
          })
      }
      await tx.$executeRaw`UPDATE "ThumbnailPool" SET "token"=NULL,"leaseUntil"=NULL WHERE "token"=${job.token}::uuid`
    })
  }
}
