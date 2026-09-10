import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import type { CartLineRow } from './order-lines.js'

type Database = Pick<PrismaClient, '$queryRaw'>
type Variant = CartLineRow['variant'] & { stock: number }
type RawVariant = Omit<Variant, 'deletedAt' | 'product'> & {
  deletedAt: string | null
  product: Omit<Variant['product'], 'deletedAt'> & { deletedAt: string | null }
}
type Line = CartLineRow & { priceAtAdded: number; variant: Variant }
type RawLine = Omit<Line, 'variant'> & { variant: RawVariant }

// Explicit fields keep this projection equivalent to VARIANT_LINE_SELECT.
const variantJson = Prisma.sql`jsonb_build_object(
  'id', v."id", 'sku', v."sku", 'price', v."price", 'stock', v."stock",
  'isActive', v."isActive", 'deletedAt', v."deletedAt" AT TIME ZONE 'UTC',
  'sellerId', v."sellerId", 'maxPurchaseQuantity', v."maxPurchaseQuantity",
  'optionValues', COALESCE((SELECT jsonb_agg(jsonb_build_object('optionValue',
    jsonb_build_object('value', ov."value", 'optionId', ov."optionId")) ORDER BY ov."optionId")
    FROM "VariantOptionValue" map JOIN "ProductOptionValue" ov ON ov."id" = map."optionValueId"
    WHERE map."variantId" = v."id"), '[]'::jsonb),
  'product', jsonb_build_object(
    'id', p."id", 'name', p."name", 'status', p."status",
    'deletedAt', p."deletedAt" AT TIME ZONE 'UTC', 'maxPurchaseQuantity', p."maxPurchaseQuantity",
    'category', jsonb_build_object('path', category."path"),
    'images', COALESCE((SELECT jsonb_agg(jsonb_build_object('url', first_image."url")) FROM
      (SELECT image."url" FROM "ProductImage" image WHERE image."productId" = p."id"
       ORDER BY image."sortOrder", image."id" LIMIT 1) first_image), '[]'::jsonb),
    'options', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', option."id", 'sortOrder', option."sortOrder") ORDER BY option."id")
      FROM "ProductOption" option WHERE option."productId" = p."id"), '[]'::jsonb),
    'seller', jsonb_build_object('id', seller."id", 'brandName', seller."brandName",
      'shippingFee', seller."shippingFee", 'freeShippingThreshold', seller."freeShippingThreshold")
  ))`
const productJoins = Prisma.sql`
  JOIN "Product" p ON p."id" = v."productId"
  JOIN "Category" category ON category."id" = p."categoryId"
  JOIN "Seller" seller ON seller."id" = p."sellerId"
`
function decode(variant: RawVariant): Variant {
  return {
    ...variant,
    deletedAt: variant.deletedAt === null ? null : new Date(variant.deletedAt),
    product: {
      ...variant.product,
      deletedAt: variant.product.deletedAt === null ? null : new Date(variant.product.deletedAt),
    },
  }
}

/** Scope and item selection stay in SQL; an empty selection never means all items. */
export async function cartLines(
  db: Database,
  userId: string,
  itemIds?: readonly string[],
): Promise<Line[]> {
  if (itemIds?.length === 0) return []
  const selected =
    itemIds === undefined
      ? Prisma.empty
      : Prisma.sql`AND item."id" IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})`
  const rows = await db.$queryRaw<RawLine[]>`
    SELECT item."id", item."quantity", item."updatedAt", item."priceAtAdded", ${variantJson} AS variant
      FROM "CartItem" item JOIN "Cart" cart ON cart."id" = item."cartId"
      JOIN "ProductVariant" v ON v."id" = item."variantId" ${productJoins}
     WHERE cart."userId" = ${userId}::uuid ${selected}
     ORDER BY item."createdAt", item."id"
  `
  return rows.map((row) => ({ ...row, variant: decode(row.variant) }))
}

export async function heldLines(db: Database, checkoutId: string) {
  const rows = await db.$queryRaw<
    (Omit<RawLine, 'priceAtAdded'> & { userId: string; expiresAt: Date })[]
  >`
    SELECT hold."id", hold."quantity", hold."userId", hold."expiresAt", ${variantJson} AS variant
      FROM "StockReservation" hold JOIN "ProductVariant" v ON v."id" = hold."variantId" ${productJoins}
     WHERE hold."checkoutId" = ${checkoutId}::uuid AND hold."status" = 'HELD'
     ORDER BY hold."id"
  `
  return rows.map((row) => ({ ...row, variant: decode(row.variant) }))
}

export async function variantsForLines(db: Database, ids: readonly string[]): Promise<Variant[]> {
  if (ids.length === 0) return []
  const rows = await db.$queryRaw<{ variant: RawVariant }[]>`
    SELECT ${variantJson} AS variant FROM "ProductVariant" v ${productJoins}
     WHERE v."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
  `
  return rows.map((row) => decode(row.variant))
}
