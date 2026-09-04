import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  ProductBulkStatusRequest,
  ProductBulkStatusResponse,
  ProductResponse,
  ProductStatus,
  SellerProductListItem,
  SellerProductListQuery,
  SellerProductListResponse,
  SellerVariantListResponse,
  StockAdjustRequest,
  StockAdjustResponse,
} from '@shopping/shared'
import { PRODUCT_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { accessDenied, assertResourceAccess } from '../auth/access-denied.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { StockService } from '../stock/stock.service.js'
import { ProductService } from './product.service.js'
import { duplicateRequest } from './product-duplicate.js'
import { isLowStock, nameSearchPattern, stockBoundsOf } from './seller-product-filters.js'
import { assertStoreMayWrite } from './store-write-gate.js'

/** One row of the console's list, before the badge is decided. */
interface ListRow {
  readonly id: string
  readonly name: string
  readonly status: ProductStatus
  readonly categoryId: number
  readonly minPrice: number | null
  readonly totalStock: number
  readonly thumbnailUrl: string | null
}

/** One row of the console's stock table, as the query returns it. */
interface VariantRow {
  readonly id: string
  readonly sku: string
  readonly optionLabel: string
  readonly stock: number
  readonly maxPurchaseQuantity: number | null
  readonly isActive: boolean
}

/**
 * The seller console's view of its own catalogue (TASK-0115).
 *
 * Separate from {@link ProductService}, which owns the *writes* — the row lock,
 * the optimistic lock, the combination plan, the derived `minPrice`. What lives
 * here is what a person managing a store asks for and nothing else, and the two
 * kinds of code have genuinely different shapes: everything below is one
 * statement that answers a question, while everything there is a transaction
 * that has to survive a race.
 *
 * Three rules run through it.
 *
 * **Always the caller's own store.** These routes take no `sellerId`, and a
 * principal without one is refused even if their grants say `any`. That is not
 * a narrowing of the permission — `GET /products?sellerId=` (TASK-0032) is
 * where an operator reads somebody else's catalogue — it is what makes
 * `/seller/` mean something.
 *
 * **A listing's aggregates cost no extra statement.** Total stock and the
 * thumbnail come from lateral joins in the listing query itself, so a page of
 * a hundred costs what a page of five costs (gate A5). Loading the variants to
 * add them up is the exact failure TASK-0035 R1 named.
 *
 * **Stock is never written here.** A movement goes to `StockService`, which is
 * the only thing in the repository that touches `ProductVariant.stock`
 * (`test/db/stock-single-path.spec.ts`). This service decides *who may* record
 * one; the ledger decides what happens.
 */
@Injectable()
export class SellerProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductService,
    private readonly stock: StockService,
  ) {}

  /**
   * A page of the caller's own listings, newest first.
   *
   * One statement whatever the page holds. The stock filter compares against
   * the lateral join's own output — which a `WHERE` may do, because joins are
   * resolved before it — so "품절인 것만" is still one round trip and still
   * pages correctly, rather than a page that was filtered after it was cut.
   *
   * Ordering is `id DESC` and the cursor is the last id, which works only
   * because product ids are UUIDv7 and therefore already in creation order
   * (the same device `ProductService.list` uses).
   */
  async list(
    principal: RequestPrincipal,
    query: SellerProductListQuery,
  ): Promise<SellerProductListResponse> {
    const sellerId = this.ownStore(principal, 'product.read')
    const limit = query.limit ?? PRODUCT_LIST_DEFAULT_LIMIT
    const rows = await this.rows(sellerId, query, limit + 1)
    // One row past the page is what says whether there is a next one, without a
    // `count(*)` over a table that keeps growing.
    const page = rows.slice(0, limit)

    return {
      items: page.map(toItem),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * Every live variant of one listing, with its combination spelled out.
   *
   * Two statements and not one per variant: the ownership read, then the table.
   * The label is assembled by a lateral join in axis order, because asking per
   * variant is precisely the N+1 the list was split up to avoid — and a listing
   * may carry two hundred combinations.
   *
   * Unpaged, for the same reason: `PRODUCT_MAX_VARIANTS` bounds it.
   */
  async variants(
    principal: RequestPrincipal,
    productId: string,
  ): Promise<SellerVariantListResponse> {
    await this.assertOwnProduct(principal, productId, 'product.read')

    const rows = await this.prisma.$queryRaw<VariantRow[]>`
      SELECT v."id", v."sku", v."stock", v."maxPurchaseQuantity", v."isActive",
             COALESCE(c."label", '') AS "optionLabel"
        FROM "ProductVariant" v
        LEFT JOIN LATERAL (
          SELECT string_agg(ov."value", ' / ' ORDER BY o."sortOrder", o."id") AS "label"
            FROM "VariantOptionValue" m
            JOIN "ProductOptionValue" ov ON ov."id" = m."optionValueId"
            JOIN "ProductOption" o ON o."id" = m."optionId"
           WHERE m."variantId" = v."id"
        ) c ON true
       WHERE v."productId" = ${productId}::uuid AND v."deletedAt" IS NULL
       ORDER BY v."id"
    `

    return {
      variants: rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        optionLabel: row.optionLabel,
        stock: row.stock,
        isLowStock: isLowStock(row.stock),
        maxPurchaseQuantity: row.maxPurchaseQuantity,
        isActive: row.isActive,
      })),
    }
  }

  /**
   * Records one movement against a variant's stock.
   *
   * Everything about the movement itself — the row lock, the position, the
   * balance, the refusal when there is not enough — is TASK-0036's, and this
   * method adds exactly two things: *may this caller move this variant's
   * stock*, and the shape of the answer. Nothing here writes the column, which
   * is what keeps the ledger the only explanation of it (F8).
   *
   * The store's state gate applies, so a `SUSPENDED` seller is refused with
   * `PRODUCT_SELLER_INACTIVE` while their list still answers 200 (F10).
   */
  async adjust(
    principal: RequestPrincipal,
    variantId: string,
    input: StockAdjustRequest,
  ): Promise<StockAdjustResponse> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        product: { select: { seller: { select: { ...sellerOwnershipSelect, status: true } } } },
      },
    })

    if (variant === null) throw new NotFoundException('상품 옵션을 찾을 수 없습니다.')

    const seller = variant.product.seller

    assertResourceAccess(principal, 'product.write', sellerOwnership(seller))
    assertStoreMayWrite(principal, seller)

    const entry = await this.stock.adjust({
      variantId: variant.id,
      type: input.type,
      // A delta, straight through. The service refuses zero, refuses a sign the
      // type does not admit, and refuses an `ADJUST` with no reason — every one
      // of them naming the field it is about.
      quantity: input.delta,
      reason: input.reason ?? null,
      actorId: principal.userId,
    })

    return {
      variantId: variant.id,
      delta: entry.quantity,
      balanceAfter: entry.balanceAfter,
      seq: entry.seq,
    }
  }

  /**
   * Takes several listings off sale, or puts them back.
   *
   * The transaction is {@link ProductService.changeStatuses}'s; what happens
   * here is the read that follows it, so the console gets the rows in the shape
   * it already draws instead of re-fetching the page.
   */
  async changeStatuses(
    principal: RequestPrincipal,
    input: ProductBulkStatusRequest,
  ): Promise<ProductBulkStatusResponse> {
    const sellerId = this.ownStore(principal, 'product.write')
    const changed = await this.products.changeStatuses(principal, input)
    const rows = await this.rows(sellerId, {}, changed.length, [...changed])

    return { items: rows.map(toItem) }
  }

  /**
   * Copies a listing as a `DRAFT` with no stock.
   *
   * The copy is assembled as a create **request** and handed to the write path
   * every other listing takes ({@link duplicateRequest} says why at length).
   * So the category's attributes are revalidated, another store's images are
   * still refused, the combinations are expanded by the planner, the SKUs are
   * issued by the generator, and `minPrice` is derived — none of it written
   * twice.
   *
   * Refused for a listing that is not the caller's, and refused for a store
   * whose state may not write: `create` applies both gates itself, and the
   * check here is about the **source** rather than the destination. Without it
   * a caller who may read a listing they do not own could copy it into their
   * own store.
   */
  async duplicate(principal: RequestPrincipal, productId: string): Promise<ProductResponse> {
    await this.assertOwnProduct(principal, productId, 'product.write')

    const { product } = await this.products.get(principal, productId)

    return this.products.create(principal, duplicateRequest(product))
  }

  // ------------------------------------------------------------- internals

  /**
   * The listing rows, with their aggregates, in one statement.
   *
   * Shared by the list and by the answer to a bulk status change, so the two
   * cannot describe a row differently. `ids` narrows it to a known set; the
   * filters are ignored in that case because the caller already named the rows.
   */
  private rows(
    sellerId: string,
    query: SellerProductListQuery,
    take: number,
    ids: string[] | null = null,
  ): Promise<ListRow[]> {
    const bounds = stockBoundsOf(query.stock)
    const pattern = nameSearchPattern(query.q)
    const categoryId = query.categoryId ?? null
    const status = query.status ?? null
    const cursor = query.cursor ?? null

    return this.prisma.$queryRaw<ListRow[]>`
      SELECT p."id", p."name", p."status", p."categoryId", p."minPrice",
             v."totalStock", i."url" AS "thumbnailUrl"
        FROM "Product" p
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum("stock"), 0)::int AS "totalStock"
            FROM "ProductVariant"
           WHERE "productId" = p."id" AND "deletedAt" IS NULL
        ) v ON true
        LEFT JOIN LATERAL (
          SELECT "url" FROM "ProductImage"
           WHERE "productId" = p."id"
           ORDER BY "sortOrder", "id"
           LIMIT 1
        ) i ON true
       WHERE p."deletedAt" IS NULL
         AND p."sellerId" = ${sellerId}::uuid
         AND (${ids}::uuid[] IS NULL OR p."id" = ANY (${ids}::uuid[]))
         AND (${categoryId}::int IS NULL OR p."categoryId" = ${categoryId}::int)
         AND (${status}::"ProductStatus" IS NULL OR p."status" = ${status}::"ProductStatus")
         AND (${bounds.min}::int IS NULL OR v."totalStock" >= ${bounds.min}::int)
         AND (${bounds.max}::int IS NULL OR v."totalStock" <= ${bounds.max}::int)
         AND (${pattern}::text IS NULL OR p."name" ILIKE ${pattern}::text ESCAPE '\\')
         AND (${cursor}::uuid IS NULL OR p."id" < ${cursor}::uuid)
       ORDER BY p."id" DESC
       LIMIT ${take}::int
    `
  }

  /**
   * The caller's store, or a 403.
   *
   * `out_of_scope` and not `missing_permission`: the grant is there, it simply
   * has no store to resolve against — which is the state an operator calling a
   * console route is in.
   */
  private ownStore(
    principal: RequestPrincipal,
    permission: 'product.read' | 'product.write',
  ): string {
    if (principal.sellerId === null) throw accessDenied(permission, 'out_of_scope')

    return principal.sellerId
  }

  /** Refuses unless the listing exists and the caller may act on it. */
  private async assertOwnProduct(
    principal: RequestPrincipal,
    productId: string,
    permission: 'product.read' | 'product.write',
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { seller: { select: sellerOwnershipSelect } },
    })

    if (product === null) throw new NotFoundException('상품을 찾을 수 없습니다.')

    assertResourceAccess(principal, permission, sellerOwnership(product.seller))
  }
}

/** One stored row, with the badge the server decides (TASK-0115 4장). */
function toItem(row: ListRow): SellerProductListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    categoryId: row.categoryId,
    totalStock: row.totalStock,
    minPrice: row.minPrice,
    isLowStock: isLowStock(row.totalStock),
    thumbnailUrl: row.thumbnailUrl,
  }
}
