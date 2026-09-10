// Register the reviewed tees samples only in the isolated local preview database.
require('reflect-metadata')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { NestFactory } = require('@nestjs/core')
const { createProductRequestSchema, updateProductRequestSchema } = require('@shopping/shared')
const { AppModule } = require('../dist/app.module.js')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')

const root = resolve(__dirname, '../../..')
const manifestPath = resolve(root, 'apps/shop/public/product-image-sets/tees-v1/manifest.json')
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
const presentation = {
  'womens-oversized-crop-tee': {
    colors: [
      ['버건디', '#7b3038', ''],
      ['블랙', '#202020', 'black'],
      ['카키', '#727451', 'khaki'],
    ],
    price: 83900,
    skuPrefix: 'TEES-WOMENS-CROP',
    description:
      '드롭 숄더와 넉넉한 반소매, 허리선에 닿는 크롭 기장의 코튼 티셔츠입니다. 립 크루넥과 직선 밑단으로 구성한 가상 샘플 디자인입니다. 버건디, 블랙, 카키를 선택할 수 있습니다.',
  },
  'mens-standard-linen-pocket-tee': {
    colors: [
      ['네이비', '#243650', ''],
      ['버건디', '#7b3038', 'burgundy'],
      ['그레이', '#858585', 'gray'],
    ],
    price: 81900,
    skuPrefix: 'TEES-MENS-POCKET',
    description:
      '레귤러 핏과 힙 길이의 반소매 린넨 포켓 티셔츠입니다. 크루넥, 왼쪽 가슴 패치 포켓과 슬럽 질감으로 구성한 가상 샘플 디자인입니다. 네이비, 버건디, 그레이를 선택할 수 있습니다.',
  },
}
const labels = {
  front: '상품 앞면',
  back: '상품 뒷면',
  side: '상품 옆면',
  texture: '소재 확대',
  'model-front': '착용 앞면',
  'model-side': '착용 옆면',
  'model-back': '착용 뒷면',
  editorial: '스타일링',
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
    const results = []
    for (const spec of manifest.spec.products) {
      const source = await prisma.product.findFirstOrThrow({
        where: {
          id: spec.sourceProductId,
          status: 'ACTIVE',
          seller: { is: { status: 'ACTIVE', user: { is: { isDemo: false } } } },
        },
        include: {
          seller: true,
          options: {
            orderBy: { sortOrder: 'asc' },
            include: { values: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      })
      const props = presentation[spec.id]
      const categoryId = source.categoryId
      const gallery = (color, variant) =>
        ordinary.map((shot) => {
          const id = `${spec.id}/${variant ? `variant-${variant}-` : ''}${shot}`
          const job = manifest.jobs.find((j) => j.id === id)
          if (job?.status !== 'accepted') throw new Error(`Unreviewed image: ${id}`)
          return {
            url: `${host}/product-image-sets/tees-v1/${job.output}`,
            alt: `${spec.name} ${color} · ${labels[shot]} — AI 생성 이미지`,
          }
        })
      const images = gallery(props.colors[0][0], '')
      const sizes = source.options.find((o) => o.name === '사이즈')
      if (!sizes) throw new Error('Missing source sizes')
      const options = [
        {
          name: '색상',
          values: props.colors.map(([value, hex, variant]) => ({
            value,
            meta: { hex, gallery: JSON.stringify(gallery(value, variant)) },
          })),
        },
        { name: '사이즈', values: sizes.values.map(({ value }) => ({ value })) },
      ]
      const input = createProductRequestSchema.parse({
        categoryId,
        name: spec.name,
        description: `${props.description}\n\n가상 상품의 AI 생성 이미지입니다. 모델의 착용 사이즈와 실측 정보는 제공하지 않습니다.`,
        status: 'ACTIVE',
        attributes: source.attributes,
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
        sourceProductId: source.id,
        colors: props.colors.map(([color]) => color),
        sizes: sizes.values.map(({ value }) => value),
        imagesPerColor: ordinary.length,
        totalImages: ordinary.length * props.colors.length,
        url: `${host}/products/${id}`,
      })
    }
    writeFileSync(
      resolve(root, 'product-images/tees-products.json'),
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
