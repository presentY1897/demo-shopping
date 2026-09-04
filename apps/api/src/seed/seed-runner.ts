import type { Role } from '@shopping/shared'

import type { RequestPrincipal } from '../auth/request-principal.js'
import type { AttributeService } from '../catalog/attribute.service.js'
import type { CategoryService } from '../catalog/category.service.js'
import type { ProductService } from '../catalog/product.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { SellerService } from '../sellers/seller.service.js'
import type { SeedImage, SeedImages } from './images.js'
import { galleryFor } from './images.js'
import type { CataloguePlacement, SeedScale } from './product-plan.js'
import { planCatalogue, planProduct, seedSkuPrefix } from './product-plan.js'
import { seededRandom } from './random.js'
import type { FlatCategory } from './taxonomy.js'
import { effectiveAttributes, flatten, leafCategories } from './taxonomy.js'
import { SEED_BRANDS, storeIntroduction } from './vocabulary.js'

/**
 * The catalogue, written through the API's own services (TASK-0037 5장).
 *
 * **Writes go through `CategoryService`, `AttributeService`, `SellerService`
 * and `ProductService`. Reads go straight to Prisma.** The task says 검증 경유
 * and 원장 경유, and the reason is not purity: it is that F3 (속성 유효성 위반
 * 0건) and F4 (재고 = 원장) are otherwise assertions about a *second*
 * implementation of the same rules, which is the implementation that drifts.
 * Going through the services makes both true by construction — a variant is
 * born at zero and `StockService.open` moves it, because that is the only way
 * `ProductService` knows how to make one.
 *
 * Reads are a different matter. "Does this category already exist?" is not a
 * rule anybody can get wrong, and asking it through the service layer would
 * mean building a tree response to look at one slug.
 *
 * **Idempotency is recognition, not deletion** (F2). Nothing here truncates. A
 * second run looks up what the first one wrote — by category slug, by attribute
 * key, by store slug, by SKU prefix — and creates only what is missing. That is
 * why every one of those keys is derived, never drawn (`random.ts`).
 */

/**
 * The principal that creates the tree.
 *
 * A synthetic id, and no `User` row behind it. Nothing on the category or
 * attribute path records an actor, so a row would exist only to be looked at;
 * and a real `ADMIN_SUPER` account in every seeded database is a worse idea
 * than a fake one — even though sign-in matches on `googleSub` alone and this
 * account has none, so nobody could ever be it.
 */
const SEED_ADMIN: RequestPrincipal = {
  userId: '00000000-0000-4000-8000-00000000ad11',
  roles: ['ADMIN_SUPER'],
  sellerId: null,
  app: 'admin',
}

/** What a store owner holds once the store is open. */
const SELLER_ROLES: readonly Role[] = ['BUYER', 'SELLER_OWNER']

/**
 * The `googleSub` a seeded store owner carries.
 *
 * **`User_google_identity_check` requires one**: a live, non-demo account must
 * have a Google identity, because an account nobody can sign in as is an orphan
 * the rest of the system has no story for. A seeded store owner is exactly that
 * on purpose — the catalogue needs 15 owners and there are no 15 people — so it
 * carries a namespaced identity instead of a real one.
 *
 * **Nobody can be this account.** Sign-in matches `googleSub` against the `sub`
 * Google puts in an id token, which is always a decimal string; `seed:` cannot
 * be produced there. And the check's purpose is kept where it matters: the row
 * is not a demo account (so the expiry sweep leaves it alone) and not withdrawn
 * (so it may own a store), and it is still impossible for it to be a person's
 * account by accident.
 *
 * The alternative — `isDemo: true` with a far-future expiry — was rejected: the
 * demo catalogue is *cloned from* these stores, so making them demo stores
 * would have demo accounts copying from demo accounts, and one sweep bug would
 * take the seed catalogue with it.
 */
function seedGoogleSub(slug: string): string {
  return `seed:${slug}`
}

