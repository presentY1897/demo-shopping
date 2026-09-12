import { Injectable } from '@nestjs/common'
import type { SellerOrderStatus } from '@prisma/client'
import type { DemoRole } from '@shopping/shared'

import { DEMO_CARD_LIMIT, VirtualCardService } from '../payment/virtual-card.service.js'
import { PointsService } from '../points/points.service.js'
import { SellerService } from '../sellers/seller.service.js'
import { CommissionService } from '../settlement/commission.service.js'
import { weekBefore, type SettlementPeriod } from '../settlement/settlement-calc.js'
import { StockService } from '../stock/stock.service.js'
import { createDemoAccount } from './demo-account.js'
import { cloneCatalogIntoDemoStore } from './demo-catalog-clone.js'
import { demoBrandName, demoEmail, demoName, demoSlug } from './demo-identity.js'
import type { DemoSeedContext } from './demo-seed.service.js'
import { buildDemoClaim, buildDemoTrade } from './demo-trade-builder.js'

const HOUR = 3_600_000
const STATES: Readonly<Record<DemoRole, readonly SellerOrderStatus[]>> = {
  BUYER: ['PAID', 'SHIPPED', 'DELIVERED'],
  SELLER: ['PAID', 'PREPARING', 'SHIPPED', 'CONFIRMED', 'CONFIRMED'],
  ADMIN: ['DELIVERED', 'CONFIRMED'],
}

@Injectable()
export class DemoTradeSeedService {
  constructor(
    private readonly sellers: SellerService,
    private readonly cards: VirtualCardService,
    private readonly stock: StockService,
    private readonly points: PointsService,
    private readonly commissions: CommissionService,
  ) {}

  async seed(role: DemoRole, context: DemoSeedContext): Promise<void> {
    const { tx } = context
    // Preserve successful issuance in empty installations without creating orphan helpers.
    if (
      (await tx.productVariant.findFirst({
        select: { id: true },
        where: {
          deletedAt: null,
          isActive: true,
          price: { gt: 0 },
          product: {
            status: 'ACTIVE',
            deletedAt: null,
            seller: { user: { demoExpiresAt: null, deletedAt: null } },
          },
        },
      })) === null
    )
      return

    const sellerUserId = role === 'SELLER' ? context.userId : await this.helper(context, 'SELLER')
    if (role !== 'SELLER') {
      const token = `${context.token}trade`
      await this.sellers.openDemoStore(
        {
          userId: sellerUserId,
          brandName: `${demoBrandName(token)} 주문체험`,
          slug: demoSlug(token),
          introduction: '주문 체험용으로 함께 생성된 데모 스토어예요.',
        },
        tx,
      )
      const store = await tx.seller.findUniqueOrThrow({
        where: { userId: sellerUserId },
        select: { id: true },
      })
      await cloneCatalogIntoDemoStore(tx, { sellerId: store.id, now: context.now, limit: 1 })
    }
    const store = await tx.seller.findUniqueOrThrow({ where: { userId: sellerUserId } })
    const variant = await tx.productVariant.findFirst({
      where: {
        sellerId: store.id,
        deletedAt: null,
        isActive: true,
        price: { gt: 0 },
        product: { status: 'ACTIVE', deletedAt: null },
      },
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
      include: {
        optionValues: {
          select: {
            optionValue: { select: { value: true, option: { select: { sortOrder: true } } } },
          },
        },
        product: {
          include: { category: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        },
      },
    })
    if (variant === null) return

    const buyerId = role === 'BUYER' ? context.userId : await this.helper(context, 'BUYER')
    const policy = await tx.demoPolicy.findUnique({
      where: { id: 1 },
      select: { virtualCardLimit: true },
    })
    const limit = policy?.virtualCardLimit ?? DEMO_CARD_LIMIT
    const card =
      role === 'BUYER'
        ? await tx.virtualCard.findFirstOrThrow({ where: { userId: buyerId, status: 'ACTIVE' } })
        : await this.cards.issueFor(buyerId, limit, tx)
    const states = STATES[role]
    const unitPrice = Math.min(variant.price, Math.floor(limit / (states.length * 2)))
    const commissionLine = { sellerId: store.id, categoryPath: variant.product.category.path }
    const rateOf = await this.commissions.snapshotFor(tx, [commissionLine])
    // Example sales must leave stock available for a visitor's next purchase.
    await this.stock.apply(tx, {
      variantId: variant.id,
      type: 'INBOUND',
      quantity: states.length + Math.max(0, 1 - variant.stock),
      reason: '데모 거래 예제에 필요한 체험 재고 입고',
    })
    let period = weekBefore(context.now)
    const plans = states
      .map((status, index) => {
        const settlement: SettlementPeriod | undefined = status === 'CONFIRMED' ? period : undefined
        const at =
          settlement === undefined
            ? new Date(context.now.getTime() - (states.length - index) * HOUR)
            : new Date(settlement.start.getTime() + HOUR)
        if (settlement !== undefined) period = weekBefore(settlement.start)
        return { status, index, settlement, at }
      })
      .sort((left, right) => left.at.getTime() - right.at.getTime())
    // Card balanceAfter must also reconcile when history is read chronologically.
    for (const { status, index, settlement, at } of plans) {
      const trade = await buildDemoTrade(
        tx,
        {
          buyerId,
          sellerId: store.id,
          sellerUserId,
          brandName: store.brandName,
          cardId: card.id,
          variantId: variant.id,
          productId: variant.productId,
          productName: variant.product.name,
          sku: variant.sku,
          optionLabel: [...variant.optionValues]
            .sort((a, b) => a.optionValue.option.sortOrder - b.optionValue.option.sortOrder)
            .map((entry) => entry.optionValue.value)
            .join(' / '),
          thumbnailUrl:
            variant.product.images[0]?.thumbnailUrl ?? variant.product.images[0]?.url ?? null,
          unitPrice,
          commissionRateBp: rateOf(commissionLine),
          status,
          at,
          ...(settlement === undefined ? {} : { settlement }),
        },
        { cards: this.cards, stock: this.stock, points: this.points },
      )
      if (role === 'ADMIN' && index === 0) {
        await buildDemoClaim(tx, {
          ...trade,
          buyerId,
          shippingFee: store.shippingFee,
          now: context.now,
        })
      }
    }
  }

  private helper(context: DemoSeedContext, role: 'BUYER' | 'SELLER'): Promise<string> {
    return createDemoAccount(context.tx, {
      email: demoEmail(role, `${context.token}trade`),
      name: demoName(role),
      expiresAt: context.expiresAt,
      roles: role === 'BUYER' ? ['BUYER'] : [],
      now: context.now,
    })
  }
}
