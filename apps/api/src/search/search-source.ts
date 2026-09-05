import type { AttributeValue } from '@shopping/shared'

import type { PrismaService } from '../prisma/prisma.service.js'
import type { ProductSource } from './search-document.js'

/** The row shape the query below returns. */
interface SourceRow {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly status: string
  readonly sellerId: string
  readonly brandName: string
  readonly categoryId: number
  readonly categoryPath: readonly string[] | null
  readonly categoryIds: readonly number[] | null
  readonly minPrice: number | null
  readonly ratingAvg: number
  readonly ratingCount: number
  readonly salesCount: number
  readonly attributes: unknown
  readonly totalStock: bigint | number | null
  readonly thumbnailUrl: string | null
  readonly createdAt: Date
}

/**
 * Everything one document needs, in **one** query however many listings are
 * asked for (gate A5).
 *
 * The three things a document needs that the product row does not carry are all
 * subqueries rather than joins: the category lineage is a `LIKE` over the
 * materialised path, the stock is a sum over live combinations, and the
 * thumbnail is the first image. Joining them would multiply the row out and make
 * the aggregate wrong in a way that only shows up for listings with several
 * images.
 */
const SOURCE_SQL = `
  SELECT p."id",
         p."name",
         p."description",
         p."status"::text                                  AS "status",
         p."sellerId",
         s."brandName",
         p."categoryId",
         (SELECT array_agg(a."name" ORDER BY length(a."path"))
            FROM "Category" a
           WHERE c."path" LIKE a."path" || '%')            AS "categoryPath",
         -- The same lineage as ids. It is what makes 「하위 포함」 a filter rather
         -- than a second query: a document tagged with every ancestor answers
         -- 「이 가지 아래 전부」 with one equality (TASK-0042 4.1).
         (SELECT array_agg(a."id" ORDER BY length(a."path"))
            FROM "Category" a
           WHERE c."path" LIKE a."path" || '%')            AS "categoryIds",
         p."minPrice",
         p."ratingAvg",
         p."ratingCount",
         p."salesCount",
         p."attributes",
         COALESCE((SELECT sum(v."stock")
                     FROM "ProductVariant" v
                    WHERE v."productId" = p."id"
                      AND v."deletedAt" IS NULL
                      AND v."isActive"), 0)                AS "totalStock",
         (SELECT i."url"
            FROM "ProductImage" i
           WHERE i."productId" = p."id"
           ORDER BY i."sortOrder" ASC
           LIMIT 1)                                        AS "thumbnailUrl",
         p."createdAt"
    FROM "Product" p
    JOIN "Seller" s ON s."id" = p."sellerId"
    JOIN "Category" c ON c."id" = p."categoryId"
`

function attributesOf(value: unknown): Readonly<Record<string, AttributeValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, AttributeValue>>)
    : {}
}

function toSource(row: SourceRow): ProductSource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    sellerId: row.sellerId,
    brandName: row.brandName,
    categoryId: row.categoryId,
    categoryPath: row.categoryPath ?? [],
    categoryIds: row.categoryIds ?? [],
    minPrice: row.minPrice,
    ratingAvg: row.ratingAvg,
    ratingCount: row.ratingCount,
    salesCount: row.salesCount,
    attributes: attributesOf(row.attributes),
    totalStock: Number(row.totalStock ?? 0),
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt,
  }
}

/** The listings named, whatever their status — the caller decides what to do. */
export async function readSources(
  prisma: PrismaService,
  ids: readonly string[],
): Promise<readonly ProductSource[]> {
  if (ids.length === 0) return []

  const rows = await prisma.$queryRawUnsafe<SourceRow[]>(
    `${SOURCE_SQL} WHERE p."id" = ANY($1::uuid[]) AND p."deletedAt" IS NULL`,
    [...ids],
  )

  return rows.map(toSource)
}

/** One page of everything that belongs in the index, for a full rebuild. */
export async function readIndexablePage(
  prisma: PrismaService,
  afterId: string | null,
  limit: number,
): Promise<readonly ProductSource[]> {
  // Keyset by id: an offset would renumber the remaining rows every time one is
  // published mid-rebuild, and a rebuild that skipped a listing is a listing
  // nobody can find.
  const rows =
    afterId === null
      ? await prisma.$queryRawUnsafe<SourceRow[]>(
          `${SOURCE_SQL} WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
             ORDER BY p."id" LIMIT $1`,
          limit,
        )
      : await prisma.$queryRawUnsafe<SourceRow[]>(
          `${SOURCE_SQL} WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE' AND p."id" > $1::uuid
             ORDER BY p."id" LIMIT $2`,
          afterId,
          limit,
        )

  return rows.map(toSource)
}

/** Every attribute key any indexed listing uses — the facet list (D-005). */
export async function readAttributeFacetKeys(prisma: PrismaService): Promise<readonly string[]> {
  const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `SELECT DISTINCT "key" FROM "AttributeDefinition" WHERE "deletedAt" IS NULL ORDER BY "key"`,
  )

  return rows.map((row) => row.key)
}