/** What one run did. Printed, and asserted by the verification script. */
export interface SeedReport {
  readonly scale: SeedScale['label']
  readonly categories: { readonly created: number; readonly existing: number }
  readonly attributes: { readonly created: number; readonly existing: number }
  readonly sellers: { readonly created: number; readonly existing: number }
  readonly products: {
    readonly created: number
    readonly existing: number
    /** Listings whose placeholders were replaced by real photographs (F6d). */
    readonly refreshed: number
  }
  readonly variants: number
  readonly images: {
    readonly uploaded: number
    readonly reused: number
    readonly note: string | null
  }
  readonly elapsedMs: number
}

export interface SeedServices {
  readonly prisma: PrismaService
  readonly categories: CategoryService
  readonly attributes: AttributeService
  readonly products: ProductService
  readonly sellers: SellerService
  readonly images: SeedImages
  readonly now: () => Date
  /** Progress, so an 800-row run is not eight silent minutes. */
  readonly log: (line: string) => void
}

export class SeedRunner {
  constructor(private readonly services: SeedServices) {}

  async run(scale: SeedScale): Promise<SeedReport> {
    const startedAt = performance.now()
    const categoryIds = await this.ensureCategories()
    const attributes = await this.ensureAttributes(categoryIds)
    const sellers = await this.ensureSellers(scale.sellers)
    const products = await this.ensureProducts(scale, categoryIds, sellers)
    const images = this.services.images.report()

    return {
      scale: scale.label,
      categories: categoryIds.report,
      attributes,
      sellers: sellers.report,
      products: products.report,
      variants: products.variants,
      images: { uploaded: images.uploaded, reused: images.reused, note: images.skipped },
      elapsedMs: performance.now() - startedAt,
    }
  }

  // ------------------------------------------------------------- categories

  private async ensureCategories(): Promise<{
    readonly bySlug: ReadonlyMap<string, number>
    readonly report: { readonly created: number; readonly existing: number }
  }> {
    const existingRows = await this.services.prisma.category.findMany({
      select: { id: true, slug: true },
    })
    const bySlug = new Map(existingRows.map((row) => [row.slug, row.id]))
    const before = bySlug.size

    let created = 0

    // `flatten` is roots-first, so a parent always has an id by the time its
    // child asks for one.
    for (const node of flatten()) {
      if (bySlug.has(node.slug)) continue

      const parentId = node.parentSlug === null ? null : (bySlug.get(node.parentSlug) ?? null)
      const response = await this.services.categories.create(SEED_ADMIN, {
        parentId,
        name: node.name,
        slug: node.slug,
      })

      bySlug.set(node.slug, response.category.id)
      created += 1
    }

    this.services.log(`카테고리 ${String(created)}개 생성 · ${String(before)}개 기존`)

    return { bySlug, report: { created, existing: before } }
  }

  // ------------------------------------------------------------- attributes

  private async ensureAttributes(categories: {
    readonly bySlug: ReadonlyMap<string, number>
  }): Promise<{ readonly created: number; readonly existing: number }> {
    const existingRows = await this.services.prisma.attributeDefinition.findMany({
      where: { deletedAt: null },
      select: { categoryId: true, key: true },
    })
    const held = new Set(existingRows.map((row) => `${String(row.categoryId)}/${row.key}`))
    const before = held.size

    let created = 0

    for (const node of flatten()) {
      const categoryId = categories.bySlug.get(node.slug)

      if (categoryId === undefined) continue

      for (const [index, definition] of (node.attributes ?? []).entries()) {
        if (held.has(`${String(categoryId)}/${definition.key}`)) continue

        await this.services.attributes.create(SEED_ADMIN, {
          categoryId,
          key: definition.key,
          label: definition.label,
          type: definition.type,
          ...(definition.options === undefined ? {} : { options: [...definition.options] }),
          isRequired: definition.isRequired ?? false,
          isFilterable: definition.isFilterable ?? false,
          sortOrder: index,
        })

        created += 1
      }
    }

    this.services.log(`속성 정의 ${String(created)}개 생성 · ${String(before)}개 기존`)

    return { created, existing: before }
  }

