// Add one reviewed color to the existing local sample through ProductService.
require('reflect-metadata')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { NestFactory } = require('@nestjs/core')
const { updateProductRequestSchema } = require('@shopping/shared')
const { AppModule } = require('../dist/app.module.js')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')

async function main() {
  const { config } = await loadAppConfig()
  const db = new URL(config.database.url)
  if (
    !['localhost', '127.0.0.1'].includes(db.hostname) ||
    db.pathname !== '/shopping_image_preview'
  ) {
    throw new Error('This seed only targets the isolated local shopping_image_preview database')
  }
  const root = resolve(__dirname, '../../..')
  const manifestPath = resolve(
    root,
    'apps/shop/public/product-image-sets/shirt-ivory-v1/manifest.json',
  )
  const checked = JSON.parse(
    execFileSync(
      'python3',
      [resolve(root, 'skills/product-image-set/scripts/pipeline.py'), 'check', manifestPath],
      { encoding: 'utf8' },
    ),
  )
  if (!checked.complete) throw new Error('Incomplete reviewed image set')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pid = 'mens-navy-band-collar-shirt'
  const shots = [
    'front',
    'model-front',
    'model-side',
    'model-back',
    'back',
    'side',
    'texture',
    'editorial',
  ]
  const gallery = (prefix, color) =>
    shots.map((shot) => {
      const job = manifest.jobs.find((j) => j.id === `${pid}/${prefix}${shot}`)
      return {
        url: `http://localhost:3015/product-image-sets/shirt-ivory-v1/${job.output}`,
        alt: `${color} 린넨 셔츠 · ${shot} — AI 생성 이미지`,
      }
    })
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })
  try {
    const prisma = app.get(PrismaService)
    const held = await prisma.appMeta.findUniqueOrThrow({
      where: { key: `preview.${pid}.productId` },
    })
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: held.value },
      include: {
        seller: true,
        options: {
          orderBy: { sortOrder: 'asc' },
          include: { values: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    })
    const options = product.options.map((o) => ({
      name: o.name,
      values: o.values.map((v) => ({ value: v.value, ...(v.meta ? { meta: v.meta } : {}) })),
    }))
    const colors = options.find((o) => o.name === '색상')
    if (!colors) throw new Error('Missing color option')
    for (const [value, hex, prefix] of [
      ['네이비', '#1b2c4b', ''],
      ['아이보리', '#f3eee3', 'variant-ivory-'],
    ]) {
      const entry = { value, meta: { hex, gallery: JSON.stringify(gallery(prefix, value)) } }
      const index = colors.values.findIndex((v) => v.value === value)
      if (index < 0) colors.values.push(entry)
      else colors.values[index] = entry
    }
    const input = updateProductRequestSchema.parse({
      version: product.version,
      description:
        '밴드카라와 여유 있는 반소매 실루엣의 린넨 셔츠입니다. 네이비·아이보리 컬러를 선택할 수 있습니다. 단정한 앞여밈과 포켓 없는 디자인입니다.\n\n가상 상품의 AI 생성 이미지입니다. 모델의 착용 사이즈와 실측 정보는 제공하지 않습니다.',
      attributes: { ...product.attributes, color: ['네이비', '화이트'] },
      images: gallery('', '네이비'),
      options,
      variantDefaults: { price: 69000, stock: 20 },
      skuPrefix: 'AUD-MENS-IVORY',
    })
    await app.get(ProductService).update(
      {
        userId: product.seller.userId,
        sellerId: product.sellerId,
        roles: ['BUYER', 'SELLER_OWNER'],
        app: 'seller',
      },
      product.id,
      input,
    )
    console.log(`http://localhost:3015/products/${product.id}`)
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
