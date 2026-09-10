// Register the reviewed audience samples only in the isolated local preview database.
require('reflect-metadata')
const { readFileSync, writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { NestFactory } = require('@nestjs/core')
const { createProductRequestSchema, createCategoryRequestSchema } = require('@shopping/shared')
const { AppModule } = require('../dist/app.module.js')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')
const { CategoryService } = require('../dist/catalog/category.service.js')

const root = resolve(__dirname, '../../..')
const manifestPath = resolve(
  root,
  'apps/shop/public/product-image-sets/audience-samples-v1/manifest.json',
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
const shared = [
  'front',
  'model-male-front',
  'model-female-front',
  'model-male-side',
  'model-female-side',
  'model-male-back',
  'model-female-back',
  'back',
  'side',
  'texture',
  'model-male-editorial',
  'model-female-editorial',
]
const presentation = {
  menswear: {
    color: '네이비',
    hex: '#1b2c4b',
    price: 69000,
    sizes: ['L', 'XL'],
    description:
      '밴드카라와 여유 있는 반소매 실루엣의 네이비 린넨 셔츠입니다. 단정한 앞여밈과 포켓 없는 디자인으로 가볍게 입기 좋습니다.',
  },
  womenswear: {
    color: '베이지',
    hex: '#d7c7af',
    price: 79000,
    sizes: ['S', 'L', 'XL'],
    description:
      '브이넥과 드롭 숄더의 베이지 코튼 가디건입니다. 잔잔한 니트 조직과 소매·밑단의 리브 마감으로 부드러운 인상을 줍니다.',
  },
  unisex: {
    color: '아이보리',
    hex: '#f3eee3',
    price: 29000,
    sizes: ['S', 'M', 'L', 'XL'],
    description:
      '남녀 공용 사이즈로 기획한 코튼 저지 티셔츠입니다. 여유 있는 스트레이트 핏과 드롭 숄더, 장식 없는 크루넥 디자인입니다. 같은 제품의 남녀 착용 모습을 함께 확인할 수 있습니다.',
  },
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
  const checked = JSON.parse(
    execFileSync(
      'python3',
      [resolve(root, 'skills/product-image-set/scripts/pipeline.py'), 'check', manifestPath],
      { encoding: 'utf8' },
    ),
  )
  if (!checked.complete)
    throw new Error('Every required image must pass review before registration')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })
  try {
    const prisma = app.get(PrismaService)
    // Internal seed principal; no account or permission grants are persisted.
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
    const results = []
    for (const spec of manifest.spec.products) {
      const source = await prisma.product.findFirstOrThrow({
        where: {
          id: spec.sourceProductId ?? manifest.spec.products[0].sourceProductId,
          status: 'ACTIVE',
          seller: { is: { status: 'ACTIVE', user: { is: { isDemo: false } } } },
        },
        include: { seller: true },
      })
      const props = presentation[spec.audience]
      let categoryId = source.categoryId
      if (spec.audience === 'unisex') {
        const parentId = await category('유니섹스', 'unisex', null)
        categoryId = await category('티셔츠', 'unisex-t-shirts', parentId)
      }
      const shots = spec.audience === 'unisex' ? shared : ordinary
      const images = shots.map((shot) => {
        const job = manifest.jobs.find((j) => j.id === `${spec.id}/${shot}`)
        if (job?.status !== 'accepted') throw new Error(`Unreviewed image: ${spec.id}/${shot}`)
        return {
          url: `${host}/product-image-sets/audience-samples-v1/${job.output}`,
          alt: `${spec.name} · ${job.label.replace('female ·', '여성 ·').replace('male ·', '남성 ·')} — AI 생성 이미지`,
        }
      })
      const input = createProductRequestSchema.parse({
        categoryId,
        name: spec.name,
        description: `${props.description}\n\n가상 상품의 AI 생성 이미지입니다. 모델의 착용 사이즈와 실측 정보는 제공하지 않습니다.`,
        status: 'ACTIVE',
        attributes:
          spec.audience === 'unisex' ? {} : { ...source.attributes, color: [props.color] },
        images,
        options: [
          { name: '색상', values: [{ value: props.color, meta: { hex: props.hex } }] },
          { name: '사이즈', values: props.sizes.map((value) => ({ value })) },
        ],
        variantDefaults: { price: props.price, stock: 20 },
        skuPrefix: `AUD-${spec.audience.toUpperCase()}`,
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
        await app.get(ProductService).update(principal, id, {
          version: existing.version,
          images,
          name: input.name,
          description: input.description,
        })
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
        images: images.length,
        url: `${host}/products/${id}`,
      })
    }
    writeFileSync(
      resolve(root, 'product-images/audience-samples-products.json'),
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