  // ---------------------------------------------------------------- sellers

  private async ensureSellers(count: number): Promise<{
    readonly ids: readonly { readonly sellerId: string; readonly userId: string }[]
    readonly report: { readonly created: number; readonly existing: number }
  }> {
    const random = seededRandom('스토어')
    const ids: { sellerId: string; userId: string }[] = []

    let created = 0
    let existing = 0

    for (const [name, slug] of SEED_BRANDS.slice(0, count)) {
      const introduction = storeIntroduction(random.stream(slug))
      const held = await this.services.prisma.seller.findUnique({
        where: { slug },
        select: { id: true, userId: true },
      })

      if (held !== null) {
        ids.push({ sellerId: held.id, userId: held.userId })
        existing += 1
        continue
      }

      const now = this.services.now()
      // The account and the store in one transaction. A user with no store is a
      // console its owner cannot enter, and nothing would ever repair it — the
      // same reasoning `DemoSeedService` gives for its own path.
      const user = await this.services.prisma.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            googleSub: seedGoogleSub(slug),
            email: `${slug}@seed.demo-shopping.local`,
            name: `${name} 담당자`,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        })

        // `BUYER` only. `SELLER_OWNER` is granted by `openDemoStore` below, in
        // the same transaction as the store — the role that means "owns a store"
        // is granted by the code that opens one, never by the code that makes an
        // account (D-016).
        await tx.userRole.create({ data: { userId: row.id, role: 'BUYER', grantedAt: now } })

