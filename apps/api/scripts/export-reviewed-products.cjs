// Export only reviewed preview products; read-only database access.
require('reflect-metadata')
const { readFileSync, writeFileSync, readdirSync, statSync } = require('node:fs')
const { resolve, relative, sep } = require('node:path')
const { createHash } = require('node:crypto')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { createProductRequestSchema } = require('@shopping/shared')
const root = resolve(__dirname, '../../..')
const publicRoot = resolve(root, 'apps/shop/public')
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
async function main() {
  const { config } = await loadAppConfig()
  const db = new URL(config.database.url)
  if (
    !['localhost', '127.0.0.1'].includes(db.hostname) ||
    db.pathname !== '/shopping_image_preview'
  )
    throw Error('Preview DB required')
  const prisma = new PrismaService(config)
  try {
    const keys = (
      await prisma.appMeta.findMany({ where: { key: { startsWith: 'preview.' } } })
    ).filter((m) => m.key.endsWith('.productId'))
    const ids = [...new Set(keys.map((m) => m.value))]
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
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
    const expected = Number(process.argv[2] || 66)
    if (products.length !== expected || products.length !== ids.length)
      throw Error('Unexpected preview product count: ' + products.length)
    const categories = await prisma.category.findMany({ where: { deletedAt: null } })
    const byId = new Map(categories.map((c) => [c.id, c]))
    const accepted = new Map()
    const setsRoot = resolve(publicRoot, 'product-image-sets')
    for (const folder of readdirSync(setsRoot, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    )) {
      const manifestPath = resolve(setsRoot, folder.name, 'manifest.json')
      let manifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      for (const job of manifest.jobs || [])
        if (job.status === 'accepted') {
          const file = resolve(setsRoot, folder.name, job.output)
          accepted.set(file, {
            sha256: job.sha256,
            manifest: relative(root, manifestPath),
            job: job.id,
          })
        }
    }
    const assets = new Map()
    function register(url) {
      const u = new URL(url)
      if (
        !['localhost', '127.0.0.1'].includes(u.hostname) ||
        !u.pathname.startsWith('/product-image-sets/')
      )
        throw Error('Unexpected preview asset origin/path')
      const file = resolve(publicRoot, '.' + decodeURIComponent(u.pathname))
      if (!file.startsWith(setsRoot + sep)) throw Error('Asset outside approved directory')
      const approved = accepted.get(file)
      if (!approved || sha(readFileSync(file)) !== approved.sha256)
        throw Error('Unreviewed or changed asset: ' + relative(root, file))
      assets.set(url, {
        sourceUrl: url,
        file: relative(root, file),
        sizeBytes: statSync(file).size,
        ...approved,
      })
      return url
    }
    const rows = products.map((p) => {
      const options = p.options.map((o) => ({
        name: o.name,
        values: o.values.map((v) => {
          const meta = v.meta && structuredClone(v.meta)
          if (meta?.gallery) for (const image of JSON.parse(meta.gallery)) register(image.url)
          return { value: v.value, ...(meta ? { meta } : {}) }
        }),
      }))
      const input = createProductRequestSchema.parse({
        categoryId: p.categoryId,
        name: p.name,
        description: p.description || undefined,
        status: p.status,
        attributes: p.attributes,
        maxPurchaseQuantity: p.maxPurchaseQuantity ?? undefined,
        images: p.images.map((im) => ({
          url: register(im.url),
          ...(im.alt ? { alt: im.alt } : {}),
        })),
        options,
        variantDefaults: { price: p.variants[0].price, stock: 0 },
        variants: p.variants.map((v) => ({
          optionValues: p.options
            .map((o) => v.optionValues.find((x) => x.optionId === o.id)?.optionValue.value)
            .filter((x) => x !== undefined),
          sku: v.sku,
          price: v.price,
          listPrice: v.listPrice,
          stock: v.stock,
          maxPurchaseQuantity: v.maxPurchaseQuantity,
          isActive: v.isActive,
        })),
      })
      const path = []
      let c = byId.get(p.categoryId)
      while (c) {
        path.unshift({ id: c.id, name: c.name, slug: c.slug })
        c = byId.get(c.parentId)
      }
      return {
        sourceProductId: p.id,
        sourceSellerId: p.sellerId,
        previewKeys: keys.filter((k) => k.value === p.id).map((k) => k.key),
        categoryPath: path,
        input,
      }
    })
    const result = {
      exportedAt: new Date().toISOString(),
      source: 'shopping_image_preview',
      productCount: rows.length,
      assetCount: assets.size,
      totalBytes: [...assets.values()].reduce((n, a) => n + a.sizeBytes, 0),
      products: rows,
      assets: [...assets.values()],
    }
    writeFileSync(
      resolve(root, 'product-images/reviewed-products-export.json'),
      JSON.stringify(result, null, 2) + '\n',
    )
    console.log(
      JSON.stringify({ products: rows.length, assets: assets.size, totalBytes: result.totalBytes }),
    )
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
