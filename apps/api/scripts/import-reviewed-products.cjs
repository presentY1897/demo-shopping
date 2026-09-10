// Additive reviewed-product import. Default is read-only dry run; --apply is explicit.
// Never loads AppModule: its background sweepers are unrelated to this import.
require('reflect-metadata')
const { readFileSync, writeFileSync, realpathSync } = require('node:fs')
const { resolve, dirname, sep } = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')
const { CategoryService } = require('../dist/catalog/category.service.js')
const { AttributeService } = require('../dist/catalog/attribute.service.js')
const { StockService } = require('../dist/stock/stock.service.js')
const { SearchOutboxService } = require('../dist/search/search-outbox.service.js')
const { createProductRequestSchema, createCategoryRequestSchema } = require('@shopping/shared')
const root = resolve(__dirname, '../../..')
const args = process.argv.slice(2)
function argument(name, fallback) {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing argument: ' + name)
  return args[i + 1]
}
const apply = args.includes('--apply')
const planOnly = args.includes('--plan-only')
if (apply && planOnly) throw Error('--plan-only cannot be combined with --apply')
const { productImageOwner } = require('../dist/catalog/product-image-keys.js')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    )
  return value
}
const fingerprint = (value) => digest(JSON.stringify(stable(value)))
const read = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
function publicUrl(value) {
  const u = new URL(value)
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.hostname === 'localhost' ||
    u.hostname.endsWith('.localhost') ||
    u.hostname.endsWith('.local') ||
    /^[\d.]+$/.test(u.hostname) ||
    u.hostname.includes(':')
  )
    throw Error('A persistent public HTTPS hostname without credentials/query is required')
  return u.href
}
async function main() {
  const target = process.env[argument('--target-url-env', 'IMPORT_TARGET_DATABASE_URL')]
  if (!target)
    throw Error('Explicit IMPORT_TARGET_DATABASE_URL is required; no implicit .env target')
  const db = new URL(target)
  if (
    !['localhost', '127.0.0.1'].includes(db.hostname) ||
    db.port !== '5582' ||
    db.pathname !== '/shopping'
  )
    throw Error('Only the confirmed localhost:5582/shopping target is allowed')
  const exported = read(argument('--export', 'product-images/reviewed-products-export.json'))
  const mapped = read(argument('--asset-map', 'product-images/reviewed-assets-uploaded.json'))
  if (
    exported.source !== 'shopping_image_preview' ||
    exported.productCount !== exported.products.length ||
    exported.assetCount !== exported.assets.length ||
    !exported.products.length
  )
    throw Error('Invalid export envelope')
  const assets = new Map()
  for (const row of mapped.assets || []) {
    if (assets.has(row.sourceUrl)) throw Error('Duplicate asset map source')
    assets.set(row.sourceUrl, row)
  }
  const verifiedSources = new Set()
  // Validate local provenance, map checksum and actual publicly served bytes before DB access.
  for (const source of exported.assets) {
    if (verifiedSources.has(source.sourceUrl)) throw Error('Duplicate exported asset')
    const row = assets.get(source.sourceUrl)
    if (
      !row ||
      (!planOnly && row.verified !== true) ||
      row.sha256 !== source.sha256 ||
      row.sizeBytes !== source.sizeBytes
    )
      throw Error('Missing verified asset map entry: ' + source.sourceUrl)
    const file = realpathSync(resolve(root, source.file))
    const allowed = realpathSync(resolve(root, 'apps/shop/public/product-image-sets'))
    if (!file.startsWith(allowed + sep)) throw Error('Asset escapes approved image directory')
    const manifestFile = realpathSync(resolve(root, source.manifest))
    if (!manifestFile.startsWith(allowed + sep))
      throw Error('Manifest escapes approved image directory')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const job = manifest.jobs.find((j) => j.id === source.job)
    if (
      job?.status !== 'accepted' ||
      job.sha256 !== source.sha256 ||
      realpathSync(resolve(dirname(manifestFile), job.image || job.output)) !== file
    )
      throw Error('Asset lacks matching accepted manifest provenance')
    const localBytes = readFileSync(file)
    if (localBytes.length !== source.sizeBytes || digest(localBytes) !== source.sha256)
      throw Error('Local approved asset changed')
    row.publicUrl = publicUrl(row.publicUrl)
    if (planOnly) {
      verifiedSources.add(source.sourceUrl)
      continue
    }
    const response = await fetch(row.publicUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
      throw Error('Public image verification failed: HTTP ' + response.status)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length !== source.sizeBytes || digest(bytes) !== source.sha256)
      throw Error('Public asset checksum mismatch')
    verifiedSources.add(source.sourceUrl)
  }
  const rewrite = (images) =>
    images.map((im) => {
      const row = assets.get(im.url)
      if (!row || !verifiedSources.has(im.url))
        throw Error('Image URL missing from verified export/asset map')
      return { ...im, url: row.publicUrl }
    })
  const rows = exported.products.map((source) => {
    const input = structuredClone(source.input)
    input.images = rewrite(input.images || [])
    for (const option of input.options || [])
      for (const value of option.values || []) {
        if (value.meta?.gallery)
          value.meta.gallery = JSON.stringify(rewrite(JSON.parse(value.meta.gallery)))
      }
    if (!input.variants?.length || input.variants.some((v) => !v.sku))
      throw Error('All explicit variants and SKUs must be preserved')
    for (const image of input.images || [])
      if (productImageOwner(image.url) !== source.sourceSellerId)
        throw Error('Product image storage key ownership mismatch')
    for (const option of input.options || [])
      for (const value of option.values || [])
        if (value.meta?.gallery) {
          for (const image of JSON.parse(value.meta.gallery))
            if (productImageOwner(image.url) !== source.sourceSellerId)
              throw Error('Variant gallery storage key ownership mismatch')
        }
    createProductRequestSchema.parse(input)
    const key = 'import.reviewed.v1.' + source.sourceProductId
    return {
      source,
      input,
      key,
      hash: fingerprint({ seller: source.sourceSellerId, path: source.categoryPath, input }),
    }
  })
  if (new Set(rows.map((r) => r.key)).size !== rows.length) throw Error('Duplicate source product')
  const skuSet = new Set()
  for (const row of rows)
    for (const v of row.input.variants) {
      const key = row.source.sourceSellerId + '/' + v.sku
      if (skuSet.has(key)) throw Error('Duplicate exported seller SKU: ' + v.sku)
      skuSet.add(key)
    }
  const { config } = await loadAppConfig()
  const prisma = new PrismaService({
    ...config,
    database: { ...config.database, url: target, poolSize: Math.max(config.database.poolSize, 3) },
  })
  await prisma.$connect()
  const clock = { now: () => new Date() }
  const outbox = new SearchOutboxService(prisma, clock)
  const products = new ProductService(
    prisma,
    clock,
    new AttributeService(prisma, clock),
    new StockService(prisma, clock, outbox),
    outbox,
    { sendMany: async () => undefined },
  ) // Bulk import intentionally sends no follower messages.
  const categories = new CategoryService(prisma, clock)
  const report = {
    mode: apply ? 'apply' : planOnly ? 'plan-only' : 'dry-run',
    target: 'localhost:5582/shopping',
    startedAt: new Date().toISOString(),
    verifiedAssets: planOnly ? 0 : exported.assets.length,
    locallyVerifiedAssets: exported.assets.length,
    publicVerificationSkipped: planOnly,
    categoryPlans: [],
    products: [],
  }
  async function preflight() {
    const allCategories = await prisma.category.findMany()
    const bySlug = new Map(allCategories.map((c) => [c.slug, c]))
    const planned = new Map()
    for (const row of rows) {
      const seller = await prisma.seller.findUnique({
        where: { id: row.source.sourceSellerId },
        include: { user: true },
      })
      if (
        !seller ||
        seller.status !== 'ACTIVE' ||
        seller.user.isDemo ||
        seller.user.deletedAt ||
        seller.user.suspendedAt
      )
        throw Error(
          'Source seller must exist with active non-demo owner: ' + row.source.sourceSellerId,
        )
      row.principal = {
        userId: seller.userId,
        sellerId: seller.id,
        roles: ['BUYER', 'SELLER_OWNER'],
        app: 'seller',
      }
      if (!row.source.categoryPath.length) throw Error('Missing category path')
      let parentSlug = null
      for (const c of row.source.categoryPath) {
        const held = bySlug.get(c.slug)
        const parent = parentSlug ? bySlug.get(parentSlug) : null
        if (
          held &&
          (held.deletedAt ||
            !held.isActive ||
            held.name !== c.name ||
            held.parentId !== (parent?.id ?? null) ||
            (parentSlug && !parent))
        )
          throw Error('Conflicting existing category: ' + c.slug)
        const plan = { name: c.name, slug: c.slug, parentSlug }
        if (planned.has(c.slug) && fingerprint(planned.get(c.slug)) !== fingerprint(plan))
          throw Error('Conflicting exported category path')
        planned.set(c.slug, plan)
        parentSlug = c.slug
      }
      const mark = await prisma.appMeta.findUnique({ where: { key: row.key } })
      row.marker = mark ? JSON.parse(mark.value) : null
      if (
        row.marker &&
        (row.marker.inputHash !== row.hash ||
          row.marker.sourceSellerId !== seller.id ||
          row.marker.sourceProductId !== row.source.sourceProductId ||
          !['prepared', 'complete'].includes(row.marker.state))
      )
        throw Error('Existing import marker differs from reviewed export: ' + row.key)
      const matches = await prisma.productVariant.findMany({
        where: {
          sellerId: seller.id,
          deletedAt: null,
          sku: { in: row.input.variants.map((v) => v.sku) },
        },
        select: { productId: true, sku: true },
      })
      const ids = [...new Set(matches.map((v) => v.productId))]
      if (
        ids.length &&
        (!row.marker ||
          ids.length !== 1 ||
          matches.length !== row.input.variants.length ||
          (row.marker.productId && ids[0] !== row.marker.productId))
      )
        throw Error(
          'Unrelated or partial SKU conflict; refusing product adoption: ' +
            row.source.sourceProductId,
        )
      if (row.marker?.state === 'complete' && ids[0] !== row.marker.productId)
        throw Error('Completed import product/SKUs missing or changed')
      row.recoverId = ids[0]
      if (row.recoverId && row.marker?.state === 'prepared') {
        const leaf = bySlug.get(row.source.categoryPath.at(-1).slug)
        if (!leaf) throw Error('Recovery candidate category missing')
        await exactRecovered(row, row.recoverId, leaf.id)
      }
      if (row.marker?.state === 'complete') {
        const held = await prisma.product.findUnique({ where: { id: row.marker.productId } })
        if (!held || held.sellerId !== seller.id || held.deletedAt)
          throw Error('Completed product ownership/deletion mismatch')
      }
    }
    report.categoryPlans = [...planned.values()].filter((p) => !bySlug.has(p.slug))
    return bySlug
  }
  async function exactRecovered(row, id, categoryId) {
    const p = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        options: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: { values: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
        },
        variants: {
          where: { deletedAt: null },
          include: { optionValues: { include: { optionValue: true } } },
        },
      },
    })
    const wanted = row.input
    const scalar = (x) => ({
      name: x.name,
      description: x.description ?? null,
      status: x.status,
      attributes: x.attributes ?? {},
      maxPurchaseQuantity: x.maxPurchaseQuantity ?? null,
    })
    const options = (xs) =>
      (xs || []).map((o) => ({
        name: o.name,
        values: o.values.map((v) => ({ value: v.value, meta: v.meta ?? null })),
      }))
    const variant = (v) => ({
      sku: v.sku,
      price: v.price,
      listPrice: v.listPrice ?? null,
      stock: v.stock,
      maxPurchaseQuantity: v.maxPurchaseQuantity ?? null,
      isActive: v.isActive ?? true,
      optionValues: v.optionValues,
    })
    const actualVariants = p.variants
      .map((v) =>
        variant({
          ...v,
          optionValues: p.options
            .map((o) => v.optionValues.find((x) => x.optionId === o.id)?.optionValue.value)
            .filter((x) => x !== undefined),
        }),
      )
      .sort((a, b) => a.sku.localeCompare(b.sku))
    const expectedVariants = wanted.variants.map(variant).sort((a, b) => a.sku.localeCompare(b.sku))
    if (
      p.deletedAt ||
      p.sellerId !== row.source.sourceSellerId ||
      p.categoryId !== categoryId ||
      fingerprint(scalar(p)) !== fingerprint(scalar(wanted)) ||
      fingerprint(options(p.options)) !== fingerprint(options(wanted.options)) ||
      fingerprint(actualVariants) !== fingerprint(expectedVariants) ||
      fingerprint(p.images.map((x) => ({ url: x.url, alt: x.alt ?? null }))) !==
        fingerprint(wanted.images.map((x) => ({ url: x.url, alt: x.alt ?? null })))
    )
      throw Error('Prepared-marker recovery candidate differs; no mutation performed: ' + id)
  }
  try {
    if (!apply) {
      await preflight()
      for (const row of rows)
        report.products.push({
          sourceProductId: row.source.sourceProductId,
          action:
            row.marker?.state === 'complete'
              ? 'reuse'
              : row.recoverId
                ? 'verify-and-recover'
                : 'create',
          variantCount: row.input.variants.length,
        })
    } else {
      // A dedicated held transaction acts only as the global import mutex. ProductService
      // and marker writes use their own transactions so prepared markers survive crashes.
      await prisma.$transaction(
        async (lock) => {
          await lock.$queryRawUnsafe('SELECT pg_advisory_xact_lock(736281, 90466)::text')
          const bySlug = await preflight()
          const admin = { userId: randomUUID(), roles: ['ADMIN_SUPER'], app: 'admin' }
          for (const row of rows) {
            if (row.marker?.state === 'complete') {
              report.products.push({
                sourceProductId: row.source.sourceProductId,
                productId: row.marker.productId,
                action: 'reused',
              })
              continue
            }
            let parentId = null
            for (const c of row.source.categoryPath) {
              if (!bySlug.has(c.slug)) {
                const result = await categories.create(
                  admin,
                  createCategoryRequestSchema.parse({ name: c.name, slug: c.slug, parentId }),
                )
                bySlug.set(c.slug, result.category)
              }
              parentId = bySlug.get(c.slug).id
            }
            const input = createProductRequestSchema.parse({ ...row.input, categoryId: parentId })
            if (!row.marker) {
              row.marker = {
                state: 'prepared',
                sourceProductId: row.source.sourceProductId,
                sourceSellerId: row.source.sourceSellerId,
                inputHash: row.hash,
                preparedAt: new Date().toISOString(),
              }
              await prisma.appMeta.create({
                data: { key: row.key, value: JSON.stringify(row.marker) },
              })
            }
            let id = row.recoverId
            if (id) await exactRecovered(row, id, parentId)
            else id = (await products.create(row.principal, input)).product.id
            await exactRecovered(row, id, parentId)
            await prisma.appMeta.update({
              where: { key: row.key },
              data: {
                value: JSON.stringify({
                  ...row.marker,
                  state: 'complete',
                  productId: id,
                  completedAt: new Date().toISOString(),
                }),
              },
            })
            report.products.push({
              sourceProductId: row.source.sourceProductId,
              productId: id,
              action: row.recoverId ? 'recovered' : 'created',
            })
          }
        },
        { timeout: 3600000, maxWait: 10000 },
      )
    }
    report.completedAt = new Date().toISOString()
    writeFileSync(
      resolve(
        root,
        argument(
          '--report',
          'product-images/reviewed-products-import-' + (apply ? 'applied' : 'dry-run') + '.json',
        ),
      ),
      JSON.stringify(report, null, 2) + '\n',
    )
    console.log(
      JSON.stringify({
        mode: report.mode,
        products: report.products.length,
        categoriesToCreate: report.categoryPlans.length,
        verifiedAssets: report.verifiedAssets,
      }),
    )
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && !/password|postgres(?:ql)?:|access.?key|secret/i.test(error.message)
      ? error.message
      : 'Import failed; sensitive details withheld',
  )
  process.exitCode = 1
})
