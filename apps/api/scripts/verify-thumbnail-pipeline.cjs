// Runs only against an explicitly named, disposable local database after API build/migrations.
require('reflect-metadata')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createServer } = require('node:http')
const Module = require('node:module')
const ts = require('typescript')
const sharp = require('sharp')
const { Pool } = require('pg')
const { NestFactory } = require('@nestjs/core')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { AppModule } = require('../dist/app.module.js')
const { configureApp } = require('../dist/bootstrap/configure-app.js')
const { ThumbnailService } = require('../dist/thumbnails/thumbnail.service.js')

async function main() {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.pathname.startsWith('/shopping_thumbnail_'),
    'Use a disposable local thumbnail database',
  )
  const pool = new Pool({ connectionString: url.toString(), max: 2 })
  const db = {
    query: async (sql, values) => (await pool.query(sql, values)).rows,
    one: async (sql, values) => {
      const rows = (await pool.query(sql, values)).rows
      assert.equal(rows.length, 1)
      return rows[0]
    },
  }
  // Reuse the repository's SQL factories, including their actual required fields.
  const factoryModule = new Module(join(__dirname, 'thumbnail-factories.cjs'), module)
  factoryModule.paths = module.paths
  factoryModule._compile(
    ts.transpileModule(readFileSync(join(__dirname, '../test/support/factories.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    factoryModule.id,
  )
  const { createUser, createSeller, createCategory, createProduct, createProductVariant } =
    factoryModule.exports
  const original = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#56789a' },
  })
    .png()
    .toBuffer()
  const objects = new Map()
  const server = createServer((req, res) => {
    const key = new URL(req.url, 'http://local').pathname.replace(/^\/(bucket|public)\//, '')
    if (req.method === 'PUT') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        objects.set(key, Buffer.concat(chunks))
        res.end()
      })
      return
    }
    const body = objects.get(key)
    if (!body) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Length', body.length)
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  let app
  try {
    const user = await createUser(db),
      seller = await createSeller(db, { userId: user.id }),
      category = await createCategory(db)
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'ACTIVE',
      minPrice: 10000,
    })
    await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      stock: 5,
      price: 10000,
    })
    const key = `products/${seller.id}/22222222-2222-4222-8222-222222222222.png`
    objects.set(key, original)
    const source = `${origin}/public/${key}`
    await pool.query(
      'INSERT INTO "ProductImage"("id","productId","url") VALUES (gen_random_uuid(),$1,$2)',
      [product.id, source],
    )
    const { config } = await loadAppConfig()
    config.storage = {
      endpoint: origin,
      bucket: 'bucket',
      region: 'auto',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      publicBaseUrl: origin + '/public',
    }
    config.thumbnailGeneration = false
    app = await NestFactory.create(AppModule.forRoot(config), { logger: false })
    await configureApp(app, config)
    await app.listen(0, '127.0.0.1')
    await app.get(ThumbnailService).drain()
    const row = await db.one(
      'SELECT "url","thumbnailUrl","cardImageUrl" FROM "ProductImage" WHERE "productId"=$1',
      [product.id],
    )
    assert.equal(row.url, source)
    assert.ok(row.thumbnailUrl.endsWith('/256.webp'))
    assert.ok(row.cardImageUrl.endsWith('/768.webp'))
    assert.deepEqual(objects.get(key), original)
    const response = await fetch(`${await app.getUrl()}/api/v1/products/${product.id}/detail`)
    assert.equal(response.status, 200)
    const detail = await response.json()
    assert.equal(detail.product.images[0].url, source)
    assert.equal(detail.product.images[0].thumbnailUrl, row.thumbnailUrl)
    for (const [field, edge] of [
      ['thumbnailUrl', 256],
      ['cardImageUrl', 768],
    ]) {
      const response = await fetch(row[field])
      assert.equal(response.status, 200)
      const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
      assert.equal(meta.width, edge)
    }
    const job = await db.one(
      'SELECT "status","attempts" FROM "ProductImageDerivative" WHERE "sourceUrl"=$1',
      [source],
    )
    assert.deepEqual(job, { status: 'READY', attempts: 1 })
    assert.ok(
      (await db.query('SELECT 1 FROM "SearchOutbox" WHERE "productId"=$1', [product.id])).length >
        0,
    )
    console.log(
      'PASS: database trigger -> serial claim -> isolated conversion -> HTTP object uploads -> READY projection -> real public product detail; original unchanged, search update queued',
    )
  } finally {
    if (app) await app.close()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await pool.end()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
