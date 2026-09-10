// Register the reviewed dozen samples only in the isolated local preview database.
require('reflect-metadata')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { CategoryService } = require('../dist/catalog/category.service.js')
const { NestFactory } = require('@nestjs/core')
const {
  createProductRequestSchema,
  updateProductRequestSchema,
  createCategoryRequestSchema,
} = require('@shopping/shared')
const { AppModule } = require('../dist/app.module.js')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')

const root = resolve(__dirname, '../../..')
const lanes = ['a', 'b', 'c']
const manifestFolders = ['dozen-a-v1', 'dozen-b-v1', 'dozen-c-v1']
const manifestPaths = manifestFolders.map((folder) =>
  resolve(root, `apps/shop/public/product-image-sets/${folder}/manifest.json`),
)
const host = 'http://localhost:3015'
const ordinary = [
  'front',
  'model-front',
  'model-side',
  'model-back',
  'back',
  'side',
  'texture',
  'editorial',
]
const specs = JSON.parse(
  readFileSync(resolve(root, 'product-images/dozen-v1.json'), 'utf8'),
).products
const categorySlugs = {
  가방: 'lifestyle-bags',
  지갑: 'lifestyle-wallets',
  액세서리: 'lifestyle-accessories',
  '데스크 소품': 'lifestyle-desk',
  '독서 소품': 'lifestyle-reading',
}

async function main() {
  const { config } = await loadAppConfig()
  const db = new URL(config.database.url)
  if (
    !['localhost', '127.0.0.1'].includes(db.hostname) ||
    db.pathname !== '/shopping_image_preview'
  ) {
    throw new Error('This seed only targets the isolated local shopping_image_preview database')
  }
  const manifests = manifestPaths.map((manifestPath, index) => {
    const checked = JSON.parse(
      execFileSync(
        'python3',
        [resolve(root, 'skills/product-image-set/scripts/pipeline.py'), 'check', manifestPath],
        { encoding: 'utf8' },
      ),
    )
    if (!checked.complete)
      throw new Error('Every required image must pass review before registration')
    return {
      lane: lanes[index],
      folder: manifestFolders[index],
      data: JSON.parse(readFileSync(manifestPath, 'utf8')),
    }
  })
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })
  try {
    const prisma = app.get(PrismaService)
    const admin = { userId: randomUUID(), roles: ['ADMIN_SUPER'], app: 'admin' }
    const category = async (name, slug, parentId) => {
      const existing = await prisma.category.findFirst({ where: { slug, deletedAt: null } })
      if (existing) {
        if (existing.name !== name || existing.parentId !== parentId || !existing.isActive)
          throw new Error(`Conflicting category ${slug}`)
        return existing.id
      }
      return (
        await app
          .get(CategoryService)
          .create(admin, createCategoryRequestSchema.parse({ name, slug, parentId }))
      ).category.id
    }
    const source = await prisma.product.findFirstOrThrow({
      where: {
        id: '01a07b26-190e-7088-b1f7-0af27e1357c8',
        status: 'ACTIVE',
        seller: { is: { status: 'ACTIVE', user: { is: { isDemo: false } } } },
      },
      include: { seller: true },
    })
    const results = []
    for (const spec of specs) {
      const props = spec
      const sourceManifest = manifests.find(({ data }) =>
        data.spec.products.some((p) => p.id === spec.id),
      )
      if (!sourceManifest) throw new Error(`Missing manifest for ${spec.id}`)
      const manifest = sourceManifest.data
      const folder = sourceManifest.folder
      let categoryId = spec.categoryId
      if (!categoryId) {
        const parentId = await category('라이프스타일', 'lifestyle', null)
        const name = spec.categoryPath.split(' > ')[1]
        if (!categorySlugs[name]) throw new Error(`Unknown category ${name}`)
        categoryId = await category(name, categorySlugs[name], parentId)
      }
      const gallery = (color, variant) =>
        ordinary.map((shot) => {
          const id = `${spec.id}/${variant ? `variant-${variant}-` : ''}${shot}`
          const job = manifest.jobs.find((j) => j.id === id)
          if (job?.status !== 'accepted') throw new Error(`Unreviewed image: ${id}`)
          return {
            url: `${host}/product-image-sets/${folder}/${job.output}`,
            alt: `${spec.name} ${color} · ${spec.shotLabels[shot]} — AI 생성 이미지`,
          }
        })
      const images = gallery(spec.colorLabel, '')
      const options = [
        {
          name: '색상',
          values: [
            { value: spec.colorLabel, meta: { hex: spec.hex, gallery: JSON.stringify(images) } },
          ],
        },
      ]
      if (spec.sizes.length)
        options.push({
          name: '사이즈',
          values: spec.sizes.map((value) => ({ value: String(value) })),
        })
      const input = createProductRequestSchema.parse({
        categoryId,
        name: spec.name,
        description: `${props.description}\n\n가상 상품의 AI 생성 이미지입니다. 실물 판매 상품이 아닌 미리보기용 콘셉트입니다. 치수와 기능은 실물로 검증되지 않았습니다.`,
        status: 'ACTIVE',
        attributes: {},
        images,
        options,
        variantDefaults: { price: props.price, stock: 20 },
        skuPrefix: props.skuPrefix,
      })
      const principal = {
        userId: source.seller.userId,
        sellerId: source.sellerId,
        roles: ['BUYER', 'SELLER_OWNER'],
        app: 'seller',
      }
      const key = `preview.${spec.id}.productId`
      const held = await prisma.appMeta.findUnique({ where: { key } })
      let id = held?.value
      if (id) {
        const existing = await prisma.product.findUniqueOrThrow({ where: { id } })
        await app.get(ProductService).update(
          principal,
          id,
          updateProductRequestSchema.parse({
            version: existing.version,
            images,
            name: input.name,
            attributes: input.attributes,
            description: input.description,
            options,
            variantDefaults: input.variantDefaults,
            skuPrefix: input.skuPrefix,
          }),
        )
      } else {
        id = (await app.get(ProductService).create(principal, input)).product.id
        await prisma.appMeta.create({ data: { key, value: id } })
      }
      results.push({
        audience: spec.audience,
        slug: spec.id,
        name: spec.name,
        productId: id,
        categoryId,
        categoryPath: spec.categoryPath,
        colors: [spec.colorLabel],
        sizes: spec.sizes,
        imagesPerColor: ordinary.length,
        totalImages: ordinary.length,
        url: `${host}/products/${id}`,
      })
    }
    writeFileSync(
      resolve(root, 'product-images/dozen-products.json'),
      `${JSON.stringify(results, null, 2)}\n`,
    )
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
