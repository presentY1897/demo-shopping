import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { VARIANT_LINE_SELECT } from '../../src/orders/order-lines.js'
import { cartLines, variantsForLines } from '../../src/orders/line-query.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductOption,
  createProductOptionValue,
  createProductVariant,
  createSeller,
  createUser,
  mapVariantOptionValue,
} from '../support/factories.js'

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })
const prisma = () => api.resolve<PrismaService>(PrismaService)

describe('purchase line SQL projection', () => {
  it.each([false, true])(
    'matches Prisma fields, image tie-break and UTC dates (deleted=%s)',
    async (deleted) => {
      const user = await createUser(db)
      const seller = await createSeller(db, { userId: user.id })
      const category = await createCategory(db)
      const product = await createProduct(db, { sellerId: seller.id, categoryId: category.id })
      const variant = await createProductVariant(db, { productId: product.id, sellerId: seller.id })
      for (const sortOrder of [2, 1]) {
        const option = await createProductOption(db, { productId: product.id, sortOrder })
        const value = await createProductOptionValue(db, {
          optionId: option.id,
          value: `value-${sortOrder}`,
        })
        await mapVariantOptionValue(db, {
          productId: product.id,
          variantId: variant.id,
          optionId: option.id,
          optionValueId: value.id,
        })
      }
      const images = [
        { id: randomUUID(), url: 'https://example.test/one.svg' },
        { id: randomUUID(), url: 'https://example.test/two.png' },
      ]
      await prisma().productImage.createMany({
        data: images.map((image) => ({
          ...image,
          productId: product.id,
          sortOrder: 0,
        })),
      })
      if (deleted) {
        const deletedAt = new Date('2026-09-11T01:23:45.678Z')
        await prisma().product.update({ where: { id: product.id }, data: { deletedAt } })
        await prisma().productVariant.update({ where: { id: variant.id }, data: { deletedAt } })
      }
      const expected = await prisma().productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        select: VARIANT_LINE_SELECT,
      })
      const [joined] = await variantsForLines(prisma(), [variant.id])
      const { stock: _stock, ...actual } = joined!
      const canonical = (row: typeof actual) => ({
        ...row,
        optionValues: [...row.optionValues].sort((a, b) =>
          a.optionValue.optionId.localeCompare(b.optionValue.optionId),
        ),
        product: {
          ...row.product,
          options: [...row.product.options].sort((a, b) => a.id.localeCompare(b.id)),
        },
      })
      expect(canonical(actual)).toEqual(canonical(expected))
      expect(actual.product.images[0]?.url).toBe(
        images.sort((a, b) => a.id.localeCompare(b.id))[0]?.url,
      )
      const cart = await prisma().cart.create({
        data: {
          userId: user.id,
          items: {
            create: {
              variant: { connect: { id: variant.id } },
              quantity: 1,
              priceAtAdded: 10000,
            },
          },
        },
        include: { items: true },
      })
      expect(await cartLines(prisma(), user.id, [])).toEqual([])
      expect(await cartLines(prisma(), randomUUID())).toEqual([])
      expect(await cartLines(prisma(), user.id, [randomUUID()])).toEqual([])
      const [line] = await cartLines(prisma(), user.id)
      expect(line?.updatedAt).toEqual(cart.items[0]?.updatedAt)
      expect(line?.id).toBe(cart.items[0]?.id)
    },
  )
})
