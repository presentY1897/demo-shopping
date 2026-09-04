import type { Prisma } from '@prisma/client'

import { optionSignatureOf } from '../catalog/variant-rules.js'
import { uniqueSku } from './demo-identity.js'

/**
 * Filling a demo store from the public catalogue (TASK-0024 4.7).
 *
 * **Copied, not generated.** A store of freshly invented products has no images
 * and no attribute values, and a seller console showing twelve grey rectangles
 * is a worse demonstration than an empty one. Copying an existing listing brings
 * its pictures, its options and its stock with it, and changes only who owns it.
 *
 * Three things the copy has to get right, each of them an index rather than a
 * convention:
 *
 * | rule | index |
 * | --- | --- |
 * | a SKU is unique **within a store** | `ProductVariant_seller_sku_key` |
 * | one variant per combination | `ProductVariant_product_signature_key` |
 * | stock is explained by the ledger | L1 of TASK-0036 4.1 |
 *
 * The second is why the signature is recomputed instead of copied: it is built
 * from option value ids, and the copy has new ones. Copying the string would
 * produce variants whose signature names another product's rows — legal to the
 * index, and meaningless to every reader.
 *
 * **Reads are flat, one statement per table.** A nested `include` would have the
 * client fetch each level per product, which is the N+1 gate A5 forbids and is
 * also what makes the read the slowest part of an issue. Six statements read the
 * sources whether there is one product or twelve, and the grouping happens here.
 *
 * **Originals are read, never touched.** The demo store owns its copies, so the
 * `own` scope is the whole of what stops a visitor editing the seed catalogue
 * (R1) — no extra check is needed anywhere.
 */

/** How many listings a demo store opens with (TASK-0024 4.7). */
export const DEMO_PRODUCT_COUNT = 12

/** What the opening balance of a copied variant is recorded as. */
const OPENING_REASON = '데모 스토어를 열면서 원본 상품에서 이월된 초기 재고입니다.'

export interface CloneInput {
  readonly sellerId: string
  readonly now: Date
  readonly limit?: number
}

/** One copied option value: its new id, and the option it now hangs off. */
interface CopiedValue {
  readonly id: string
  readonly optionId: string
}

/**
 * Copies up to {@link DEMO_PRODUCT_COUNT} listings into a demo store.
 *
 * Answers how many it copied, which can be **zero** and must not be an error:
 * the seed catalogue is TASK-0037's and is not built yet, so a fresh environment
 * has nothing to copy. A visitor then gets an empty store rather than a failed
 * issue, and the same code fills it the day the catalogue exists (F2c).
 */
export async function cloneCatalogIntoDemoStore(
  tx: Prisma.TransactionClient,
  input: CloneInput,
): Promise<number> {
  const sources = await tx.product.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      // Never another demo's store: a demo copying a demo would compound a copy
      // of a copy every twenty-four hours, and the point is to show the real
      // catalogue.
      seller: { user: { demoExpiresAt: null, deletedAt: null } },
    },
    orderBy: { id: 'desc' },
    take: input.limit ?? DEMO_PRODUCT_COUNT,
    select: {
      id: true,
      categoryId: true,
      name: true,
      description: true,
      status: true,
      attributes: true,
      maxPurchaseQuantity: true,
      minPrice: true,
    },
  })

  if (sources.length === 0) return 0

  const productIds = sources.map((product) => product.id)

  const images = await tx.productImage.findMany({
    where: { productId: { in: productIds } },
    orderBy: { sortOrder: 'asc' },
    select: { productId: true, url: true, alt: true, sortOrder: true },
  })
  const options = await tx.productOption.findMany({
    where: { productId: { in: productIds }, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, productId: true, name: true, sortOrder: true },
  })
  const values = await tx.productOptionValue.findMany({
    where: { optionId: { in: options.map((option) => option.id) }, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, optionId: true, value: true, meta: true, sortOrder: true },
  })
  const variants = await tx.productVariant.findMany({
    where: { productId: { in: productIds }, deletedAt: null },
    orderBy: { sku: 'asc' },
    select: {
      id: true,
      productId: true,
      sku: true,
      price: true,
      listPrice: true,
      stock: true,
      maxPurchaseQuantity: true,
      isActive: true,
    },
  })
  const mappings = await tx.variantOptionValue.findMany({
    where: { productId: { in: productIds } },
    select: { variantId: true, optionValueId: true },
  })

  // Held across the whole store, not per product: the uniqueness index is on
  // `(sellerId, sku)`, so two source products of two different stores can both
  // arrive carrying `TSHIRT-BLACK-M`.
  const skus = new Set<string>()

  for (const source of sources) {
    await cloneOne(tx, input, skus, {
      product: source,
      images: images.filter((image) => image.productId === source.id),
      options: options.filter((option) => option.productId === source.id),
      values,
      variants: variants.filter((variant) => variant.productId === source.id),
      mappings,
    })
  }

  return sources.length
}

interface Source {
  readonly product: {
    readonly id: string
    readonly categoryId: number
    readonly name: string
    readonly description: string | null
    readonly status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
    readonly attributes: Prisma.JsonValue
    readonly maxPurchaseQuantity: number | null
    readonly minPrice: number | null
  }
  readonly images: readonly {
    readonly url: string
    readonly alt: string | null
    readonly sortOrder: number
  }[]
  readonly options: readonly {
    readonly id: string
    readonly name: string
    readonly sortOrder: number
  }[]
  readonly values: readonly {
    readonly id: string
    readonly optionId: string
    readonly value: string
    readonly meta: Prisma.JsonValue
    readonly sortOrder: number
  }[]
  readonly variants: readonly {
    readonly id: string
    readonly sku: string
    readonly price: number
    readonly listPrice: number | null
    readonly stock: number
    readonly maxPurchaseQuantity: number | null
    readonly isActive: boolean
  }[]
  readonly mappings: readonly { readonly variantId: string; readonly optionValueId: string }[]
}

