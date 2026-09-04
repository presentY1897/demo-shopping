import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  AttributeValues,
  CreateProductRequest,
  DomainErrorCode,
  OptionValueMeta,
  Product,
  ProductListQuery,
  ProductListResponse,
  ProductResponse,
  ProductStatus,
  ProductSummary,
  ResourceOwnership,
  SellerStatus,
  UpdateProductRequest,
  VariantDefaults,
} from '@shopping/shared'
import {
  authorizeResource,
  grantedScopes,
  PRODUCT_LIST_DEFAULT_LIMIT,
  PRODUCT_MAX_VARIANTS,
} from '@shopping/shared'

import { accessDenied, assertResourceAccess } from '../auth/access-denied.js'
import type { SellerRow } from '../auth/resource-ownership.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { DomainFailurePayload } from '../common/domain-failure.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { sellerInactiveMessage } from '../sellers/seller-access.js'
import { sellerStatusAllows } from '../sellers/seller-status.js'
import { StockService } from '../stock/stock.service.js'
import type { AttributeIssue, AttributeRule } from './attribute-schema.js'
import { validateAttributeValues, withoutRequired } from './attribute-schema.js'
import { AttributeService } from './attribute.service.js'
import { foreignImageIndexes } from './product-image-keys.js'
import { defaultSkuPrefix, generatedSku } from './product-sku.js'
import type { AxisInput, PlanIssue, PlanIssueCode, VariantPlan } from './variant-rules.js'
import { optionSignatureOf, planVariants, resolvePurchaseLimit } from './variant-rules.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** Anything that can run a query: the client itself or a transaction. */
type Client = Tx | PrismaService

/** SQLSTATE of a unique violation: SKU, combination, option name, option value. */
const UNIQUE_VIOLATION = '23505'

/**
 * The SQLSTATE behind a failed query, if there is one.
 *
 * Prisma reports a raw-query failure as `P2010` and keeps the database's own
 * answer in the driver adapter's cause; a typed write surfaces the same
 * violation as `P2002`. Reading the message instead would break the first time
 * a locale or a version changes it.
 */
function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined
  if (error.code === 'P2002') return UNIQUE_VIOLATION

  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } })
    .driverAdapterError?.cause?.originalCode

  return typeof cause === 'string' ? cause : undefined
}

/**
 * What a refusal about the combination plan says, in the reader's language.
 *
 * A total record rather than a `switch`: adding a code to `variant-rules.ts`
 * without a sentence here stops compiling, which is the only way a new refusal
 * cannot reach a person as a blank message.
 */
const PLAN_ISSUE_MESSAGE: Readonly<Record<PlanIssueCode, string>> = {
  duplicate_option: '같은 이름의 옵션이 두 번 있어요.',
  duplicate_option_value: '같은 옵션 값이 두 번 있어요.',
  too_many_variants: `옵션 조합이 너무 많아요. 최대 ${String(PRODUCT_MAX_VARIANTS)}개까지 만들 수 있어요.`,
  combination_arity: '옵션 값을 옵션 수만큼, 옵션 순서대로 지정해 주세요.',
  unknown_combination: '이 상품에 없는 옵션 조합이에요.',
  duplicate_combination: '같은 옵션 조합을 두 번 지정했어요.',
}

/** One `details[]` entry, in the shape `AllExceptionsFilter` forwards. */
interface FieldIssue {
  readonly field: string
  readonly message: string
}

/**
 * A 400 that names the inputs it is about.
 *
 * `INVALID` stays on the `details` entries and off the envelope, which is what
 * `docs/design/error-contract.md` 2.2 asks for: on the envelope it would say
 * nothing a 400 does not already say. The product-specific codes below are the
 * opposite case — each one changes what the screen *does* — and those do reach
 * the envelope.
 */
function invalid(issues: readonly FieldIssue[]): BadRequestException {
  return new BadRequestException({
    message: issues.map((issue) => ({ ...issue, code: 'INVALID' })),
  })
}

/**
 * A refusal the product domain named, about several inputs at once.
 *
 * {@link domainFailure} covers the one-field case, which is most of them. This
 * is the same envelope for a refusal that has to name every offending input —
 * all the empty required attributes together, rather than the first one
 * repeatedly.
 */
function productFailure(
  code: DomainErrorCode,
  message: string,
  issues: readonly FieldIssue[],
): DomainFailurePayload {
  return { code, message, details: issues.map((issue) => ({ ...issue, code })) }
}

/**
 * The plan's refusal, with the one case that earns a code of its own.
 *
 * Too many combinations is not a typo the caller can see in their own request —
 * it is a limit only the server knows, and the number is what the sentence
 * needs. Everything else here (a repeated axis name, a combination that does
 * not exist) is a request contradicting itself, which `INVALID` at the field
 * already says.
 */
function planRefusal(issues: readonly PlanIssue[]): BadRequestException {
  if (issues.some((issue) => issue.code === 'too_many_variants')) {
    return new BadRequestException(
      domainFailure('PRODUCT_TOO_MANY_VARIANTS', PLAN_ISSUE_MESSAGE.too_many_variants, {
        field: 'options',
        params: { max: PRODUCT_MAX_VARIANTS },
      }),
    )
  }

  return invalid(
    issues.map((issue) => ({
      field: issue.path.join('.'),
      message: PLAN_ISSUE_MESSAGE[issue.code],
    })),
  )
}

/** The product row every write reads under the row lock before deciding. */
interface LockedProduct {
  readonly id: string
  readonly sellerId: string
  readonly categoryId: number
  readonly status: ProductStatus
  readonly version: number
  readonly attributes: Prisma.JsonValue
}

/** An axis of the stored product, with the choices it currently offers. */
interface StoredAxis {
  readonly id: string
  readonly name: string
  readonly values: readonly { readonly id: string; readonly value: string }[]
}

