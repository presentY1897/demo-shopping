import { randomBytes, randomUUID } from 'node:crypto'

import type { Prisma, SellerOrderStatus } from '@prisma/client'

import { orderNumberOf, ORDER_NUMBER_SUFFIX_LENGTH } from '../orders/order-number.js'
import type { VirtualCardService } from '../payment/virtual-card.service.js'
import type { PointsService } from '../points/points.service.js'
import { amountsOf, type SettlementPeriod } from '../settlement/settlement-calc.js'
import {
  carrierNameOf,
  trackingNumberFrom,
  TRACKING_NUMBER_DIGITS,
  trackingEventDescriptionOf,
  pickupHubOf,
} from '../shipping/shipment-rules.js'
import type { StockService } from '../stock/stock.service.js'

const MINUTE = 60_000
const PATH = ['PAYMENT_PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'] as const

export interface DemoTradeInput {
  readonly buyerId: string
  readonly sellerId: string
  readonly sellerUserId: string
  readonly brandName: string
  readonly cardId: string
  readonly variantId: string
  readonly productId: string
  readonly productName: string
  readonly optionLabel: string
  readonly sku: string
  readonly thumbnailUrl: string | null
  readonly unitPrice: number
  readonly commissionRateBp: number
  readonly status: SellerOrderStatus
  readonly at: Date
  readonly settlement?: SettlementPeriod
}

