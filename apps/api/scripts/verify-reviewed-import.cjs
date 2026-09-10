require('reflect-metadata')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')
const root = path.resolve(__dirname, '../../..')
;(async () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(root, 'product-images/reviewed-products-import-applied.json')),
  )
  const exported = JSON.parse(
    fs.readFileSync(path.join(root, 'product-images/reviewed-products-export.json')),
  )
  const map = JSON.parse(fs.readFileSync(path.join(root, 'product-images/uploaded-assets.json')))
  const urls = new Set(map.assets.map((x) => x.publicUrl))
  const { config } = await loadAppConfig()
  const url = new URL(config.database.url)
  assert.equal(url.port, '5582')
  assert.equal(url.pathname, '/shopping_image_preview')
  url.pathname = '/shopping'
  const prisma = new PrismaService({ ...config, database: { ...config.database, url: url.href } })
  const products = new ProductService(prisma, { now: () => new Date() })
  const results = []
  try {
    for (const item of report.products) {
      const expected = exported.products.find((p) => p.sourceProductId === item.sourceProductId)
      const { product } = await products.storefrontDetail(item.productId)
      assert.equal(product.name, expected.input.name)
      assert.equal(product.images.length, expected.input.images.length)
      assert.equal(product.variants.length, expected.input.variants.length)
      for (const image of product.images) assert.ok(urls.has(image.url))
      for (const option of product.options)
        for (const value of option.values) {
          if (value.meta?.gallery)
            for (const image of JSON.parse(value.meta.gallery)) assert.ok(urls.has(image.url))
        }
      results.push({
        productId: item.productId,
        name: product.name,
        images: product.images.length,
        variants: product.variants.length,
      })
    }
    assert.equal(results.length, 66)
    fs.writeFileSync(
      path.join(root, 'product-images/reviewed-import-storefront-check.json'),
      JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n',
    )
    console.log(
      JSON.stringify({
        storefrontProducts: results.length,
        variants: results.reduce((n, p) => n + p.variants, 0),
        approvedPublicAssets: urls.size,
      }),
    )
  } finally {
    await prisma.$disconnect()
  }
})().catch((error) => {
  console.error(error.code || 'Storefront verification failed; details suppressed')
  process.exitCode = 1
})