/** What a caller may say about one combination. */
interface VariantOverride {
  readonly optionValues: readonly string[]
  readonly sku?: string
  readonly price?: number
  readonly listPrice?: number | null
  readonly stock?: number
  readonly maxPurchaseQuantity?: number | null
  readonly isActive?: boolean
}

/**
 * Products, options and variants (TASK-0032).
 *
 * Four rules run through everything below.
 *
 * **A write locks the product row first.** `SELECT … FOR UPDATE` before the
 * `version` is even read, because a product write is not one statement: it
 * rewrites variants and then derives `minPrice` from them. Two transactions
 * that interleave would each compute that minimum from a snapshot containing
 * only their own change, and the later commit would overwrite the other's price
 * cut with a value no constraint objects to (TASK-0032 4.7). The lock
 * serialises them; the `version` is what turns that serialisation into a 409
 * the loser can act on.
 *
 * **Caches are derived, never accumulated.** `minPrice` is recomputed from the
 * variants in one statement at the end of every write. An incremental update is
 * wrong the moment a price goes up, and that is the shape most stale caches
 * take (R2).
 *
 * **The database has the final say on shape.** One live SKU per seller, one
 * live variant per combination, a mapping that cannot leave its product, money
 * that cannot go negative: every one of them is a constraint in the migration.
 * The checks here exist to turn a violation into an answer that names the
 * field, not to be the thing that prevents it.
 *
 * **Attribute values go through `AttributeService`.** They live in a JSONB
 * column, so nothing else can judge them (TASK-0030 4장), and this service is
 * the only path that writes them.
 *
 * **Stock goes through `StockService`.** Not one statement here writes
 * `ProductVariant.stock`: a variant's opening balance is an `INBOUND` movement
 * and an edited level is an `ADJUST` computed under the variant's row lock
 * (TASK-0036 4.7). Without that, every product created before the ledger
 * existed would carry stock the ledger cannot explain — which is the whole
 * invariant, false from the first row.
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly attributes: AttributeService,
    private readonly stock: StockService,
  ) {}

  /**
   * A page of listings, newest first.
   *
   * One statement, whatever the page holds: the per-row facts a console shows —
   * how many variants, how much stock, which image — come from two lateral
   * joins rather than from a query per row (gate A5).
   *
   * Ordering is `id DESC` and the cursor is the last id. That works only
   * because product ids are UUIDv7 and therefore already in creation order; it
   * is why the cursor needs no `(createdAt, id)` pair to keep consistent and no
   * offset that shifts under an insert.
   */
  async list(principal: RequestPrincipal, query: ProductListQuery): Promise<ProductListResponse> {
    const scopes = grantedScopes(principal, 'product.read')

    if (scopes.length === 0) throw accessDenied('product.read', 'missing_permission')

    // A listing names no single row, so `authorizeResource` has nothing to
    // decide against; what the scopes say is whether the answer has to be
    // narrowed. A caller holding only `own` may ask about their own store and
    // about nothing else (`authorizePermission`'s contract in `@shopping/shared`).
    const own = scopes.includes('any') ? null : this.ownStore(principal, 'product.read')

    if (own !== null && query.sellerId !== undefined && query.sellerId !== own) {
      throw accessDenied('product.read', 'out_of_scope')
    }

    const sellerId = own ?? query.sellerId ?? null
    // Everything that is not on sale is visible only to somebody who could edit
    // it. Without this a buyer's `product.read:any` would list every seller's
    // drafts — the catalogue before anybody decided to publish it.
    const hidden = this.maySeeHidden(principal, sellerId)
    const limit = query.limit ?? PRODUCT_LIST_DEFAULT_LIMIT
    const categoryId = query.categoryId ?? null
    const status = query.status ?? null
    const cursor = query.cursor ?? null

    const rows = await this.prisma.$queryRaw<ProductSummary[]>`
      SELECT p."id", p."sellerId", p."categoryId", p."name", p."status", p."minPrice",
             p."ratingAvg", p."ratingCount", p."salesCount", p."version",
             v."variantCount", v."stock", i."url" AS "thumbnailUrl"
        FROM "Product" p
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "variantCount", COALESCE(sum("stock"), 0)::int AS "stock"
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
         AND (${sellerId}::uuid IS NULL OR p."sellerId" = ${sellerId}::uuid)
         AND (${categoryId}::int IS NULL OR p."categoryId" = ${categoryId}::int)
         AND (${status}::"ProductStatus" IS NULL OR p."status" = ${status}::"ProductStatus")
         AND (${hidden}::boolean OR p."status" = 'ACTIVE')
         AND (${cursor}::uuid IS NULL OR p."id" < ${cursor}::uuid)
       ORDER BY p."id" DESC
       LIMIT ${limit + 1}::int
    `

    // One row past the page is what says whether there is a next one, without a
    // `count(*)` over a table that keeps growing.
    const products = rows.slice(0, limit)

    return {
      products,
      nextCursor: rows.length > limit ? (products.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * One listing, with its gallery, axes and variants.
   *
   * A hidden product answers 404 rather than 403 for anyone who could not edit
   * it: the existence of a draft is itself the thing being kept private, and a
   * 403 would confirm it.
   */
  async get(principal: RequestPrincipal, id: string): Promise<ProductResponse> {
    assertResourceAccess(principal, 'product.read', await this.ownershipOfProduct(id))

    const product = await this.load(this.prisma, id)

    if (product.status !== 'ACTIVE' && !this.maySeeHidden(principal, product.sellerId)) {
      throw new NotFoundException('상품을 찾을 수 없습니다.')
    }

    return { product }
  }

  /**
   * Creates a listing whole: product, gallery, axes, choices and every variant.
   *
   * A product without variants has no price and no SKU, so it is not a state
   * anything downstream can use — and letting it exist would put a branch for
   * it in every reader. The variants are generated from the axes rather than
   * listed by the caller (완료 기준 F1·F2); `variants` only overrides
   * individual combinations.
   *
   * The row goes in as `DRAFT` whatever was asked for.
   * `Product_active_price_check` requires a live price before a listing may be
   * on sale, and the price is not known until the variants exist — so the
   * requested status is applied by the same statement that derives `minPrice`,
   * and no row ever exists that the constraint would have to be relaxed for.
   */
  async create(principal: RequestPrincipal, input: CreateProductRequest): Promise<ProductResponse> {
    const seller = await this.store(this.prisma, this.ownStore(principal, 'product.write'))
    const ownership = sellerOwnership(seller)
    const status = input.status ?? 'DRAFT'

    assertResourceAccess(principal, 'product.write', ownership)
    this.assertStatusChange(principal, ownership, 'DRAFT', input.status)
    this.assertStoreMayWrite(principal, seller)

    const images = input.images ?? []

    this.assertOwnImages(images, seller.id)

    const axes = axesOf(input.options)
    const plans = this.plan(axes, input.variants ?? [])
    const attributes = await this.validatedAttributes(
      input.categoryId,
      input.attributes ?? {},
      status === 'ACTIVE',
    )

    const id = await this.uniqueWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const now = this.clock.now()
        const created = await tx.product.create({
          data: {
            sellerId: seller.id,
            categoryId: input.categoryId,
            name: input.name,
            description: input.description ?? null,
            attributes,
            maxPurchaseQuantity: input.maxPurchaseQuantity ?? null,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        })

        await this.writeImages(tx, created.id, images, now)

        const stored = await this.writeAxes(tx, created.id, axes, now)

        await this.createVariants(tx, {
          productId: created.id,
          sellerId: seller.id,
          axes: stored,
          plans,
          defaults: input.variantDefaults,
          skuPrefix: input.skuPrefix ?? defaultSkuPrefix(created.id),
          skuFrom: 1,
          now,
        })

        await this.settle(tx, created.id, status, 0)

        return created.id
      }),
    )

    return { product: await this.load(this.prisma, id) }
  }

  /**
   * Edits a listing, its gallery, its choices and its variants.
   *
   * The lock comes before the `version` comparison and the comparison before
   * every write, so the transaction decides from the committed state and the
   * loser of a race gets a 409 rather than a silently discarded edit.
   *
   * `options` may change the **choices** on an axis; it may not change the
   * axes. Adding a choice creates the combinations it takes part in and
   * removing one switches those combinations off (R1) — both fall out of
   * replanning, because a removed choice simply stops producing combinations
   * and nothing here has to know which of the two happened. Changing the axes
   * would change the arity of every existing combination at once, which no
   * listing with order history can survive (TASK-0032 4.8).
   */
  async update(
    principal: RequestPrincipal,
    id: string,
    input: UpdateProductRequest,
  ): Promise<ProductResponse> {
    await this.uniqueWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const product = await this.lock(tx, id)
        const seller = await this.store(tx, product.sellerId)
        const ownership = sellerOwnership(seller)
        const status = input.status ?? product.status

        assertResourceAccess(principal, 'product.write', ownership)
        this.assertStatusChange(principal, ownership, product.status, input.status)
        this.assertStoreMayWrite(principal, seller)

        if (product.version !== input.version) {
          throw new ConflictException(
            domainFailure(
              'PRODUCT_VERSION_CONFLICT',
              '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?',
              { field: 'version' },
            ),
          )
        }

        if (input.images !== undefined) this.assertOwnImages(input.images, seller.id)

        const now = this.clock.now()
        const categoryId = input.categoryId ?? product.categoryId
        // Re-validated whenever either half of the pair changes: moving a
        // product to another category can invalidate values nobody edited, and
        // a bag no definition explains is what TASK-0030 exists to prevent.
        //
        // And whenever the result is on sale, even if nothing about the
        // attributes moved: a draft is allowed to be incomplete, so the
        // completeness check has to happen at the moment it stops being one —
        // which is a request that says only `status` (TASK-0113 4장).
        const attributes =
          input.attributes === undefined && input.categoryId === undefined && status !== 'ACTIVE'
            ? undefined
            : await this.validatedAttributes(
                categoryId,
                input.attributes ?? product.attributes,
                status === 'ACTIVE',
              )

        await tx.product.update({
          where: { id },
          data: {
            ...(input.categoryId === undefined ? {} : { categoryId }),
            ...(attributes === undefined ? {} : { attributes }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.maxPurchaseQuantity === undefined
              ? {}
              : { maxPurchaseQuantity: input.maxPurchaseQuantity }),
            updatedAt: now,
          },
        })

        if (input.images !== undefined) {
          await tx.productImage.deleteMany({ where: { productId: id } })
          await this.writeImages(tx, id, input.images, now)
        }

        await this.reviseVariants(tx, product, input, now, principal.userId)
        await this.settle(tx, id, status, 1)
      }),
    )

    return { product: await this.load(this.prisma, id) }
  }

  /**
   * Puts a listing on sale (TASK-0113).
   *
   * The same transition `update` performs for `{ status: 'ACTIVE' }`, and
   * deliberately routed through it rather than reimplemented: publishing has to
   * take the product row lock, compare the version, revalidate the attributes
   * against the category and re-derive `minPrice` under the constraint that
   * refuses a listing on sale with no price. A second path doing four of those
   * five things is how one of them ends up missing.
   *
   * It is a separate **endpoint** all the same, because the two intentions are
   * different: 저장 may leave a draft incomplete and 판매 시작 may not, and a
   * screen that sends both as one field of one request cannot tell a person
   * which of the two was refused.
   */
  publish(principal: RequestPrincipal, id: string, version: number): Promise<ProductResponse> {
    return this.update(principal, id, { version, status: 'ACTIVE' })
  }

  /**
   * Takes it back off sale, to 작성 중.
   *
   * `DRAFT` and not `INACTIVE`: 발행 취소 is the seller reopening the editor,
   * and a listing they are working on again is a draft. `INACTIVE` — 판매 중지
   * without going back to editing — stays available through `update`, which is
   * where a console's own status control sends it.
   *
   * A seller cannot use this to lift a forced hide: `assertStatusChange` refuses
   * any move out of `SUSPENDED` to a caller whose only scope is `own`, and it
   * runs inside `update` on the way through (TASK-0032 4.9).
   */
  unpublish(principal: RequestPrincipal, id: string, version: number): Promise<ProductResponse> {
    return this.update(principal, id, { version, status: 'DRAFT' })
  }

  /**
   * Retires a listing. The rows stay and the ids are never handed out again.
   *
   * Soft, and not as a convention: an order item points at a variant forever
   * (TASK-0032 4.4), so a hard delete would leave order history unable to say
   * what was bought. The variants go with it — nothing can be ordered against a
   * retired product — and the status leaves `ACTIVE`, because
   * `Product_active_price_check` will not hold a listing on sale with nothing
   * sellable behind it.
   */
  async remove(principal: RequestPrincipal, id: string): Promise<ProductResponse> {
    await this.prisma.$transaction(async (tx) => {
      const product = await this.lock(tx, id)

      assertResourceAccess(
        principal,
        'product.delete',
        sellerOwnership(await this.store(tx, product.sellerId)),
      )

      const now = this.clock.now()

      await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false, updatedAt: now },
      })
      await tx.product.update({
        where: { id },
        data: {
          deletedAt: now,
          status: 'INACTIVE',
          minPrice: null,
          version: { increment: 1 },
          updatedAt: now,
        },
      })
    })

    return { product: await this.load(this.prisma, id, { includeDeleted: true }) }
  }

  // ------------------------------------------------------------------ writes

  /** The gallery, in the order the caller listed it. */
  private async writeImages(
    tx: Tx,
    productId: string,
    images: readonly { url: string; alt?: string }[],
    now: Date,
  ): Promise<void> {
    if (images.length === 0) return

    await tx.productImage.createMany({
      data: images.map((image, index) => ({
        productId,
        url: image.url,
        alt: image.alt ?? null,
        sortOrder: index,
        createdAt: now,
      })),
    })
  }

  /**
   * Creates the axes and their choices, and reads the ids back.
   *
   * The ids are what a signature is built from, so they cannot be known before
   * this runs — which is why a create request names combinations by value, and
   * why this step is what turns those names into ids.
   */
  private async writeAxes(
    tx: Tx,
    productId: string,
    axes: readonly AxisInput[],
    now: Date,
  ): Promise<readonly StoredAxis[]> {
    if (axes.length === 0) return []

    const options = await tx.productOption.createManyAndReturn({
      data: axes.map((axis, index) => ({
        productId,
        name: axis.name,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
      select: { id: true, name: true },
    })

    const optionId = new Map(options.map((option) => [option.name, option.id]))
    const values = await tx.productOptionValue.createManyAndReturn({
      data: axes.flatMap((axis) =>
        axis.values.map((value, index) => ({
          optionId: optionId.get(axis.name) ?? '',
          value,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })),
      ),
      select: { id: true, optionId: true, value: true },
    })

    // Matched by name and by value rather than by position: `createManyAndReturn`
    // promises the rows, not their order.
    return axes.map((axis) => {
      const id = optionId.get(axis.name) ?? ''

      return {
        id,
        name: axis.name,
        values: axis.values.map((value) => ({
          id: values.find((row) => row.optionId === id && row.value === value)?.id ?? '',
          value,
        })),
      }
    })
  }

  /** Inserts one variant per plan, together with its combination mapping. */
  private async createVariants(
    tx: Tx,
    input: {
      readonly productId: string
      readonly sellerId: string
      readonly axes: readonly StoredAxis[]
      readonly plans: readonly VariantPlan<VariantOverride>[]
      readonly defaults: VariantDefaults
      readonly skuPrefix: string
      readonly skuFrom: number
      readonly now: Date
    },
  ): Promise<void> {
    if (input.plans.length === 0) return

    const combinations = input.plans.map((plan) => valueIdsOf(input.axes, plan.combination))
    // The opening balance is not part of the insert. Every variant is born at
    // zero and `StockService.open` moves it, so the quantity a seller typed and
    // the `INBOUND` that explains it are written by the same code in the same
    // transaction (TASK-0036 4.7).
    const opening = input.plans.map((plan) => plan.override?.stock ?? input.defaults.stock ?? 0)
    const rows = input.plans.map((plan, index) => {
      const override = plan.override

      return {
        productId: input.productId,
        sellerId: input.sellerId,
        sku: override?.sku ?? generatedSku(input.skuPrefix, input.skuFrom + index),
        price: override?.price ?? input.defaults.price,
        listPrice: override?.listPrice ?? input.defaults.listPrice ?? null,
        maxPurchaseQuantity:
          override?.maxPurchaseQuantity ?? input.defaults.maxPurchaseQuantity ?? null,
        isActive: override?.isActive ?? true,
        optionSignature: optionSignatureOf(combinations[index] ?? []),
        createdAt: input.now,
        updatedAt: input.now,
      }
    })

    const created = await tx.productVariant.createManyAndReturn({
      data: rows,
      select: { id: true, optionSignature: true },
    })

    const variantId = new Map(created.map((row) => [row.optionSignature, row.id]))

    await this.stock.open(
      tx,
      rows.map((row, index) => ({
        variantId: variantId.get(row.optionSignature) ?? '',
        quantity: opening[index] ?? 0,
      })),
    )
    const mappings = rows.flatMap((row, index) =>
      (combinations[index] ?? []).map((optionValueId) => ({
        variantId: variantId.get(row.optionSignature) ?? '',
        optionValueId,
        optionId: optionIdOf(input.axes, optionValueId),
        productId: input.productId,
      })),
    )

    if (mappings.length > 0) await tx.variantOptionValue.createMany({ data: mappings })
  }

  /**
   * Brings the variants in line with the axes the request describes.
   *
   * Replanning does all of it. A choice that was added produces combinations
   * with no live variant, which are created; a choice that was removed stops
   * producing its combinations, whose variants are switched off.
   */
  private async reviseVariants(
    tx: Tx,
    product: LockedProduct,
    input: UpdateProductRequest,
    now: Date,
    actorId: string,
  ): Promise<void> {
    const stored = await this.storedAxes(tx, product.id)

    if (input.options !== undefined) this.assertSameAxes(stored, input.options)

    const axes: readonly AxisInput[] =
      input.options === undefined
        ? stored.map((axis) => ({ name: axis.name, values: axis.values.map((v) => v.value) }))
        : axesOf(input.options)

    const plans = this.plan(axes, input.variants ?? [])
    const current = await this.addChoices(tx, stored, axes, now)

    await this.retireChoices(tx, stored, axes, now)

    const live = await tx.productVariant.findMany({
      where: { productId: product.id, deletedAt: null },
      select: { id: true, optionSignature: true },
    })
    const bySignature = new Map(live.map((variant) => [variant.optionSignature, variant.id]))
    const planned = new Set<string>()
    const fresh: VariantPlan<VariantOverride>[] = []

    for (const plan of plans) {
      const signature = optionSignatureOf(valueIdsOf(current, plan.combination))

      planned.add(signature)

      const existing = bySignature.get(signature)

      if (existing === undefined) {
        fresh.push(plan)
      } else if (plan.override !== undefined) {
        await tx.productVariant.update({
          where: { id: existing },
          data: { ...variantChanges(plan.override), updatedAt: now },
        })

        // An absolute level, turned into the movement that reaches it. The
        // difference is computed under the variant's row lock, so whatever sold
        // in the meantime stays in the history instead of being erased by the
        // number the seller was looking at (TASK-0036 4.7).
        if (plan.override.stock !== undefined) {
          await this.stock.setLevel(tx, {
            variantId: existing,
            level: plan.override.stock,
            actorId,
          })
        }
      }
    }

    await this.appendVariants(tx, product, input, { axes: current, plans: fresh, now })

    // Combinations that no longer exist. Deactivated rather than deleted: the
    // row is what an order placed yesterday points at (R1).
    const orphaned = live.filter((variant) => !planned.has(variant.optionSignature))

    if (orphaned.length > 0) {
      await tx.productVariant.updateMany({
        where: { id: { in: orphaned.map((variant) => variant.id) } },
        data: { isActive: false, updatedAt: now },
      })
    }
  }

  /** Creates the combinations an added choice brought into existence. */
  private async appendVariants(
    tx: Tx,
    product: LockedProduct,
    input: UpdateProductRequest,
    fresh: {
      readonly axes: readonly StoredAxis[]
      readonly plans: readonly VariantPlan<VariantOverride>[]
      readonly now: Date
    },
  ): Promise<void> {
    if (fresh.plans.length === 0) return

    if (input.variantDefaults === undefined) {
      throw invalid([
        { field: 'variantDefaults', message: '새로 만들어지는 옵션 조합의 기본 가격이 필요해요.' },
      ])
    }

    // Numbered past every variant this product has ever had, retired ones
    // included: a generated SKU that reused a retired number would collide with
    // a row the seller can still see in their history.
    const issued = await tx.productVariant.count({ where: { productId: product.id } })

    await this.createVariants(tx, {
      productId: product.id,
      sellerId: product.sellerId,
      axes: fresh.axes,
      plans: fresh.plans,
      defaults: input.variantDefaults,
      skuPrefix: input.skuPrefix ?? defaultSkuPrefix(product.id),
      skuFrom: issued + 1,
      now: fresh.now,
    })
  }

  /** Inserts the choices the request added, and answers with the axes as they now are. */
  private async addChoices(
    tx: Tx,
    stored: readonly StoredAxis[],
    axes: readonly AxisInput[],
    now: Date,
  ): Promise<readonly StoredAxis[]> {
    const additions = stored.flatMap((axis, index) =>
      (axes[index]?.values ?? [])
        .filter((value) => !axis.values.some((existing) => existing.value === value))
        .map((value, offset) => ({
          optionId: axis.id,
          value,
          sortOrder: axis.values.length + offset,
          createdAt: now,
          updatedAt: now,
        })),
    )

    if (additions.length === 0) return stored

    const created = await tx.productOptionValue.createManyAndReturn({
      data: additions,
      select: { id: true, optionId: true, value: true },
    })

    return stored.map((axis) => ({
      ...axis,
      values: [
        ...axis.values,
        ...created
          .filter((row) => row.optionId === axis.id)
          .map((row) => ({ id: row.id, value: row.value })),
      ],
    }))
  }

  /**
   * Retires the choices the request dropped.
   *
   * Per axis, not against the union of every axis's values: two axes may offer
   * the same label — 색상 `F` and 사이즈 `F` — and a union would let one of them
   * keep the other alive.
   *
   * Soft, like everything a combination is built from: the variants that used
   * the choice are only deactivated, and an order that already names one has to
   * stay able to say what 블랙 was.
   */
  private async retireChoices(
    tx: Tx,
    stored: readonly StoredAxis[],
    axes: readonly AxisInput[],
    now: Date,
  ): Promise<void> {
    const retired = stored.flatMap((axis, index) => {
      const kept = new Set(axes[index]?.values ?? [])

      return axis.values.filter((value) => !kept.has(value.value)).map((value) => value.id)
    })

    if (retired.length === 0) return

    await tx.productOptionValue.updateMany({
      where: { id: { in: retired } },
      data: { deletedAt: now, updatedAt: now },
    })
  }

  /**
   * Writes the derived cache and the requested status, in one statement.
   *
   * `minPrice` is computed **from** the variants rather than adjusted towards
   * them, so no arithmetic can drift: after this statement the value is the
   * minimum of what is orderable, whatever happened before (TASK-0032 4.6).
   *
   * The `ACTIVE` case is refused first, with a sentence. The constraint would
   * refuse it too — that is what it is for — but a caller deserves to be told
   * what to do rather than handed a constraint name.
   */
  private async settle(
    tx: Tx,
    productId: string,
    status: ProductStatus,
    versionIncrement: number,
  ): Promise<void> {
    if (status === 'ACTIVE') {
      const sellable = await tx.productVariant.count({
        where: { productId, deletedAt: null, isActive: true },
      })

      if (sellable === 0) {
        throw new BadRequestException(
          domainFailure(
            'PRODUCT_NOT_SELLABLE',
            '판매하려면 주문할 수 있는 옵션이 하나는 있어야 해요.',
            { field: 'status' },
          ),
        )
      }
    }

    await tx.$executeRaw`
      UPDATE "Product" p
         SET "minPrice"  = (SELECT min(v."price") FROM "ProductVariant" v
                             WHERE v."productId" = p."id"
                               AND v."deletedAt" IS NULL
                               AND v."isActive"),
             "status"    = ${status}::"ProductStatus",
             "version"   = p."version" + ${versionIncrement}::int,
             "updatedAt" = ${this.nowSql()}
       WHERE p."id" = ${productId}::uuid
    `
  }

  // ------------------------------------------------------------------- reads

  /** The product row, locked, before anything is decided from it. */
  private async lock(tx: Tx, id: string): Promise<LockedProduct> {
    const rows = await tx.$queryRaw<LockedProduct[]>`
      SELECT "id", "sellerId", "categoryId", "status", "version", "attributes"
        FROM "Product"
       WHERE "id" = ${id}::uuid AND "deletedAt" IS NULL
         FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('상품을 찾을 수 없습니다.')

    return row
  }

  /** The axes as stored, with their live choices in display order. */
  private async storedAxes(tx: Tx, productId: string): Promise<readonly StoredAxis[]> {
    return tx.productOption.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        values: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, value: true },
        },
      },
    })
  }

  /**
   * The whole listing, assembled.
   *
   * A fixed number of statements whatever its size: Prisma reads the product
   * and then each relation with one `IN` query, so a product with twelve
   * variants costs what a product with one costs (gate A5).
   */
  private async load(
    client: Client,
    id: string,
    options: { readonly includeDeleted?: boolean } = {},
  ): Promise<Product> {
    const row = await client.product.findFirst({
      where: { id, ...(options.includeDeleted === true ? {} : { deletedAt: null }) },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        options: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            values: {
              where: { deletedAt: null },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
        },
        variants: {
          where: { deletedAt: null },
          orderBy: { id: 'asc' },
          include: { optionValues: { select: { optionValueId: true } } },
        },
      },
    })

    if (row === null) throw new NotFoundException('상품을 찾을 수 없습니다.')

    return {
      id: row.id,
      sellerId: row.sellerId,
      categoryId: row.categoryId,
      name: row.name,
      description: row.description,
      status: row.status,
      attributes: row.attributes as unknown as AttributeValues,
      maxPurchaseQuantity: row.maxPurchaseQuantity,
      minPrice: row.minPrice,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      salesCount: row.salesCount,
      version: row.version,
      images: row.images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder,
      })),
      options: row.options.map((option) => ({
        id: option.id,
        name: option.name,
        sortOrder: option.sortOrder,
        values: option.values.map((value) => ({
          id: value.id,
          value: value.value,
          meta: value.meta as unknown as OptionValueMeta | null,
          sortOrder: value.sortOrder,
        })),
      })),
      variants: row.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        price: variant.price,
        listPrice: variant.listPrice,
        stock: variant.stock,
        maxPurchaseQuantity: variant.maxPurchaseQuantity,
        // Resolved here rather than by each of the four places that enforce it
        // (TASK-0045 · 0050 · 0048 · 0049).
        effectiveMaxPurchaseQuantity: resolvePurchaseLimit(
          row.maxPurchaseQuantity,
          variant.maxPurchaseQuantity,
        ),
        isActive: variant.isActive,
        optionValueIds: variant.optionValues.map((entry) => entry.optionValueId),
      })),
    }
  }

  /**
   * The store a row belongs to, for the permission layer and for its own state.
   *
   * `status` is typed as the shared union rather than `string`: it is read by
   * TASK-0108's capability table, and a widened type there would make a status
   * the table has no cell for compile.
   */
  private async store(
    client: Client,
    sellerId: string,
  ): Promise<SellerRow & { status: SellerStatus }> {
    const seller = await client.seller.findUnique({
      where: { id: sellerId },
      select: { ...sellerOwnershipSelect, status: true },
    })

    if (seller === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    return seller
  }

  /** Ownership of one product, or a 404 when there is no such row. */
  private async ownershipOfProduct(id: string): Promise<ResourceOwnership> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { seller: { select: sellerOwnershipSelect } },
    })

    if (product === null) throw new NotFoundException('상품을 찾을 수 없습니다.')

    return sellerOwnership(product.seller)
  }

  // -------------------------------------------------------------- decisions

  /** The caller's own store. Selling needs somewhere to sell. */
  private ownStore(
    principal: RequestPrincipal,
    permission: 'product.read' | 'product.write',
  ): string {
    if (principal.sellerId === null) throw accessDenied(permission, 'out_of_scope')

    return principal.sellerId
  }

  /**
   * Whether this caller may see a listing that is not on sale.
   *
   * The owning seller, and anyone holding `product.write` at `any` — the
   * operator. A demo administrator's `demo`-scoped write does not widen a
   * listing, because a listing names no row for that scope to be resolved
   * against; they still reach every hidden product they can act on by asking
   * for it by id.
   */
  private maySeeHidden(principal: RequestPrincipal, sellerId: string | null): boolean {
    if (sellerId !== null && principal.sellerId === sellerId) return true

    return grantedScopes(principal, 'product.write').includes('any')
  }

  /**
   * Guards the operator's forced hide (TASK-0032 4.9).
   *
   * Moving a listing into or out of `SUSPENDED` requires holding
   * `product.write` at a scope wider than `own`. A seller holds exactly
   * `product.write:own`, so they are refused — which is what makes a forced
   * hide forced. An operator's `any` passes, and a demo administrator's `demo`
   * passes for a demo-created store, so the admin console does not become a
   * read-only shell for the visitor trying it (DECISIONS 2).
   *
   * Expressed as a scope rather than a new `product.suspend` permission: the
   * permission list and its generated matrix live in `packages/shared`, and
   * adding one there is a change to the authorization table itself.
   */
  private assertStatusChange(
    principal: RequestPrincipal,
    ownership: ResourceOwnership,
    current: ProductStatus,
    requested: ProductStatus | undefined,
  ): void {
    if (requested === undefined || requested === current) return
    if (requested !== 'SUSPENDED' && current !== 'SUSPENDED') return

    const decision = authorizeResource(principal, 'product.write', ownership)

    if (!decision.allowed) throw accessDenied('product.write', decision.reason)
    if (decision.scopes.every((scope) => scope === 'own')) {
      throw accessDenied('product.write', 'out_of_scope')
    }
  }

  /**
   * The store's own state gate (TASK-0108 4장), with a code a console can read.
   *
   * **Only when the caller is the store.** "지금 이 스토어가 상품을 등록할 수
   * 있는 상태인가" is a question about the seller acting on their own listing;
   * an operator editing somebody's product is not that store trading, and
   * refusing them would make a suspended store's catalogue unmanageable by the
   * very people who suspended it.
   *
   * **Why not `assertSellerActive` itself.** The decision is not repeated here —
   * the table it consults and the sentence it words are both imported from
   * TASK-0108's module, and a spec pins this to refuse in exactly the cells
   * `assertSellerActive` refuses in. What it adds is the domain code: that
   * function throws a bare `FORBIDDEN`, which a screen cannot tell from "this is
   * not your product" — and those two 403s need opposite advice. Giving it a
   * code would mean editing a file this task does not own, for a payload only
   * this caller needs.
   *
   * **403 and not 409**, which is where TASK-0032 had it. A 409 says "try again
   * once this resolves", and a seller whose application is still pending has
   * nothing to retry — the state is not a transient collision, it is the
   * platform saying no for now (TASK-0026 F3 · TASK-0108 F3).
   */
  private assertStoreMayWrite(
    principal: RequestPrincipal,
    seller: { readonly id: string; readonly status: SellerStatus },
  ): void {
    if (principal.sellerId !== seller.id) return
    if (sellerStatusAllows(seller.status, 'product.write')) return

    throw new ForbiddenException(
      domainFailure(
        'PRODUCT_SELLER_INACTIVE',
        sellerInactiveMessage(seller.status, 'product.write'),
      ),
    )
  }

  /**
   * Refuses a gallery that points into another store's prefix (TASK-0113 4장).
   *
   * The orphan sweep TASK-0033 F6 handed over enumerates by prefix — everything
   * under `products/{sellerId}/` that no live `ProductImage` names is rubbish
   * and gets deleted. That is only true while a store's objects are referenced
   * by that store alone, and nothing enforced it: `url` is a string, and the
   * upload that produced the key is a different request from the save that
   * records it.
   *
   * A URL that is not one of our keys passes untouched. The seeded catalogue
   * uses stock photography (DECISIONS 13), no sweep will ever consider those,
   * and refusing them would make most of the demo data unsavable.
   */
  private assertOwnImages(images: readonly { readonly url: string }[], sellerId: string): void {
    const foreign = foreignImageIndexes(images, sellerId)

    if (foreign.length === 0) return

    throw invalid(
      foreign.map((index) => ({
        field: `images.${String(index)}.url`,
        message: '다른 스토어의 이미지는 쓸 수 없어요. 이미지를 다시 올려 주세요.',
      })),
    )
  }

  /** The combination plan, or a 400 naming every input that was wrong. */
  private plan(
    axes: readonly AxisInput[],
    overrides: readonly VariantOverride[],
  ): readonly VariantPlan<VariantOverride>[] {
    const planned = planVariants(axes, overrides, PRODUCT_MAX_VARIANTS)

    if (!planned.ok) throw planRefusal(planned.issues)

    return planned.plans
  }

  /**
   * The axes of an update must be the axes that are stored.
   *
   * Same count, same names, same order. Anything else changes the arity of
   * every combination the product already has (TASK-0032 4.8).
   */
  private assertSameAxes(stored: readonly StoredAxis[], given: readonly { name: string }[]): void {
    const same =
      stored.length === given.length &&
      stored.every((axis, index) => axis.name === given[index]?.name)

    if (same) return

    throw invalid([
      {
        field: 'options',
        message: '옵션 구성은 바꿀 수 없어요. 옵션 값만 추가하거나 뺄 수 있어요.',
      },
    ])
  }

  /**
   * The attribute values, judged by the definitions of their category.
   *
   * The only path that writes `Product.attributes`, because it is the only one
   * that can: the column is JSONB and the database cannot check a value in it
   * (TASK-0030 4장). A category nobody knows is a 400 about `categoryId` rather
   * than the 404 the attribute service raises — the caller named it in a body,
   * not in a URL.
   *
   * **Two passes, and the order is the design.** The rules are asked first with
   * nothing required: whatever that refuses is a value that is *wrong*, and a
   * draft may no more hold a wrong value than a published listing may
   * (TASK-0113 4장). Only if the result is going on sale are the real rules
   * applied, and the only way the second pass can fail after the first passed
   * is a required value nobody filled in — so the refusal can be named
   * `PRODUCT_ATTRIBUTES_REQUIRED` without inspecting a single message.
   *
   * The alternative was a discriminator on `AttributeIssue` telling missing
   * from malformed. That would put the same knowledge in the generator, where
   * it has no reason to be, and it would be checked by nothing: two rule sets
   * through one function cannot disagree with each other.
   */
  private async validatedAttributes(
    categoryId: number,
    values: unknown,
    requireAll: boolean,
  ): Promise<AttributeValues> {
    const rules = await this.rules(categoryId)
    const draft = validateAttributeValues(withoutRequired(rules), values)

    if (!draft.ok) throw invalid(attributeFields(draft.issues))
    if (!requireAll) return draft.values

    const complete = validateAttributeValues(rules, values)

    if (complete.ok) return complete.values

    throw new BadRequestException(
      productFailure(
        'PRODUCT_ATTRIBUTES_REQUIRED',
        '판매를 시작하려면 필수 정보를 모두 채워야 해요.',
        attributeFields(complete.issues),
      ),
    )
  }

  /** The definitions that apply, or a 400 about the category the body named. */
  private async rules(categoryId: number): Promise<readonly AttributeRule[]> {
    try {
      return await this.attributes.rulesFor(categoryId)
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error

      throw invalid([
        { field: 'categoryId', message: '선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.' },
      ])
    }
  }

  /**
   * Turns a unique violation into a 409 the caller can act on.
   *
   * Named `PRODUCT_SKU_TAKEN` rather than something vaguer, because by the time
   * a write runs the SKU index is the only one that can still raise this. A
   * repeated axis name, a repeated option value and a repeated combination are
   * all refused by `planVariants` as a 400 before anything is inserted; what is
   * left is a SKU already held by another live variant of the same store.
   *
   * Checking first and writing afterwards would be a race two concurrent
   * requests both win; the database decides and this only translates its
   * answer. It is also the 409 that re-reading does **not** fix, which is why
   * it carries a different code from the optimistic-lock one — a screen has to
   * know whether to offer "다시 불러오기" (TASK-0113 4장).
   */
  private async uniqueWrite<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (sqlStateOf(error) === UNIQUE_VIOLATION) {
        throw new ConflictException(
          domainFailure('PRODUCT_SKU_TAKEN', '이미 쓰고 있는 SKU 예요. 다른 SKU 를 입력해 주세요.'),
        )
      }
      throw error
    }
  }

  /**
   * The injected instant, as a value PostgreSQL stores the way Prisma does.
   *
   * The cast is not decoration — see the same method on `CategoryService`: `pg`
   * serialises a `Date` with the local UTC offset, and casting that straight to
   * `timestamp` would store local wall-clock time.
   */
  private nowSql(): Prisma.Sql {
    return Prisma.sql`${this.clock.now().toISOString()}::timestamptz AT TIME ZONE 'UTC'`
  }
}

/**
 * The fields an override actually changes; absent ones are left alone.
 *
 * `stock` is deliberately absent: an edited level is an `ADJUST` recorded under
 * the variant's row lock, not a column assignment (TASK-0036 4.7).
 */
function variantChanges(override: VariantOverride): Prisma.ProductVariantUpdateInput {
  return {
    ...(override.sku === undefined ? {} : { sku: override.sku }),
    ...(override.price === undefined ? {} : { price: override.price }),
    ...(override.listPrice === undefined ? {} : { listPrice: override.listPrice }),
    ...(override.maxPurchaseQuantity === undefined
      ? {}
      : { maxPurchaseQuantity: override.maxPurchaseQuantity }),
    ...(override.isActive === undefined ? {} : { isActive: override.isActive }),
  }
}

/** One `details[]` entry per refused attribute, pointing at the key. */
function attributeFields(issues: readonly AttributeIssue[]): readonly FieldIssue[] {
  return issues.map((issue) => ({
    field: issue.key === '' ? 'attributes' : `attributes.${issue.key}`,
    message: issue.message,
  }))
}

/** The request's axes, as the planner wants them. */
function axesOf(
  options: readonly { name: string; values: readonly { value: string }[] }[] | undefined,
): readonly AxisInput[] {
  return (options ?? []).map((option) => ({
    name: option.name,
    values: option.values.map((value) => value.value),
  }))
}

/** The option value ids of one combination, in axis order. */
function valueIdsOf(axes: readonly StoredAxis[], combination: readonly string[]): string[] {
  return combination.map(
    (value, index) => axes[index]?.values.find((entry) => entry.value === value)?.id ?? '',
  )
}

/** Which axis a value belongs to. */
function optionIdOf(axes: readonly StoredAxis[], optionValueId: string): string {
  return axes.find((axis) => axis.values.some((value) => value.id === optionValueId))?.id ?? ''
}