        return row
      })

      const seller = await this.services.sellers.openDemoStore({
        userId: user.id,
        brandName: name,
        slug,
        introduction,
      })

      ids.push({ sellerId: seller.id, userId: user.id })
      created += 1
    }

    this.services.log(`스토어 ${String(created)}개 생성 · ${String(existing)}개 기존`)

    return { ids, report: { created, existing } }
  }

  // --------------------------------------------------------------- products

  private async ensureProducts(
    scale: SeedScale,
    categories: { readonly bySlug: ReadonlyMap<string, number> },
    sellers: { readonly ids: readonly { readonly sellerId: string; readonly userId: string }[] },
  ): Promise<{
    readonly report: {
      readonly created: number
      readonly existing: number
      readonly refreshed: number
    }
    readonly variants: number
  }> {
    const leaves = leafCategories()
    const byLeafSlug = new Map(leaves.map((leaf) => [leaf.slug, leaf]))
    const placements = planCatalogue(
      scale,
      leaves.map((leaf) => leaf.slug),
    )
    const random = seededRandom('상품')

    let created = 0
    let existing = 0
    let variants = 0
    let refreshed = 0

    for (const placement of placements) {
      const owner = sellers.ids[placement.sellerIndex]
      const leaf = byLeafSlug.get(placement.leafSlug)
      const categoryId = categories.bySlug.get(placement.leafSlug)

      if (owner === undefined || leaf === undefined || categoryId === undefined) continue

      const prefix = seedSkuPrefix(placement.index)
      // The SKU prefix alone is the natural key — **not** the pair with the
      // store. Which store owns listing 7 depends on how many stores the run
      // makes (`index % scale.sellers`), so a `--scale=small` run followed by a
      // full one asks about a different pair and creates the listing twice.
      // Measured before this was one lookup: 830 listings instead of 800.
      //
      // A consequence worth naming: changing scale leaves the listings the
      // earlier run made where they are, owned by whoever owned them. The
      // catalogue is the right size and the right shape; only the first N
      // listings' ownership reflects the smaller run. `pnpm db:reset` is how you
      // get the other answer.
      const held = await this.services.prisma.productVariant.findFirst({
        where: { sku: { startsWith: `${prefix}-` } },
        select: { productId: true, sellerId: true },
      })

      // The draw happens whether or not the row is written, so that skipping an
      // existing listing does not shift what every later one looks like. The
      // *upload* is not part of that — it happens only when there is something
      // to attach pictures to, which is why a rerun that creates nothing touches
      // the bucket not at all.
      const planned = this.plan(random, placement, leaf)

      if (held !== null) {
        existing += 1
        const actualOwner = sellers.ids.find((row) => row.sellerId === held.sellerId) ?? owner

        if (await this.refreshGallery(actualOwner, held.productId, random, placement, leaf)) {
          refreshed += 1
        }
        continue
      }

      const gallery = await this.gallery(random, placement, leaf)

      await this.services.products.create(this.principalFor(owner), {
        ...planned.request,
        categoryId,
        skuPrefix: prefix,
        images: gallery.map((image) => ({ url: image.url, alt: image.alt })),
      })

      created += 1
      variants += (planned.request.variants ?? []).length

      if (created % 100 === 0) {
        this.services.log(`상품 ${String(created)}개…`)
      }
    }

    this.services.log(
      `상품 ${String(created)}개 생성 · ${String(existing)}개 기존` +
        (refreshed > 0 ? ` · ${String(refreshed)}개 이미지 갱신` : ''),
    )

    return { report: { created, existing, refreshed }, variants }
  }

  private plan(
    random: ReturnType<typeof seededRandom>,
    placement: CataloguePlacement,
    leaf: FlatCategory,
  ): ReturnType<typeof planProduct> {
    const colours = effectiveAttributes(leaf.slug).find(
      (definition) => definition.key === 'color',
    )?.options

    if (colours === undefined) throw new Error(`색상 속성이 없는 카테고리입니다: ${leaf.slug}`)

    return planProduct(random, {
      leafSlug: placement.leafSlug,
      sellerIndex: placement.sellerIndex,
      colourOptions: colours,
      showcase: placement.showcase,
    })
  }

  /**
   * Puts the real photographs on a listing that was seeded with placeholders.
   *
   * F6d: dropping the assets in and rerunning changes the image URLs and
   * nothing else. Only runs when `assets/seed-images/` exists — with no assets
   * the pictures are already what they are going to be, and asking would upload
   * the whole catalogue again to learn that nothing changed.
   *
   * Answers whether it wrote anything.
   */
  private async refreshGallery(
    owner: { readonly sellerId: string; readonly userId: string },
    productId: string,
    random: ReturnType<typeof seededRandom>,
    placement: CataloguePlacement,
    leaf: FlatCategory,
  ): Promise<boolean> {
    if (!this.services.images.hasAssets()) return false

    const wanted = await this.gallery(random, placement, leaf)
    const product = await this.services.prisma.product.findUnique({
      where: { id: productId },
      select: { version: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' } } },
    })

    if (product === null || wanted.length === 0) return false

    const held = product.images.map((image) => image.url)
    const next = wanted.map((image) => image.url)

    if (held.length === next.length && held.every((url, index) => url === next[index])) return false

    await this.services.products.update(this.principalFor(owner), productId, {
      version: product.version,
      images: wanted.map((image) => ({ url: image.url, alt: image.alt })),
    })

    return true
  }

  private async gallery(
    random: ReturnType<typeof seededRandom>,
    placement: CataloguePlacement,
    leaf: FlatCategory,
  ): Promise<readonly SeedImage[]> {
    const pool = await this.services.images.pool(leaf.slug, leaf.name)

    return galleryFor(random.stream(`이미지/${String(placement.index)}`), pool, placement.showcase)
  }

  private principalFor(owner: { readonly sellerId: string; readonly userId: string }) {
    return {
      userId: owner.userId,
      roles: SELLER_ROLES,
      sellerId: owner.sellerId,
      app: 'seller',
    } satisfies RequestPrincipal
  }
}