async function cloneOne(
  tx: Prisma.TransactionClient,
  input: CloneInput,
  skus: Set<string>,
  source: Source,
): Promise<void> {
  const { now, sellerId } = input

  // One statement per table rather than one nested write, which is the shape
  // `ProductService.create` also settled on: the ids of a level are the input to
  // the next, and asking for them explicitly is what makes the mapping below
  // readable instead of a walk over a nested result.
  const product = await tx.product.create({
    data: {
      sellerId,
      categoryId: source.product.categoryId,
      name: source.product.name,
      description: source.product.description,
      status: source.product.status,
      attributes: source.product.attributes as Prisma.InputJsonValue,
      maxPurchaseQuantity: source.product.maxPurchaseQuantity,
      // Copied rather than recomputed: it is derived from the very prices being
      // copied, and `Product_active_price_check` refuses an `ACTIVE` listing
      // without one.
      minPrice: source.product.minPrice,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  })

  if (source.images.length > 0) {
    await tx.productImage.createMany({
      data: source.images.map((image) => ({
        productId: product.id,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder,
        createdAt: now,
      })),
    })
  }

  const sourceValues = source.values.filter((value) =>
    source.options.some((option) => option.id === value.optionId),
  )

  const copiedOptions = await tx.productOption.createManyAndReturn({
    data: source.options.map((option) => ({
      productId: product.id,
      name: option.name,
      sortOrder: option.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
    select: { id: true, name: true },
  })

  // Matched by name and by value rather than by position, for the reason
  // `ProductService.writeAxes` gives: the return order of a bulk insert is not
  // part of the contract, and a mapping built on it would be wrong silently.
  const optionIdByName = new Map(copiedOptions.map((option) => [option.name, option.id]))
  const optionNameById = new Map(source.options.map((option) => [option.id, option.name]))

  const copiedValues = await tx.productOptionValue.createManyAndReturn({
    data: sourceValues.map((value) => ({
      optionId: optionIdByName.get(optionNameById.get(value.optionId) ?? '') ?? '',
      value: value.value,
      meta: value.meta === null ? undefined : (value.meta as Prisma.InputJsonValue),
      sortOrder: value.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
    select: { id: true, optionId: true, value: true },
  })

  /** Source option value id → the copy's id and the option it now belongs to. */
  const copiedValue = new Map<string, CopiedValue>()

  for (const value of sourceValues) {
    const optionId = optionIdByName.get(optionNameById.get(value.optionId) ?? '')
    const copy = copiedValues.find(
      (candidate) => candidate.optionId === optionId && candidate.value === value.value,
    )

    if (copy !== undefined) copiedValue.set(value.id, { id: copy.id, optionId: copy.optionId })
  }

  const drafts = source.variants.map((variant) => {
    const copied = source.mappings
      .filter((mapping) => mapping.variantId === variant.id)
      .map((mapping) => copiedValue.get(mapping.optionValueId))
      .filter((value): value is CopiedValue => value !== undefined)
    const sku = uniqueSku(variant.sku, skus)
    // Recomputed from the copies' ids, never copied: the signature is what
    // `ProductVariant_product_signature_key` is a unique index on, and a string
    // naming another product's rows would satisfy the index and mean nothing.
    const signature = optionSignatureOf(copied.map((value) => value.id))

    skus.add(sku)

    return {
      stock: variant.stock,
      values: copied,
      signature,
      data: {
        productId: product.id,
        sellerId,
        sku,
        price: variant.price,
        listPrice: variant.listPrice,
        stock: variant.stock,
        maxPurchaseQuantity: variant.maxPurchaseQuantity,
        isActive: variant.isActive,
        optionSignature: signature,
        createdAt: now,
        updatedAt: now,
      },
    }
  })

  if (drafts.length === 0) return

  const created = await tx.productVariant.createManyAndReturn({
    data: drafts.map((draft) => draft.data),
    select: { id: true, optionSignature: true },
  })
  const variantId = new Map(created.map((row) => [row.optionSignature, row.id]))

  const copiedMappings = drafts.flatMap((draft) =>
    draft.values.map((value) => ({
      variantId: variantId.get(draft.signature) ?? '',
      optionValueId: value.id,
      optionId: value.optionId,
      productId: product.id,
    })),
  )

  if (copiedMappings.length > 0) await tx.variantOptionValue.createMany({ data: copiedMappings })

  // The opening balance, without which L1 (`stock = SUM(quantity)`) is broken
  // from the moment the store opens. `seq` is 1 because these variants have no
  // history — they were created in this statement — so no row lock is needed to
  // decide the position (TASK-0036 4.2).
  const ledger = drafts
    .filter((draft) => draft.stock > 0)
    .map((draft) => ({
      variantId: variantId.get(draft.signature) ?? '',
      seq: 1,
      type: 'INBOUND' as const,
      quantity: draft.stock,
      balanceAfter: draft.stock,
      reason: OPENING_REASON,
      // `null`, and deliberately not the demo account: `StockLedger.actor` is
      // `Restrict`, so a movement attributed to a demo user would refuse the
      // very deletion TASK-0025 exists to perform. Nobody made this movement —
      // it arrived with the copy.
      actorId: null,
      createdAt: now,
    }))

  if (ledger.length > 0) await tx.stockLedger.createMany({ data: ledger })
}
