import type {
  AttributeValue,
  CreateProductRequest,
  Product,
  ProductOption,
  ProductOptionInput,
  ProductResponse,
  ProductStatus,
  ProductVariant,
  ProductVariantInput,
  UpdateProductRequest,
  VariantDefaults,
} from '@shopping/shared'
import {
  createProductRequestSchema,
  PRODUCT_MAX_VARIANTS,
  productDetailResponseSchema,
  productImageKeyPattern,
  productPublishRequestSchema,
  productResponseSchema,
  updateProductRequestSchema,
} from '@shopping/shared'
import type { PathParams, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { attributeDefinitions } from '../fixtures/attributes'
import {
  productDraft,
  productWithOptions,
  storefrontProductDetail,
  storefrontProductWithoutOptions,
} from '../fixtures/products'
import { mockPaths } from '../paths'
import { categoryRowsSnapshot } from './categories'
import { answering, MockApiError, readBody } from './refusal'

/**
 * The product write path, as a screen can observe it (TASK-0113).
 *
 * Not a second implementation of `ProductService` — the part of it that reaches
 * a browser. What a seller can make happen from the editor is reproduced; what
 * only PostgreSQL can decide is not.
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | 한 요청 · 한 트랜잭션 | `prisma.$transaction`, so a refusal leaves nothing |
 * | 조합은 축의 곱 | `planVariants`, capped at `PRODUCT_MAX_VARIANTS` |
 * | 축은 못 바꾸고 값만 바꾼다 | `assertSameAxes`, else 400 on `options` |
 * | 값 추가는 조합만 늘린다 | replanning; existing variants keep their stock |
 * | 값 삭제는 비활성화한다 | `isActive: false`; rows survive for order history |
 * | 필수 속성은 `ACTIVE` 일 때만 | two passes over the rules (TASK-0113 4장) |
 * | 낙관적 잠금 | `version` compared under the row lock, 0 rows means 409 |
 * | 스토어의 이미지만 | `foreignImageIndexes` against the seller prefix |
 * | `minPrice` 는 파생값 | recomputed from the live variants on every write |
 *
 * **Why the band has to be this faithful.** TASK-0112 found the failure mode: a
 * double that answers differently from the server makes the front-end suite
 * green and the real screen broken, and nothing points at it. So every refusal
 * below carries the status, the `error.code` and the `details[].field` the
 * service raises, and the numbers are imported rather than retyped.
 *
 * **What is not reproduced.** Concurrency (the row lock), SKU uniqueness across
 * *other* products and retired rows, and the stock ledger. Those are
 * `apps/api`'s own tests against real PostgreSQL (TASK-0113 A6 · A7). A SKU
 * repeated inside one request is refused here, because that one is visible from
 * a form.
 */

/** Segment count of `products/{sellerId}/{objectId}.{ext}`. */
const KEY_PREFIX = 'products/'

/**
 * The store an image URL belongs to, or `null` when it is not one of our keys.
 *
 * `apps/api/src/catalog/product-image-keys.ts` is the original and this is its
 * twin, matched against the **same** `productImageKeyPattern` from
 * `@shopping/shared` so the two cannot disagree about what a key looks like. A
 * mock package cannot import an app, and the alternative — accepting every URL
 * — would make TASK-0113 F14 unobservable from a screen.
 */
function imageOwner(url: string): string | null {
  let path: string

  try {
    path = new URL(url).pathname.replace(/^\//, '')
  } catch {
    path = url.replace(/^\//, '')
  }

  const start = path.lastIndexOf(KEY_PREFIX)

  if (start < 0) return null

  const key = path.slice(start)

  if (!productImageKeyPattern.test(key)) return null

  return key.slice(KEY_PREFIX.length, key.indexOf('/', KEY_PREFIX.length))
}

/** The ids in a materialised path, roots first: `/1/2/3/` → `[1, 2, 3]`. */
function lineageOf(path: string): readonly number[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(Number)
}

/** The lineage of one category, or an empty list when there is no such row. */
function lineageOfCategory(categoryId: number): readonly number[] {
  const category = categoryRowsSnapshot().find((row) => row.id === categoryId)

  return category === undefined ? [] : lineageOf(category.path)
}

/**
 * The definitions that apply to a category, nearest owner winning.
 *
 * Read off the **attribute fixture** rather than off the attribute store next
 * door: that store's resolution is private to its module and this task does not
 * own that file. Writing the key list out by hand instead would drift from the
 * definitions the form is generated from — and a band that required a key the
 * form never asks about is worse than no band at all.
 */
function effectiveDefinitions(
  categoryId: number,
): readonly { readonly key: string; readonly isRequired: boolean }[] {
  const levels = new Map(lineageOfCategory(categoryId).map((id, level) => [id, level]))
  const winners = new Map<string, { level: number; isRequired: boolean }>()

  for (const definition of attributeDefinitions.attributes) {
    const level = levels.get(definition.categoryId)
    if (level === undefined) continue

    const held = winners.get(definition.key)

    if (held === undefined || level > held.level) {
      winners.set(definition.key, { level, isRequired: definition.isRequired })
    }
  }

  return [...winners.entries()]
    .map(([key, winner]) => ({ key, isRequired: winner.isRequired }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/** One axis, as a plan wants it. */
interface Axis {
  readonly name: string
  readonly values: readonly string[]
}

/**
 * The unit separator `variant-rules.ts` keys combinations by.
 *
 * Not a comma: option values are seller-typed text, and one value reading
 * `블랙, 화이트` would otherwise key the same as the two values `블랙` and
 * `화이트`.
 */
const KEY_SEPARATOR = '\u001F'

function combinationKey(values: readonly string[]): string {
  return values.join(KEY_SEPARATOR)
}

/**
 * The cartesian product of the axes, first axis varying slowest.
 *
 * `[]` in gives `[[]]` out — one combination with no choices, which is the
 * single variant an optionless product has (DECISIONS 3).
 */
function expand(axes: readonly Axis[]): readonly (readonly string[])[] {
  let combinations: readonly (readonly string[])[] = [[]]

  for (const axis of axes) {
    combinations = combinations.flatMap((prefix) => axis.values.map((value) => [...prefix, value]))
  }

  return combinations
}

function axesOf(options: readonly ProductOptionInput[] | undefined): readonly Axis[] {
  return (options ?? []).map((option) => ({
    name: option.name,
    values: option.values.map((value) => value.value),
  }))
}

function storedAxes(options: readonly ProductOption[]): readonly Axis[] {
  return options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => value.value),
  }))
}

/**
 * A copy the store may mutate.
 *
 * Fixtures are frozen by `defineFixture` on purpose, and a product is plain
 * JSON — no dates, no maps — so a round trip is a complete copy and needs no
 * host object beyond `JSON`.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** A 400 that names inputs, with `INVALID` on the entries and not the envelope. */
function invalid(entries: readonly { field: string; message: string }[]): MockApiError {
  return new MockApiError(400, entries[0]?.message ?? '', {
    entries: entries.map((entry) => ({ ...entry, code: 'INVALID' })),
  })
}

/** Ids the store hands out. Fixed, so a spec can predict them. */
let issued = 0

function nextId(): string {
  issued += 1

  return `019596d0-2222-7c2e-9a0e-${String(issued).padStart(12, '0')}`
}

/** `<prefix>-<n>`, the shape `generatedSku` produces. */
function generatedSku(prefix: string, index: number): string {
  return `${prefix}-${String(index)}`
}

/**
 * The prefix a request that named none gets.
 *
 * The rule TASK-0113 fixed: the id's leading time bits **and** its random tail,
 * so two products created inside one 65 second window do not collide.
 */
function defaultSkuPrefix(productId: string): string {
  const hex = productId.replaceAll('-', '')

  return `${hex.slice(0, 8)}${hex.slice(-6)}`.toUpperCase()
}

/** The signature of a combination — the value ids as a set, sorted and joined. */
function signatureOf(optionValueIds: readonly string[]): string {
  return [...optionValueIds].sort().join('/')
}

class ProductStore {
  private rows: Product[] = []

  constructor() {
    this.reset()
  }

  reset(seed: readonly ProductResponse[] = [productWithOptions, productDraft]): void {
    this.rows = seed.map((entry) => clone(entry.product))
    issued = 0
  }

  snapshot(): readonly Product[] {
    return this.rows.map((row) => clone(row))
  }

  get(id: string): Product {
    const row = this.rows.find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '상품을 찾을 수 없습니다.')

    return row
  }

  /**
   * Creates a listing whole.
   *
   * The order of the checks is the service's: refusals that need no stored row
   * first (the gallery's prefix, the combination count), then the attributes,
   * then the write. The row goes in as `DRAFT` whatever was asked for and
   * `settle` moves it, so no state exists that the price constraint would have
   * to be relaxed for.
   */
  create(input: CreateProductRequest): Product {
    const status = input.status ?? 'DRAFT'
    const images = input.images ?? []
    const sellerId = productWithOptions.product.sellerId
    const id = nextId()

    this.assertOwnImages(images, sellerId)

    const axes = axesOf(input.options)
    const combinations = this.plan(axes, input.variants ?? [])

    this.assertAttributes(input.categoryId, input.attributes ?? {}, status === 'ACTIVE')

    const created: Product = {
      id,
      sellerId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      status: 'DRAFT',
      attributes: input.attributes ?? {},
      maxPurchaseQuantity: input.maxPurchaseQuantity ?? null,
      minPrice: null,
      ratingAvg: 0,
      ratingCount: 0,
      salesCount: 0,
      version: 0,
      images: this.galleryOf(images),
      options: axes.map((axis, index) => ({
        id: nextId(),
        name: axis.name,
        sortOrder: index,
        values: axis.values.map((value, order) => ({
          id: nextId(),
          value,
          meta: null,
          sortOrder: order,
        })),
      })),
      variants: [],
    }

    created.variants = this.buildVariants(created, {
      combinations,
      overrides: input.variants ?? [],
      defaults: input.variantDefaults,
      skuPrefix: input.skuPrefix ?? defaultSkuPrefix(id),
      skuFrom: 1,
    })

    this.rows = [...this.rows, created]
    this.settle(created, status, 0)

    return created
  }

  /**
   * Edits a listing, its gallery, its choices and its variants.
   *
   * The version is compared before anything is written, so the loser of a race
   * gets a 409 it can act on rather than a silently discarded edit.
   */
  update(id: string, input: UpdateProductRequest): Product {
    const product = this.get(id)
    const status = input.status ?? product.status

    if (product.version !== input.version) {
      throw new MockApiError(409, '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?', {
        code: 'PRODUCT_VERSION_CONFLICT',
        field: 'version',
      })
    }

    if (input.images !== undefined) this.assertOwnImages(input.images, product.sellerId)
    if (input.options !== undefined) this.assertSameAxes(product, input.options)

    const categoryId = input.categoryId ?? product.categoryId
    const axes = input.options === undefined ? storedAxes(product.options) : axesOf(input.options)
    const combinations = this.plan(axes, input.variants ?? [])

    // Re-validated whenever either half of the pair moves, and whenever the
    // result is on sale even if neither did — that last one is the request that
    // says only `status` (TASK-0113 4장).
    if (input.attributes !== undefined || input.categoryId !== undefined || status === 'ACTIVE') {
      this.assertAttributes(categoryId, input.attributes ?? product.attributes, status === 'ACTIVE')
    }

    product.categoryId = categoryId
    if (input.name !== undefined) product.name = input.name
    if (input.description !== undefined) product.description = input.description
    if (input.attributes !== undefined) product.attributes = input.attributes
    if (input.maxPurchaseQuantity !== undefined) {
      product.maxPurchaseQuantity = input.maxPurchaseQuantity
    }
    if (input.images !== undefined) product.images = this.galleryOf(input.images)

    this.reviseVariants(product, axes, combinations, input)
    this.settle(product, status, 1)

    return product
  }

  publish(id: string, version: number): Product {
    return this.update(id, { version, status: 'ACTIVE' })
  }

  unpublish(id: string, version: number): Product {
    return this.update(id, { version, status: 'DRAFT' })
  }

  // ------------------------------------------------------------------ writes

  private galleryOf(
    images: readonly { readonly url: string; readonly alt?: string }[],
  ): Product['images'] {
    return images.map((image, index) => ({
      id: nextId(),
      url: image.url,
      alt: image.alt ?? null,
      sortOrder: index,
    }))
  }

  /**
   * Brings the variants in line with the axes, the way replanning does.
   *
   * A choice that was added produces combinations no live variant answers,
   * which are created; a choice that was removed stops producing its
   * combinations, whose variants are switched off rather than deleted — an
   * order placed yesterday points at that row (TASK-0113 F5b). Nothing else is
   * touched, which is what keeps the stock of the twelve that were already
   * there (F5).
   */
  private reviseVariants(
    product: Product,
    axes: readonly Axis[],
    combinations: readonly (readonly string[])[],
    input: UpdateProductRequest,
  ): void {
    const valueIds = new Map<string, string>()

    product.options.forEach((option, index) => {
      const kept = new Set(axes[index]?.values ?? [])
      const known = option.values

      for (const value of known)
        valueIds.set(`${option.id}${KEY_SEPARATOR}${value.value}`, value.id)

      const added = (axes[index]?.values ?? []).filter(
        (value) => !known.some((existing) => existing.value === value),
      )

      option.values = [
        ...known.filter((value) => kept.has(value.value)),
        ...added.map((value, offset) => {
          const id = nextId()
          valueIds.set(`${option.id}${KEY_SEPARATOR}${value}`, id)

          return { id, value, meta: null, sortOrder: known.length + offset }
        }),
      ]
    })

    const idsFor = (combination: readonly string[]): readonly string[] =>
      combination.map(
        (value, index) =>
          valueIds.get(`${product.options[index]?.id ?? ''}${KEY_SEPARATOR}${value}`) ?? '',
      )

    const live = new Map(
      product.variants.map((variant) => [signatureOf(variant.optionValueIds), variant] as const),
    )
    const overrides = overridesByCombination(input.variants ?? [])
    const planned = new Set<string>()
    const fresh: (readonly string[])[] = []

    for (const combination of combinations) {
      const signature = signatureOf(idsFor(combination))

      planned.add(signature)

      const existing = live.get(signature)

      if (existing === undefined) {
        fresh.push(combination)
        continue
      }

      applyOverride(existing, overrides.get(combinationKey(combination)))
    }

    if (fresh.length > 0) {
      if (input.variantDefaults === undefined) {
        throw invalid([
          {
            field: 'variantDefaults',
            message: '새로 만들어지는 옵션 조합의 기본 가격이 필요해요.',
          },
        ])
      }

      product.variants = [
        ...product.variants,
        ...this.buildVariants(product, {
          combinations: fresh,
          overrides: input.variants ?? [],
          defaults: input.variantDefaults,
          skuPrefix: input.skuPrefix ?? defaultSkuPrefix(product.id),
          // Numbered past every variant this product has ever had, so a
          // generated SKU never reuses a number the seller can still see.
          skuFrom: product.variants.length + 1,
          optionValueIds: idsFor,
        }),
      ]
    }

    for (const variant of product.variants) {
      if (!planned.has(signatureOf(variant.optionValueIds))) variant.isActive = false
    }
  }

  private buildVariants(
    product: Product,
    plan: {
      readonly combinations: readonly (readonly string[])[]
      readonly overrides: readonly ProductVariantInput[]
      readonly defaults: VariantDefaults
      readonly skuPrefix: string
      readonly skuFrom: number
      readonly optionValueIds?: (combination: readonly string[]) => readonly string[]
    },
  ): ProductVariant[] {
    const overrides = overridesByCombination(plan.overrides)
    const idsFor =
      plan.optionValueIds ??
      ((combination: readonly string[]): readonly string[] =>
        combination.map(
          (value, index) =>
            product.options[index]?.values.find((entry) => entry.value === value)?.id ?? '',
        ))

    return plan.combinations.map((combination, index) => {
      const override = overrides.get(combinationKey(combination))
      const own = override?.maxPurchaseQuantity ?? plan.defaults.maxPurchaseQuantity ?? null
      // 목 서버에는 예약이 없다 — 가용재고는 늘 실물 재고와 같다 (TASK-0048 4.2 ④).
      const stock = override?.stock ?? plan.defaults.stock ?? 0

      return {
        id: nextId(),
        sku: override?.sku ?? generatedSku(plan.skuPrefix, plan.skuFrom + index),
        price: override?.price ?? plan.defaults.price,
        listPrice: override?.listPrice ?? plan.defaults.listPrice ?? null,
        stock,
        availableStock: stock,
        maxPurchaseQuantity: own,
        effectiveMaxPurchaseQuantity: own ?? product.maxPurchaseQuantity,
        isActive: override?.isActive ?? true,
        optionValueIds: [...idsFor(combination)],
      }
    })
  }

  /**
   * The derived cache and the requested status, together.
   *
   * `minPrice` is computed **from** the live variants rather than adjusted
   * towards them, so no arithmetic can drift — and a listing may not go on sale
   * with nothing orderable behind it, which the database says with
   * `Product_active_price_check` and the service says with a sentence.
   */
  private settle(product: Product, status: ProductStatus, versionIncrement: number): void {
    if (status === 'ACTIVE' && !product.variants.some((variant) => variant.isActive)) {
      throw new MockApiError(400, '판매하려면 주문할 수 있는 옵션이 하나는 있어야 해요.', {
        code: 'PRODUCT_NOT_SELLABLE',
        field: 'status',
      })
    }

    const prices = product.variants
      .filter((variant) => variant.isActive)
      .map((variant) => variant.price)

    product.minPrice = prices.length === 0 ? null : Math.min(...prices)
    product.status = status
    product.version += versionIncrement

    // Resolved on the way out, so the four places that enforce the cap
    // (TASK-0045 · 0050 · 0048 · 0049) do not each write the same expression.
    for (const variant of product.variants) {
      variant.effectiveMaxPurchaseQuantity =
        variant.maxPurchaseQuantity ?? product.maxPurchaseQuantity
    }
  }

  // -------------------------------------------------------------- decisions

  /**
   * The combinations, or the refusal the planner makes.
   *
   * `too_many_variants` is the one that earns a code of its own: it is a limit
   * only the server knows and the number is what the sentence needs. Everything
   * else is a request contradicting itself, which `INVALID` at the field
   * already says.
   */
  private plan(
    axes: readonly Axis[],
    overrides: readonly ProductVariantInput[],
  ): readonly (readonly string[])[] {
    const axisIssues: { field: string; message: string }[] = []

    axes.forEach((axis, index) => {
      if (axes.findIndex((other) => other.name === axis.name) !== index) {
        axisIssues.push({
          field: `options.${String(index)}.name`,
          message: '같은 이름의 옵션이 두 번 있어요.',
        })
      }

      axis.values.forEach((value, at) => {
        if (axis.values.indexOf(value) !== at) {
          axisIssues.push({
            field: `options.${String(index)}.values.${String(at)}.value`,
            message: '같은 옵션 값이 두 번 있어요.',
          })
        }
      })
    })

    if (axisIssues.length > 0) throw invalid(axisIssues)

    const combinations = expand(axes)

    if (combinations.length > PRODUCT_MAX_VARIANTS) {
      throw new MockApiError(
        400,
        `옵션 조합이 너무 많아요. 최대 ${String(PRODUCT_MAX_VARIANTS)}개까지 만들 수 있어요.`,
        {
          code: 'PRODUCT_TOO_MANY_VARIANTS',
          field: 'options',
          params: { max: PRODUCT_MAX_VARIANTS },
        },
      )
    }

    const known = new Set(combinations.map((combination) => combinationKey(combination)))
    const overrideIssues: { field: string; message: string }[] = []

    overrides.forEach((override, index) => {
      const field = `variants.${String(index)}.optionValues`

      if (override.optionValues.length !== axes.length) {
        overrideIssues.push({
          field,
          message: '옵션 값을 옵션 수만큼, 옵션 순서대로 지정해 주세요.',
        })
      } else if (!known.has(combinationKey(override.optionValues))) {
        overrideIssues.push({ field, message: '이 상품에 없는 옵션 조합이에요.' })
      }
    })

    if (overrideIssues.length > 0) throw invalid(overrideIssues)

    this.assertDistinctSkus(overrides)

    return combinations
  }

  /**
   * Two rows of one request naming the same SKU.
   *
   * The real refusal comes from the partial unique index, which also sees every
   * other live variant of the store — that half needs a database. What a form
   * can produce, and therefore what a screen has to be able to draw, is the
   * collision inside its own table.
   */
  private assertDistinctSkus(overrides: readonly ProductVariantInput[]): void {
    const skus = overrides
      .map((override) => override.sku)
      .filter((sku): sku is string => sku !== undefined)

    if (new Set(skus).size === skus.length) return

    throw new MockApiError(409, '이미 쓰고 있는 SKU 예요. 다른 SKU 를 입력해 주세요.', {
      code: 'PRODUCT_SKU_TAKEN',
    })
  }

  /**
   * The axes of an update must be the axes that are stored.
   *
   * Same count, same names, same order. Anything else changes the arity of
   * every combination the product already has, which no listing with order
   * history survives (TASK-0032 4.8) — and the editor has to say so before the
   * request goes out (TASK-0114 F7b).
   */
  private assertSameAxes(product: Product, given: readonly ProductOptionInput[]): void {
    const same =
      product.options.length === given.length &&
      product.options.every((option, index) => option.name === given[index]?.name)

    if (same) return

    throw invalid([
      {
        field: 'options',
        message: '옵션 구성은 바꿀 수 없어요. 옵션 값만 추가하거나 뺄 수 있어요.',
      },
    ])
  }

  /**
   * The attribute bag, judged by the definitions of its category.
   *
   * Two passes, and the order is the design: a key no definition explains is
   * wrong in a draft too, while a **missing required** value is only wrong once
   * the listing goes on sale. So the second pass can be named
   * `PRODUCT_ATTRIBUTES_REQUIRED` without inspecting a message, and it names
   * every empty key at once rather than the first one repeatedly (F3).
   */
  private assertAttributes(
    categoryId: number,
    values: Readonly<Record<string, AttributeValue>>,
    requireAll: boolean,
  ): void {
    const definitions = effectiveDefinitions(categoryId)

    if (lineageOfCategory(categoryId).length === 0) {
      throw invalid([
        { field: 'categoryId', message: '선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.' },
      ])
    }

    const known = new Set(definitions.map((definition) => definition.key))
    const unknown = Object.keys(values).filter((key) => !known.has(key))

    if (unknown.length > 0) {
      throw invalid(
        unknown.map((key) => ({
          field: `attributes.${key}`,
          message: '이 카테고리에 없는 속성이에요.',
        })),
      )
    }

    if (!requireAll) return

    const missing = definitions
      .filter((definition) => definition.isRequired && isBlank(values[definition.key]))
      .map((definition) => definition.key)

    if (missing.length === 0) return

    const message = '판매를 시작하려면 필수 정보를 모두 채워야 해요.'

    throw new MockApiError(400, message, {
      code: 'PRODUCT_ATTRIBUTES_REQUIRED',
      entries: missing.map((key) => ({
        field: `attributes.${key}`,
        message,
        code: 'PRODUCT_ATTRIBUTES_REQUIRED',
      })),
    })
  }

  /** Refuses a gallery that points into another store's prefix (F14). */
  private assertOwnImages(images: readonly { readonly url: string }[], sellerId: string): void {
    const foreign = images.flatMap((image, index) => {
      const owner = imageOwner(image.url)

      return owner !== null && owner !== sellerId ? [index] : []
    })

    if (foreign.length === 0) return

    throw invalid(
      foreign.map((index) => ({
        field: `images.${String(index)}.url`,
        message: '다른 스토어의 이미지는 쓸 수 없어요. 이미지를 다시 올려 주세요.',
      })),
    )
  }
}

/** `''`, an empty list and an absent key are all "not answered". */
function isBlank(value: AttributeValue | undefined): boolean {
  if (value === undefined || value === '') return true

  return Array.isArray(value) && value.length === 0
}

function overridesByCombination(
  overrides: readonly ProductVariantInput[],
): ReadonlyMap<string, ProductVariantInput> {
  return new Map(
    overrides.map((override) => [combinationKey(override.optionValues), override] as const),
  )
}

/**
 * What an override changes on a variant that already exists.
 *
 * Absent fields are left alone — an entry is an override on top of the stored
 * row, not a replacement for it.
 */
function applyOverride(variant: ProductVariant, override: ProductVariantInput | undefined): void {
  if (override === undefined) return

  if (override.sku !== undefined) variant.sku = override.sku
  if (override.price !== undefined) variant.price = override.price
  if (override.listPrice !== undefined) variant.listPrice = override.listPrice
  if (override.stock !== undefined) {
    // 목 서버에는 예약이 없으므로 둘은 늘 같이 움직인다 (TASK-0048 4.2 ④).
    variant.stock = override.stock
    variant.availableStock = override.stock
  }
  if (override.maxPurchaseQuantity !== undefined) {
    variant.maxPurchaseQuantity = override.maxPurchaseQuantity
  }
  if (override.isActive !== undefined) variant.isActive = override.isActive
}

const store = new ProductStore()

/** Puts the catalogue back to the fixtures. Called from `setupTestServer`. */
export function resetProductStore(seed?: readonly ProductResponse[]): void {
  store.reset(seed)
}

/** The rows as they now stand — for a spec asserting on what a save wrote. */
export function productRowsSnapshot(): readonly Product[] {
  return store.snapshot()
}

/**
 * The `:id` segment, which is a UUID on every one of these routes.
 *
 * `pathId` next door coerces to a number, because the category and attribute
 * routes are keyed by a short integer. A product's id is not one — it travels
 * in a public URL — so this reads the same parameter as a string.
 */
function pathProductId(params: PathParams): string {
  const raw: string | readonly string[] | undefined = params.id

  if (typeof raw === 'string') return raw

  // `Array.isArray` widens a `readonly string[]` to `any[]`, so the element is
  // checked rather than the container.
  const first: unknown = raw?.[0]

  return typeof first === 'string' ? first : ''
}

/** One listing, cloned so a caller cannot reach into the store through it. */
function answerWith(product: Product, status = 200): Response {
  return HttpResponse.json(defineFixture(productResponseSchema, { product: clone(product) }), {
    status,
  })
}

/** The shopper's listings, by id. `ACTIVE` only — everything else is a 404. */
const STOREFRONT = new Map(
  [storefrontProductDetail, storefrontProductWithoutOptions].map((entry) => [
    entry.product.id,
    entry,
  ]),
)

export const productHandlers: readonly RequestHandler[] = [
  /**
   * Registered before {@link mockPaths.product}: msw takes the first handler
   * that matches, and `:id` alone would not match two segments — but the order
   * is stated anyway, because the day somebody widens that pattern is the day
   * this stops working for reasons nobody can see from here.
   */
  http.get(mockPaths.productDetail, ({ params }) =>
    answering(() => {
      const found = STOREFRONT.get(pathProductId(params))

      // A draft, a suspended listing and an id that never existed are one answer
      // (TASK-0043 4.1): telling them apart tells anybody asking which
      // unpublished ids exist.
      if (found === undefined) throw new MockApiError(404, '상품을 찾을 수 없습니다.')

      return HttpResponse.json(defineFixture(productDetailResponseSchema, found))
    }),
  ),

  http.get(mockPaths.product, ({ params }) =>
    answering(() => answerWith(store.get(pathProductId(params)))),
  ),

  http.post(mockPaths.products, ({ request }) =>
    answering(async () =>
      answerWith(store.create(await readBody(request, createProductRequestSchema)), 201),
    ),
  ),

  http.patch(mockPaths.product, ({ request, params }) =>
    answering(async () =>
      answerWith(
        store.update(pathProductId(params), await readBody(request, updateProductRequestSchema)),
      ),
    ),
  ),

  http.post(mockPaths.productPublish, ({ request, params }) =>
    answering(async () => {
      const { version } = await readBody(request, productPublishRequestSchema)

      return answerWith(store.publish(pathProductId(params), version))
    }),
  ),

  http.post(mockPaths.productUnpublish, ({ request, params }) =>
    answering(async () => {
      const { version } = await readBody(request, productPublishRequestSchema)

      return answerWith(store.unpublish(pathProductId(params), version))
    }),
  ),
]