/** A bounded fixture graph with the same financial and stock writers as live orders. */
export async function buildDemoTrade(
  tx: Prisma.TransactionClient,
  input: DemoTradeInput,
  services: { cards: VirtualCardService; stock: StockService; points: PointsService },
): Promise<{ sellerOrderId: string; itemId: string }> {
  const checkoutId = randomUUID()
  const paymentId = randomUUID()
  const at = (step: number): Date => new Date(input.at.getTime() + step * MINUTE)
  const states = PATH.slice(0, PATH.indexOf(input.status as (typeof PATH)[number]) + 1)
  const order = await tx.order.create({
    data: {
      userId: input.buyerId,
      checkoutId,
      orderNumber: orderNumberOf(input.at, randomBytes(ORDER_NUMBER_SUFFIX_LENGTH)),
      recipientName: '체험 구매자',
      recipientPhone: '010-0000-0000',
      postalCode: '06234',
      addressLine1: '서울특별시 강남구 테헤란로 1',
      addressLine2: '데모빌딩 10층',
      totalProductAmount: input.unitPrice,
      paidAmount: input.unitPrice,
      createdAt: input.at,
      updatedAt: at(1),
      cartCleanedAt: at(1),
      sellerOrders: {
        create: {
          sellerId: input.sellerId,
          brandName: input.brandName,
          status: input.status,
          productAmount: input.unitPrice,
          paidAmount: input.unitPrice,
          createdAt: input.at,
          updatedAt: at(states.length - 1),
          items: {
            create: {
              variantId: input.variantId,
              productId: input.productId,
              productSnapshot: {
                productId: input.productId,
                productName: input.productName,
                optionLabel: input.optionLabel,
                sku: input.sku,
                thumbnailUrl: input.thumbnailUrl,
                brandName: input.brandName,
              },
              unitPrice: input.unitPrice,
              quantity: 1,
              productAmount: input.unitPrice,
              commissionRateBp: input.commissionRateBp,
              createdAt: input.at,
              updatedAt: input.at,
            },
          },
          statusHistory: {
            create: states.map((state, index) => ({
              fromStatus: states[index - 1] ?? null,
              toStatus: state,
              actor:
                state === 'CONFIRMED'
                  ? 'BUYER'
                  : state === 'PREPARING' || state === 'SHIPPED'
                    ? 'SELLER'
                    : 'SYSTEM',
              actorId:
                state === 'CONFIRMED'
                  ? input.buyerId
                  : state === 'PREPARING' || state === 'SHIPPED'
                    ? input.sellerUserId
                    : null,
              reason: '데모 체험용 거래 이력',
              createdAt: at(index),
            })),
          },
        },
      },
    },
    select: { id: true, sellerOrders: { select: { id: true, items: { select: { id: true } } } } },
  })
  const part = order.sellerOrders[0]
  const item = part?.items[0]
  if (part === undefined || item === undefined)
    throw new Error('데모 주문 항목 생성에 실패했습니다.')

  await tx.stockReservation.create({
    data: {
      variantId: input.variantId,
      userId: input.buyerId,
      checkoutId,
      quantity: 1,
      status: 'CONFIRMED',
      expiresAt: at(15),
      settledAt: at(1),
      createdAt: input.at,
      updatedAt: at(1),
    },
  })
  await services.stock.apply(tx, {
    variantId: input.variantId,
    type: 'SALE',
    quantity: -1,
    refType: 'ORDER_ITEM',
    refId: item.id,
    reason: '데모 체험 주문의 결제 확정',
  })
  await tx.payment.create({
    data: {
      id: paymentId,
      orderId: order.id,
      provider: 'VIRTUAL_CARD',
      status: 'PAID',
      authorizedAmount: input.unitPrice,
      methodRef: input.cardId,
      paymentKey: paymentId,
      approvedAt: at(1),
      createdAt: input.at,
      updatedAt: at(1),
      events: {
        create: [
          { kind: 'REQUESTED', createdAt: input.at },
          { kind: 'AUTHORIZED', fromStatus: 'READY', toStatus: 'AUTHORIZED', createdAt: at(1) },
          { kind: 'CAPTURED', fromStatus: 'AUTHORIZED', toStatus: 'PAID', createdAt: at(1) },
        ],
      },
    },
  })
  await services.cards.chargeWithin(tx, input.cardId, input.unitPrice, paymentId, at(1))

  if (states.includes('SHIPPED')) {
    const delivered = states.includes('DELIVERED')
    const trackingNumber = trackingNumberFrom('GA', randomBytes(TRACKING_NUMBER_DIGITS))
    const kinds = delivered
      ? (['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const)
      : (['PICKED_UP'] as const)
    await tx.shipment.create({
      data: {
        sellerOrderId: part.id,
        carrierCode: 'GA',
        carrierName: carrierNameOf('GA'),
        trackingNumber,
        status: delivered ? 'DELIVERED' : 'READY',
        shippedAt: at(3),
        deliveredAt: delivered ? at(4) : null,
        createdAt: at(3),
        updatedAt: delivered ? at(4) : at(3),
        events: {
          create: kinds.map((kind, index) => ({
            kind,
            location: pickupHubOf('GA'),
            description: trackingEventDescriptionOf(kind),
            occurredAt: new Date(at(3).getTime() + (index * MINUTE) / 3),
            createdAt: at(4),
          })),
        },
      },
    })
    await tx.sellerOrder.update({
      where: { id: part.id },
      data: { trackingNumber, updatedAt: at(states.length - 1) },
    })
  }
  if (input.status === 'CONFIRMED') {
    await services.points.earnWithin(
      tx,
      {
        userId: input.buyerId,
        paidAmount: input.unitPrice,
        refType: 'SELLER_ORDER',
        refId: part.id,
      },
      at(5),
    )
  }
  if (input.settlement !== undefined) {
    const amounts = amountsOf([
      {
        unitPrice: input.unitPrice,
        quantity: 1,
        returnedQuantity: 0,
        commissionRateBp: input.commissionRateBp,
        sellerCouponDiscountAmount: 0,
      },
    ])
    await tx.settlement.create({
      data: {
        sellerId: input.sellerId,
        periodStart: input.settlement.start,
        periodEnd: input.settlement.end,
        ...amounts,
        returnAdjustmentAmount: 0,
        createdAt: input.settlement.end,
        updatedAt: input.settlement.end,
        items: {
          create: {
            sellerOrderId: part.id,
            type: 'SALE',
            ...amounts,
            createdAt: input.settlement.end,
          },
        },
      },
    })
  }
  return { sellerOrderId: part.id, itemId: item.id }
}

export async function buildDemoClaim(
  tx: Prisma.TransactionClient,
  input: { sellerOrderId: string; itemId: string; buyerId: string; shippingFee: number; now: Date },
): Promise<void> {
  await tx.orderItem.update({
    where: { id: input.itemId },
    data: { claimedQuantity: 1, updatedAt: input.now },
  })
  await tx.claimRequest.create({
    data: {
      sellerOrderId: input.sellerOrderId,
      requestedById: input.buyerId,
      type: 'RETURN',
      status: 'RETURN_REQUESTED',
      fault: 'SELLER',
      reason: '체험용 상품 하자 반품 신청',
      createdAt: input.now,
      updatedAt: input.now,
      items: {
        create: {
          orderItemId: input.itemId,
          quantity: 1,
          createdAt: input.now,
          updatedAt: input.now,
        },
      },
      statusHistory: {
        create: {
          toStatus: 'RETURN_REQUESTED',
          actor: 'BUYER',
          actorId: input.buyerId,
          reason: '체험용 상품 하자 반품 신청',
          createdAt: input.now,
        },
      },
      returnDetail: {
        create: {
          reason: 'DEFECTIVE',
          feeBearer: 'SELLER',
          returnShippingFee: input.shippingFee,
          createdAt: input.now,
          updatedAt: input.now,
        },
      },
    },
  })
}
