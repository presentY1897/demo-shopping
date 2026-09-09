// Register the generated coat in the isolated local database through ProductService.
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { createProductRequestSchema } = require('@shopping/shared')
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
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  })
  try {
    const prisma = app.get(PrismaService)
    const held = await prisma.appMeta.findUnique({ where: { key: 'preview.coat.productId' } })
    const source = await prisma.product.findFirst({
      where: {
        name: { contains: '코트' },
        status: 'ACTIVE',
        seller: { is: { status: 'ACTIVE', user: { is: { isDemo: false } } } },
      },
      include: { seller: true },
    })
    if (!source) throw new Error('An active seeded coat/category/seller is required')
    const host = 'http://localhost:3015'
    const base = `${host}/product-image-sets/coat-complete-v2/images/camel-wool-coat`
    const variants = `${host}/product-image-sets/coat-complete-v2/images/camel-wool-coat`
    const labels = {
      front: '상품 정면',
      back: '상품 후면',
      side: '상품 측면',
      texture: '소재 확대',
      'model-front': '모델 착용 정면',
      'model-side': '모델 착용 측면',
      'model-back': '모델 착용 후면',
      editorial: '연출컷',
    }
    const gallery = (prefix, keys, label) =>
      keys.map((key) => ({
        url: `${prefix}${key}.png`,
        alt: `${label} · ${labels[key]} — AI 생성 이미지`,
      }))
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
    const camel = gallery(`${base}/`, shots, '카멜 울 코트')
    const colorValues = [
      { value: '카멜', meta: { hex: '#aa8057', gallery: JSON.stringify(camel) } },
      {
        value: '네이비',
        meta: {
          hex: '#1b2c4b',
          gallery: JSON.stringify(gallery(`${variants}/variant-navy-`, shots, '네이비 울 코트')),
        },
      },
      {
        value: '차콜',
        meta: {
          hex: '#505152',
          gallery: JSON.stringify(gallery(`${variants}/variant-charcoal-`, shots, '차콜 울 코트')),
        },
      },
    ]
    const materialValues = [
      { value: '울 혼방' },
      {
        value: '헤링본 울',
        meta: {
          galleryPriority: 10,
          gallery: JSON.stringify(
            gallery(`${variants}/variant-herringbone-`, shots, '카멜 헤링본 울 코트'),
          ),
        },
      },
    ]
    const sizes = ['S', 'M', 'L']
    const input = createProductRequestSchema.parse({
      categoryId: source.categoryId,
      name: '오버핏 울 발마칸 코트',
      description:
        '길게 떨어지는 오버핏 실루엣과 래글런 소매의 울 발마칸 코트입니다. 카멜·네이비·차콜 컬러를 선택할 수 있으며, 카멜 컬러는 헤링본 울 소재도 준비되어 있습니다.\n\n가상 상품의 AI 생성 이미지입니다.',
      status: 'ACTIVE',
      attributes: {
        fit: '오버사이즈',
        material: '울',
        season: ['겨울'],
        color: ['브라운', '네이비', '그레이'],
      },
      images: camel,
      options: [
        { name: '색상', values: colorValues },
        { name: '소재', values: materialValues },
        { name: '사이즈', values: sizes.map((value) => ({ value })) },
      ],
      variantDefaults: { price: 189000, listPrice: 249000, stock: 20 },
      variants: colorValues.flatMap((color, ci) =>
        materialValues.flatMap((material, mi) =>
          sizes.map((size, si) => ({
            optionValues: [color.value, material.value, size],
            sku: `IMGCOAT-${ci}-${mi}-${si}`,
            isActive: mi === 0 || ci === 0,
            stock: mi === 0 || ci === 0 ? 20 : 0,
          })),
        ),
      ),
    })
    if (held) {
      const existing = await prisma.product.findUniqueOrThrow({ where: { id: held.value } })
      await app.get(ProductService).update(
        {
          userId: source.seller.userId,
          sellerId: source.sellerId,
          roles: ['BUYER', 'SELLER_OWNER'],
          app: 'seller',
        },
        held.value,
        { version: existing.version, options: input.options, images: input.images },
      )
      console.log(`http://localhost:3015/products/${held.value}`)
      return
    }
    const result = await app.get(ProductService).create(
      {
        userId: source.seller.userId,
        sellerId: source.sellerId,
        roles: ['BUYER', 'SELLER_OWNER'],
        app: 'seller',
      },
      input,
    )
    await prisma.appMeta.upsert({
      where: { key: 'preview.coat.productId' },
      create: { key: 'preview.coat.productId', value: result.product.id },
      update: { value: result.product.id },
    })
    console.log(`http://localhost:3015/products/${result.product.id}`)
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
