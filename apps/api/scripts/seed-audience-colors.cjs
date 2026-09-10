// Attach complete reviewed color galleries to the isolated local sample products.
require('reflect-metadata')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { NestFactory } = require('@nestjs/core')
const { updateProductRequestSchema } = require('@shopping/shared')
const { AppModule } = require('../dist/app.module.js')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
const { PrismaService } = require('../dist/prisma/prisma.service.js')
const { ProductService } = require('../dist/catalog/product.service.js')

const definitions = [
  {
    slug: 'mens-navy-band-collar-shirt',
    price: 69000,
    colors: [
      ['네이비', '#1b2c4b', ''],
      ['아이보리', '#f3eee3', 'ivory'],
      ['차콜', '#414347', 'charcoal'],
    ],
    attributeColors: ['네이비', '화이트', '그레이'],
    description:
      '밴드카라와 여유 있는 반소매 실루엣의 린넨 셔츠입니다. 네이비·아이보리·차콜 컬러를 선택할 수 있습니다. 단정한 앞여밈과 포켓 없는 디자인입니다.',
  },
  {
    slug: 'womens-beige-cardigan',
    price: 79000,
    colors: [
      ['베이지', '#d9c5a7', ''],
      ['버건디', '#702c3d', 'burgundy'],
      ['화이트', '#ffffff', 'white'],
    ],
    attributeColors: ['베이지', '버건디', '화이트'],
    description:
      '브이넥과 여유 있는 긴소매 실루엣의 코튼 가디건입니다. 베이지·버건디·화이트 컬러를 선택할 수 있습니다. 브라운 버튼과 골지 소매·밑단으로 마무리했습니다.',
  },
  {
    slug: 'unisex-ivory-tee',
    price: 29000,
    colors: [
      ['아이보리', '#f3eee3', ''],
      ['네이비', '#1b2c4b', 'navy'],
      ['블랙', '#202020', 'black'],
    ],
    description:
      '남녀 공용으로 구성한 여유 있는 스트레이트 핏의 코튼 저지 티셔츠입니다. 아이보리·네이비·블랙 컬러를 선택할 수 있습니다. 각 색상에서 남성과 여성의 착용 모습을 모두 확인할 수 있습니다.',
  },
]
const commonShots = [
  'front',
  'model-front',
  'model-side',
  'model-back',
  'back',
  'side',
  'texture',
  'editorial',
]
const unisexShots = [
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
const labels = {
  front: '상품 앞면',
  back: '상품 뒷면',
  side: '상품 옆면',
  texture: '소재 확대',
  'model-front': '착용 앞면',
  'model-side': '착용 옆면',
  'model-back': '착용 뒷면',
  editorial: '스타일링',
  'model-male-front': '남성 착용 앞면',
  'model-male-side': '남성 착용 옆면',
  'model-male-back': '남성 착용 뒷면',
  'model-male-editorial': '남성 스타일링',
  'model-female-front': '여성 착용 앞면',
  'model-female-side': '여성 착용 옆면',
  'model-female-back': '여성 착용 뒷면',
  'model-female-editorial': '여성 스타일링',
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
  const root = resolve(__dirname, '../../..')
  const manifestPath = resolve(
    root,
    'apps/shop/public/product-image-sets/audience-colors-v1/manifest.json',
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
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })
  try {
    const prisma = app.get(PrismaService)
    const results = []
    for (const definition of definitions) {
      const held = await prisma.appMeta.findUniqueOrThrow({
        where: { key: `preview.${definition.slug}.productId` },
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
      const shots = definition.slug === 'unisex-ivory-tee' ? unisexShots : commonShots
      const gallery = (color, variant) =>
        shots.map((shot) => {
          const id = `${definition.slug}/${variant ? `variant-${variant}-` : ''}${shot}`
          const job = manifest.jobs.find((entry) => entry.id === id)
          if (!job || job.status !== 'accepted') throw new Error(`Missing reviewed image: ${id}`)
          return {
            url: `http://localhost:3015/product-image-sets/audience-colors-v1/${job.output}`,
            alt: `${color} ${product.name} · ${labels[shot]} — AI 생성 이미지`,
          }
        })
      const options = product.options.map((option) => ({
        name: option.name,
        values: option.values.map((value) => ({
          value: value.value,
          ...(value.meta ? { meta: value.meta } : {}),
        })),
      }))
      const colors = options.find((option) => option.name === '색상')
      if (!colors) throw new Error(`Missing color option: ${definition.slug}`)
      for (const [value, hex, variant] of definition.colors) {
        const index = colors.values.findIndex((entry) => entry.value === value)
        const entry = {
          value,
          meta: {
            ...(index >= 0 ? colors.values[index].meta : {}),
            hex,
            gallery: JSON.stringify(gallery(value, variant)),
          },
        }
        if (index < 0) colors.values.push(entry)
        else colors.values[index] = entry
      }
      const input = updateProductRequestSchema.parse({
        version: product.version,
        description: `${definition.description}\n\n가상 상품의 AI 생성 이미지입니다. 모델의 착용 사이즈와 실측 정보는 제공하지 않습니다.`,
        ...(definition.attributeColors
          ? { attributes: { ...product.attributes, color: definition.attributeColors } }
          : {}),
        images: gallery(definition.colors[0][0], ''),
        options,
        variantDefaults: { price: definition.price, stock: 20 },
        skuPrefix: `AUD-${definition.slug}-COLORS`,
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
      results.push({
        slug: definition.slug,
        name: product.name,
        productId: product.id,
        colors: definition.colors.map(([color]) => color),
        imagesPerColor: shots.length,
        totalImages: shots.length * definition.colors.length,
        url: `http://localhost:3015/products/${product.id}`,
      })
    }
    writeFileSync(
      resolve(root, 'product-images/audience-colors-products.json'),
      JSON.stringify(results, null, 2) + '\n',
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
