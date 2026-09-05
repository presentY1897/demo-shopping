import { randomBytes, randomUUID } from 'node:crypto'

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  CreateOrderRequest,
  Order,
  OrderItemSnapshot,
  OrderListQuery,
  OrderListResponse,
  OrderResponse,
  OrderStatus,
  PricingDiscount,
  SellerOrder,
  SellerOrderResponse,
} from '@shopping/shared'
import { ORDER_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import {
  accountOwnership,
  accountOwnershipSelect,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { isUniqueViolationOn } from '../common/unique-violation.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ShipmentRow } from '../shipping/shipment.service.js'
import { presentShipment, SHIPMENT_SELECT } from '../shipping/shipment.service.js'
import { ReservationService } from '../reservation/reservation.service.js'
import { ORDER_NUMBER_SUFFIX_LENGTH, orderNumberOf } from './order-number.js'
import { CheckoutService } from './checkout.service.js'
import type { CartLineRow } from './order-lines.js'
import { assertOrderable, policiesOf, toLine } from './order-lines.js'
import type { PlannedSellerOrder } from './order-plan.js'
import { planOrder } from './order-plan.js'
import type { OrderSource } from './order-source.js'
import { priceOf } from './order-source.js'
import type { SellerOrderStatusChanged } from './seller-order-events.js'
import { SellerOrderService } from './seller-order.service.js'

type Tx = Prisma.TransactionClient

/**
 * 주문 생성과 조회 (TASK-0049).
 *
 * **2단이다** (D-023). `Order` 는 결제 단위이고 `SellerOrder` 는 배송·취소·정산의
 * 단위다. 여러 판매자의 물건이 한 주문에 섞이지만 결제는 한 번이고, 상태는 판매자
 * 몫마다 따로 움직인다.
 *
 * 만드는 일이 한 트랜잭션인 이유는 **재고 예약 때문**이다. 세 줄을 주문하다 마지막
 * 줄이 품절이면 앞의 두 예약도 없던 일이 되어야 한다(F5). 트랜잭션 안에서 예약하면
 * 그것이 롤백으로 공짜가 된다 — 예약을 밖에서 잡고 실패 시 보상하는 모양은, 보상이
 * 실패하는 경우를 또 다뤄야 한다.
 *
 * **재고는 한 개도 줄지 않는다** (4.4). 주문은 `PAYMENT_PENDING` 으로 생기고 예약은
 * `HELD` 로 남는다. 확정은 결제 승인(M08)의 일이고, 결제가 오지 않으면 TASK-0051 이
 * TTL 만료로 푼다. 이상해 보이지만 그것이 D-026 의 구조다 — 판 것이 아니라 잡아 둔
 * 것이다.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reservations: ReservationService,
    private readonly checkouts: CheckoutService,
    private readonly transitions: SellerOrderService,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 장바구니에서 고른 줄로 주문 하나를 만든다.
   *
   * `discounts` 를 인자로 받는 이유는 4.2 다. 쿠폰도 적립금도 M11 이라 컨트롤러는
   * 오늘 빈 배열을 넘기지만, **안분해서 저장하는 경로는 지금 만들어 둔다** — 나중에
   * 붙이면 그때 `OrderItem` 에 컬럼을 더하고 저장 코드를 고쳐야 하고, 그 시점에는
   * 이미 저장된 주문들이 그 값을 갖지 않는다.
   *
   * **주문서로 온 요청은 멱등하다** (TASK-0057 4.4). 같은 `checkoutId` 로 두 번째가
   * 오면 첫 번째 주문을 그대로 돌려준다 — 화면이 새로 마운트되면 자기가 만든 주문을
   * 잊고(거절 뒤 새로고침, 결제창을 닫고 주문서로 돌아오기) 같은 주문서로 다시
   * 누르기 때문이다. 재고가 두 몫 잠기지는 않지만 결제되지 않은 주문 한 건이 남고,
   * 그것이 주문 목록에 보이면 산 사람은 자기가 두 번 주문했다고 읽는다.
   *
   * 장바구니에서 온 길에는 이 성질이 없다. 열쇠가 없기 때문이다 — 그 길의
   * `checkoutId` 는 저장 직전에 뽑는 난수라 두 요청이 같은 값을 들고 올 수 없고,
   * 「같은 요청인가」를 물을 수 있는 것이 요청 안에 아무것도 없다.
   */
  async create(
    principal: RequestPrincipal,
    input: CreateOrderRequest,
    discounts: readonly PricingDiscount[] = [],
  ): Promise<OrderResponse> {
    const account = await this.account(principal, 'order.write')
    const placed =
      input.checkoutId === undefined ? null : await this.placedOrder(account.id, input.checkoutId)

    // **이 요청의 나머지는 읽지 않는다 — 배송지가 달라도 그렇다.** 멱등의 뜻은
    // 「같은 주문서에는 같은 답」이고, 그 답은 첫 요청이 남긴 것이지 두 번째 요청의
    // 함수가 아니다. 배송지를 갈아 끼우는 것은 멱등이 아니라 수정이며, 그 주문에는
    // 이미 결제가 붙어 판매자가 주소를 읽었을 수 있다. 다르면 409 로 거절하는 길도
    // 있지만 그러면 주문은 이미 있는데 화면은 그것을 모른 채 오류만 보게 되어,
    // 고치려던 것(화면이 자기 주문을 잊었다)이 하나도 풀리지 않는다. 배송지 변경은
    // 주문 수정의 일이고 그 문은 아직 없다.
    if (placed !== null) return this.get(principal, placed)

    const recipient = await this.recipientOf(account.id, input.addressId)
    const source =
      input.checkoutId === undefined
        ? await this.fromCart(account.id, input.itemIds ?? [])
        : await this.checkouts.linesOf(account.id, input.checkoutId)
    const plan = planOrder(source.lines, priceOf(source, discounts))
    const orderId = await this.place(account.id, recipient, plan, source.checkoutId)

    return this.get(principal, orderId)
  }

  /**
   * 이 주문서로 이미 만들어진 주문. 없으면 `null` 이고 남의 것이면 403 이다.
   *
   * **읽는 것이 먼저인 이유는 속도가 아니다.** 결제가 확정되면(`markPaid`) 그
   * 주문서의 예약은 전부 `CONFIRMED` 가 되어 `HELD` 가 하나도 남지 않고, 그때
   * `CheckoutService.linesOf` 는 「주문서를 찾을 수 없어요」로 답한다. 줄을 먼저
   * 그리는 순서였다면 **결제까지 끝낸 사람의 새로고침이 404** 가 된다 — 이 멱등이
   * 없애려는 바로 그 상황에서.
   *
   * 남의 주문서면 403 이다. 주문이 만들어지기 전에도 남의 `checkoutId` 는
   * `linesOf` 에서 403 이었으므로, 멱등이 새로 알려 주는 것이 없다. 남의 주문은
   * 물론 돌려주지 않는다.
   */
  private async placedOrder(userId: string, checkoutId: string): Promise<string | null> {
    const placed = await this.prisma.order.findUnique({
      where: { checkoutId },
      select: { id: true, userId: true },
    })

    if (placed === null) return null
    if (placed.userId !== userId) throw new ForbiddenException('다른 사람의 주문서예요.')

    return placed.id
  }

  /**
   * 저장한다. 그 사이에 같은 주문서로 남이 먼저 만들었으면 **그 주문이 답이다.**
   *
   * 위의 읽기와 저장 사이는 비어 있다 — 동시에 온 둘은 둘 다 「없다」를 읽고 둘 다
   * 만들러 간다. 그 뒤를 막는 것이 `Order_checkoutId_key` 하나이고, 제약은
   * 애플리케이션이 무엇을 하든 참이다. 어드바이저리 락으로 직렬화하는 길도 있지만
   * 그러려면 잠글 이름을 하나 더 만들어야 하고, 그 이름에 동의하지 않는 코드가
   * 하나만 생겨도 보장이 사라진다.
   *
   * **다시 읽는 일이 트랜잭션 밖인 것이 핵심이다.** Postgres 는 실패한 문장 하나가
   * 트랜잭션 전체를 중단시키므로, 위반을 안에서 잡아 다시 읽으면 그 읽기가
   * 「current transaction is aborted」로 거절된다(`HANDOFF` 가 장바구니에서 겪은
   * 그것). 여기 도달한 시점에 진 쪽의 트랜잭션은 이미 롤백돼 아무것도 남기지
   * 않았고, 이긴 쪽은 커밋을 마쳤다 — 유니크 위반은 상대가 커밋할 때까지 **기다렸다가**
   * 나기 때문이다. 그래서 이 자리의 재조회는 반드시 이긴 주문을 본다.
   *
   * 주문번호 재시도({@link store})와 얽히지 않는다. 저 안쪽은 「번호를 새로 뽑아
   * 전부 다시 한다」만 알고, 이 바깥은 두 시도 중 어느 것이 제약에 걸렸든 같은
   * 판정을 한 번 한다.
   */
  private async place(
    userId: string,
    recipient: Recipient,
    plan: ReturnType<typeof planOrder>,
    held: string | null,
  ): Promise<string> {
    try {
      return await this.store(userId, recipient, plan, held)
    } catch (error: unknown) {
      const winner =
        held === null || !isCheckoutCollision(error) ? null : await this.placedOrder(userId, held)

      if (winner === null) throw error

      return winner
    }
  }

  /** 장바구니에서 온 줄. 이 길에서는 주문이 예약을 **직접** 잡는다. */
  private async fromCart(userId: string, itemIds: readonly string[]): Promise<OrderSource> {
    const rows = await this.orderableLines(userId, itemIds)

    return {
      lines: rows.map((row) => toLine(row)),
      policies: policiesOf(rows),
      // 아직 잡힌 것이 없다. `store` 가 트랜잭션 안에서 잡는다.
      checkoutId: null,
    }
  }

  /**
   * 예약하고 저장한다. 주문번호가 겹치면 **전부 다시 한다.**
   *
   * 다시 하는 단위가 트랜잭션 전체인 것이 중요하다. Postgres 는 트랜잭션 안의 한
   * 문장이 실패하면 그 트랜잭션을 통째로 중단시키므로(TASK-0045 가 장바구니에서
   * 겪었다), 유니크 위반을 안에서 잡아 다른 번호로 다시 쓰는 것은 불가능하다.
   * 롤백된 트랜잭션은 예약도 함께 되돌리므로 재시도가 안전하다.
   *
   * 한 번만 다시 한다. 40비트 난수가 같은 날 두 번 연달아 겹칠 확률은 이미 없는
   * 일이고, 무한히 다시 하는 고리는 **다른 이유로 실패할 때** 영원히 돈다.
   *
   * 주문서 열쇠가 겹친 것은 여기서 다루지 않는다. 다시 해도 같은 열쇠라 같은
   * 제약에 걸리고, 그것은 실패가 아니라 **답이 이미 있다**는 뜻이다 —
   * {@link place} 가 판정한다.
   */
  private async store(
    userId: string,
    recipient: Recipient,
    plan: ReturnType<typeof planOrder>,
    held: string | null,
  ): Promise<string> {
    try {
      return await this.write(userId, recipient, plan, held)
    } catch (error: unknown) {
      if (!isOrderNumberCollision(error)) throw error

      return this.write(userId, recipient, plan, held)
    }
  }

  private write(
    userId: string,
    recipient: Recipient,
    plan: ReturnType<typeof planOrder>,
    held: string | null,
  ): Promise<string> {
    const now = this.clock.now()
    const checkoutId = held ?? randomUUID()

    return this.prisma.$transaction(async (tx) => {
      // 이미 잡힌 주문서에서 왔으면 **다시 잡지 않는다** (TASK-0050 4.3). 두 번
      // 잡으면 한 사람이 같은 물건을 두 몫 잠근다. 그렇지 않은 길에서는 예약이
      // 먼저다 — 저장한 뒤에 잡으면 품절일 때 지울 것이 생기고, 그 지우는 일이
      // 실패하는 경우를 또 다뤄야 한다.
      for (const sellerOrder of held === null ? plan.sellerOrders : []) {
        for (const item of sellerOrder.items) {
          await this.reservations.reserve(tx, {
            variantId: item.line.variantId,
            quantity: item.line.quantity,
            userId,
            checkoutId,
          })
        }
      }

      const order = await tx.order.create({
        data: {
          orderNumber: orderNumberOf(now, randomBytes(ORDER_NUMBER_SUFFIX_LENGTH)),
          userId,
          checkoutId,
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
          postalCode: recipient.postalCode,
          addressLine1: recipient.addressLine1,
          addressLine2: recipient.addressLine2,
          totalProductAmount: plan.totalProductAmount,
          totalCouponDiscountAmount: plan.totalCouponDiscountAmount,
          totalPointDiscountAmount: plan.totalPointDiscountAmount,
          totalShippingFee: plan.totalShippingFee,
          paidAmount: plan.paidAmount,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })

      for (const group of plan.sellerOrders) {
        await this.writeSellerOrder(tx, order.id, group, now)
      }

      return order.id
    })
  }

  /** 한 판매자 몫과 그 항목들, 그리고 상태 이력의 첫 줄. */
  private async writeSellerOrder(
    tx: Tx,
    orderId: string,
    group: PlannedSellerOrder,
    now: Date,
  ): Promise<void> {
    const sellerOrder = await tx.sellerOrder.create({
      data: {
        orderId,
        sellerId: group.sellerId,
        brandName: group.brandName,
        productAmount: group.productAmount,
        couponDiscountAmount: group.couponDiscountAmount,
        pointDiscountAmount: group.pointDiscountAmount,
        shippingPointAmount: group.shippingPointAmount,
        shippingFee: group.shippingFee,
        paidAmount: group.paidAmount,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })

    await tx.orderItem.createMany({
      data: group.items.map((item) => ({
        sellerOrderId: sellerOrder.id,
        variantId: item.line.variantId,
        // `OrderItemSnapshot` 은 평범한 객체이고 Prisma 의 JSON 입력 타입과 구조가
        // 같다. 단언 없이 그대로 넘어간다.
        productSnapshot: { ...item.line.snapshot },
        unitPrice: item.line.unitPrice,
        quantity: item.line.quantity,
        productAmount: item.productAmount,
        couponDiscountAmount: item.couponDiscountAmount,
        pointDiscountAmount: item.pointDiscountAmount,
        discountAmount: item.discountAmount,
        createdAt: now,
        updatedAt: now,
      })),
    })

    // 첫 줄의 `fromStatus` 는 `null` 이다 — 이전 상태가 없다. 생성도 이력에
    // 남기는 이유는, 남기지 않으면 「이 주문이 언제 생겼나」의 답이 이력에 없고
    // `createdAt` 에만 있게 되기 때문이다. 두 곳에 있는 사실은 갈라진다.
    //
    // 주체는 `BUYER` 다 — 주문서를 만든 것은 산 사람이다 (TASK-0059). `actorId` 를
    // 비워 두는 것은 그 사람이 누구인지가 `Order.userId` 에 이미 있기 때문이고,
    // 같은 사실을 두 벌로 적으면 언젠가 서로 다른 말을 한다.
    await tx.orderStatusHistory.create({
      data: {
        sellerOrderId: sellerOrder.id,
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
        actor: 'BUYER',
        actorId: null,
        createdAt: now,
      },
    })
  }

  /**
   * 결제가 확정됐다 — 주문을 완료로 옮긴다 (TASK-0054 4.2).
   *
   * **결제 서비스가 이것을 직접 하지 않는 이유**가 4.2 다. 결제가 주문과 재고를
   * 알게 되면 토스가 붙는 날 같은 지식이 한 벌 더 생기거나, 결제 서비스가 두
   * 프로바이더의 사정을 다 아는 자리가 된다. 프로바이더가 무엇이든 그 뒤는 같아야
   * 하고, 그것이 D-031 이 말하는 추상화의 값이다.
   *
   * 한 트랜잭션이다. 예약 확정과 상태 전이가 갈리면 **팔린 재고가 없는 주문**이나
   * **주문 없이 줄어든 재고**가 남고, 둘 다 사람이 손으로 찾아야 하는 종류다.
   *
   * 멱등이다. 이미 `PAID` 인 몫은 건드리지 않고 예약도 다시 확정하지 않는다 —
   * 결제 승인 웹훅은 두 번 온다고 가정해야 한다(TASK-0056).
   *
   * **상태는 상태 머신의 문을 지나서만 바뀐다** (TASK-0059). 여기서 `updateMany` 로
   * 한 번에 옮기던 것을 몫마다 {@link SellerOrderService.applyWithin} 으로 바꾼 것이
   * 그 뜻이고, 그 대가로 문장이 몫 하나당 세 개가 된다(잠금·갱신·이력). 대가를 치를
   * 값어치가 있는 이유는, 지나지 않으면 「정의되지 않은 전이는 불가능하다」가 **새
   * 코드에만 적용되는 규칙**이 되기 때문이다 — 그리고 한 주문의 판매자 수는 데모에서
   * 한 자리다.
   *
   * **바꾸지 않은 것 셋.** ① 옮기는 대상은 여전히 `PAYMENT_PENDING` 인 몫뿐이다 —
   * 이미 `PREPARING` 까지 간 몫을 `PAID` 로 되돌리려 들면 문이 거절하고, 그것은
   * 「매입은 끝났는데 주문이 완결되지 않은 건을 마저 끝낸다」(D-221)를 깨뜨린다.
   * ② 트랜잭션 경계는 그대로다 — 문이 남의 트랜잭션 안에서 도는 이유가 이것이다.
   * ③ 빈 목록이면 예약도 건드리지 않고 돌아간다.
   *
   * 알림만 **커밋 뒤로** 나간다. 트랜잭션 안에서 발행하면 롤백된 결제의 「결제
   * 완료」 알림이 나가고, 그 메일은 되돌릴 수 없다.
   */
  async markPaid(orderId: string): Promise<void> {
    const changes = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          checkoutId: true,
          sellerOrders: { where: { status: 'PAYMENT_PENDING' }, select: { id: true } },
        },
      })

      if (order === null) throw new NotFoundException('주문을 찾을 수 없어요.')
      if (order.sellerOrders.length === 0) return []

      // 예약을 실제 차감으로 바꾼다. 여기서 처음으로 재고가 줄어든다 — 그전까지
      // 주문은 재고를 **잡고만** 있었다 (TASK-0049 4.4).
      const holds = await tx.stockReservation.findMany({
        where: { checkoutId: order.checkoutId, status: 'HELD' },
        orderBy: { id: 'asc' },
        select: { id: true },
      })

      for (const hold of holds) {
        await this.reservations.confirm(tx, hold.id)
      }

      const events: SellerOrderStatusChanged[] = []

      // 주체는 `SYSTEM` 이다. 사람이 「결제됨」을 누르는 화면은 없다 — 그것은 결제가
      // 끝났다는 사실의 결과이고, 그 사실을 아는 것은 결제 쪽이다.
      for (const row of order.sellerOrders) {
        const event = await this.transitions.applyWithin(tx, row.id, 'PAID', {
          actor: 'SYSTEM',
          actorId: null,
        })

        if (event !== null) events.push(event)
      }

      return events
    })

    await this.transitions.publish(changes)
  }

  // ------------------------------------------------------------------- reads

  /** 주문 하나. 구매자 자신과 운영자가 읽는다. */
  async get(principal: RequestPrincipal, orderId: string): Promise<OrderResponse> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { ...ORDER_SELECT, user: { select: accountOwnershipSelect } },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    assertResourceAccess(principal, 'order.read', accountOwnership(row.user))

    return { order: present(row) }
  }

  /** 내 주문 목록. 최신순, 커서 페이지네이션. */
  async list(principal: RequestPrincipal, query: OrderListQuery): Promise<OrderListResponse> {
    const account = await this.account(principal, 'order.read')
    const limit = query.limit ?? ORDER_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.order.findMany({
      where: {
        userId: account.id,
        ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
      },
      // id 가 UUIDv7 이라 시간순이다. `createdAt` 으로 정렬하면 같은 밀리초의 두
      // 주문에서 커서가 한 건을 건너뛰거나 두 번 보여 준다.
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: SUMMARY_SELECT,
    })
    const page = rows.slice(0, limit)

    return {
      orders: page.map((row) => summarise(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 판매자가 읽는 자기 몫 하나 (F6).
   *
   * 주문 상세를 걸러서 주지 않는 이유는 합계 때문이다 — 주문 단위 금액에는 남의
   * 몫이 섞여 있고, 다시 계산해서 주면 그 숫자는 아무 데도 저장된 적이 없다.
   */
  async sellerOrder(principal: RequestPrincipal, id: string): Promise<SellerOrderResponse> {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id },
      select: {
        ...SELLER_ORDER_SELECT,
        seller: { select: sellerOwnershipSelect },
        order: {
          select: {
            orderNumber: true,
            createdAt: true,
            recipientName: true,
            recipientPhone: true,
            postalCode: true,
            addressLine1: true,
            addressLine2: true,
          },
        },
      },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    assertResourceAccess(principal, 'order.read', sellerOwnership(row.seller))

    return {
      sellerOrder: presentSellerOrder(row),
      orderNumber: row.order.orderNumber,
      orderedAt: row.order.createdAt.toISOString(),
      recipient: {
        name: row.order.recipientName,
        phone: row.order.recipientPhone,
        postalCode: row.order.postalCode,
        addressLine1: row.order.addressLine1,
        addressLine2: row.order.addressLine2,
      },
    }
  }

  // ---------------------------------------------------------------- internals

  private async account(
    principal: RequestPrincipal,
    permission: 'order.read' | 'order.write',
  ): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, permission, accountOwnership(account))

    return account
  }

  /** 배송지에서 복사한다. 가리키지 않는다 (4.6). */
  private async recipientOf(userId: string, addressId: string): Promise<Recipient> {
    const address = await this.prisma.address.findFirst({
      // `userId` 를 조건에 함께 두는 것이 소유권 검사다. 남의 배송지 id 를 보내면
      // 「없다」로 답한다 — 있는지 없는지를 알려 주지 않는 것이 옳다.
      where: { id: addressId, userId },
      select: {
        recipientName: true,
        phone: true,
        postalCode: true,
        addressLine1: true,
        addressLine2: true,
      },
    })

    if (address === null) {
      throw new BadRequestException(
        domainFailure('ORDER_ADDRESS_MISSING', '배송지를 찾을 수 없어요.', {
          field: 'addressId',
        }),
      )
    }

    return {
      name: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
    }
  }

  /**
   * 주문할 줄을 한 질의로 읽고, 팔 수 있는지까지 본다 (A5 · F9).
   *
   * 요청한 줄 수와 읽힌 줄 수가 다르면 거절한다. **일부만 주문하고 넘어가지
   * 않는다** — 다른 탭에서 지웠거나 이미 주문한 줄일 텐데, 사람이 보고 있는 화면과
   * 다른 것을 사게 되는 쪽이 훨씬 나쁘다.
   */
  private async orderableLines(
    userId: string,
    itemIds: readonly string[],
  ): Promise<readonly CartLineRow[]> {
    const rows = await this.prisma.cartItem.findMany({
      where: { id: { in: [...itemIds] }, cart: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        quantity: true,
        variant: {
          select: {
            id: true,
            sku: true,
            price: true,
            isActive: true,
            deletedAt: true,
            sellerId: true,
            maxPurchaseQuantity: true,
            optionValues: { select: { optionValue: { select: { value: true, optionId: true } } } },
            product: {
              select: {
                id: true,
                name: true,
                status: true,
                deletedAt: true,
                maxPurchaseQuantity: true,
                images: {
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  take: 1,
                  select: { url: true },
                },
                options: { select: { id: true, sortOrder: true } },
                seller: {
                  select: {
                    id: true,
                    brandName: true,
                    shippingFee: true,
                    freeShippingThreshold: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (rows.length !== itemIds.length) {
      throw new BadRequestException(
        domainFailure('ORDER_ITEM_MISSING', '장바구니에서 사라진 상품이 있어요.', {
          field: 'itemIds',
        }),
      )
    }

    for (const row of rows) assertOrderable(row)

    return rows
  }
}

/** 수령인 스냅샷, 저장 직전의 모양. */
interface Recipient {
  readonly name: string
  readonly phone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string | null
}

/** 주문번호가 겹쳤는가. 다른 유니크 위반은 재시도로 고쳐지지 않는다. */
function isOrderNumberCollision(error: unknown): boolean {
  return isUniqueViolationOn(error, 'orderNumber')
}

/**
 * 같은 주문서로 주문이 둘 만들어질 뻔했는가.
 *
 * 재시도가 답하는 경우가 아니다 — 다시 해도 같은 열쇠로 같은 제약에 걸린다.
 * 답은 이미 만들어진 그 주문이다.
 */
function isCheckoutCollision(error: unknown): boolean {
  return isUniqueViolationOn(error, 'checkoutId')
}

const ORDER_ITEM_SELECT = {
  id: true,
  variantId: true,
  productSnapshot: true,
  unitPrice: true,
  quantity: true,
  productAmount: true,
  couponDiscountAmount: true,
  pointDiscountAmount: true,
  discountAmount: true,
} as const

const SELLER_ORDER_SELECT = {
  id: true,
  sellerId: true,
  brandName: true,
  status: true,
  productAmount: true,
  couponDiscountAmount: true,
  pointDiscountAmount: true,
  shippingPointAmount: true,
  shippingFee: true,
  paidAmount: true,
  items: { orderBy: { id: 'asc' }, select: ORDER_ITEM_SELECT },
  // 상세에만 딸려 온다. 목록(`SUMMARY_SELECT`)에는 없다 — 거기서 필요한 것은 상태
  // 배지 하나이고, 묶음마다 추적 이력을 실으면 응답이 몇 배가 된다 (TASK-0061).
  shipment: { select: SHIPMENT_SELECT },
} as const

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  recipientName: true,
  recipientPhone: true,
  postalCode: true,
  addressLine1: true,
  addressLine2: true,
  totalProductAmount: true,
  totalCouponDiscountAmount: true,
  totalPointDiscountAmount: true,
  totalShippingFee: true,
  paidAmount: true,
  sellerOrders: { orderBy: { id: 'asc' }, select: SELLER_ORDER_SELECT },
} as const

const SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  paidAmount: true,
  sellerOrders: {
    orderBy: { id: 'asc' },
    select: { status: true, items: { orderBy: { id: 'asc' }, select: { productSnapshot: true } } },
  },
} as const

/** 저장된 JSONB 를 계약의 모양으로. */
function snapshotFrom(value: unknown): OrderItemSnapshot {
  return value as OrderItemSnapshot
}

interface SellerOrderRow {
  /** 발송 전이면 `null`. 계약의 같은 자리와 같은 뜻이다. */
  readonly shipment: ShipmentRow | null
  readonly id: string
  readonly sellerId: string
  readonly brandName: string
  readonly status: string
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  readonly shippingPointAmount: number
  readonly shippingFee: number
  readonly paidAmount: number
  readonly items: readonly {
    readonly id: string
    readonly variantId: string
    readonly productSnapshot: unknown
    readonly unitPrice: number
    readonly quantity: number
    readonly productAmount: number
    readonly couponDiscountAmount: number
    readonly pointDiscountAmount: number
    readonly discountAmount: number
  }[]
}

function presentSellerOrder(row: SellerOrderRow): SellerOrder {
  return {
    id: row.id,
    sellerId: row.sellerId,
    brandName: row.brandName,
    status: row.status as OrderStatus,
    items: row.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      snapshot: snapshotFrom(item.productSnapshot),
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      productAmount: item.productAmount,
      couponDiscountAmount: item.couponDiscountAmount,
      pointDiscountAmount: item.pointDiscountAmount,
      discountAmount: item.discountAmount,
    })),
    productAmount: row.productAmount,
    couponDiscountAmount: row.couponDiscountAmount,
    pointDiscountAmount: row.pointDiscountAmount,
    shippingPointAmount: row.shippingPointAmount,
    shippingFee: row.shippingFee,
    paidAmount: row.paidAmount,
    // 발송 전이면 `null` 이다. 「못 읽었다」가 아니라 「아직 안 보냈다」이고,
    // 화면은 그 둘을 다르게 그린다.
    shipment: row.shipment === null ? null : presentShipment(row.shipment),
  }
}

function present(row: {
  readonly id: string
  readonly orderNumber: string
  readonly createdAt: Date
  readonly recipientName: string
  readonly recipientPhone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string | null
  readonly totalProductAmount: number
  readonly totalCouponDiscountAmount: number
  readonly totalPointDiscountAmount: number
  readonly totalShippingFee: number
  readonly paidAmount: number
  readonly sellerOrders: readonly SellerOrderRow[]
}): Order {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    recipient: {
      name: row.recipientName,
      phone: row.recipientPhone,
      postalCode: row.postalCode,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
    },
    sellerOrders: row.sellerOrders.map((entry) => presentSellerOrder(entry)),
    totalProductAmount: row.totalProductAmount,
    totalCouponDiscountAmount: row.totalCouponDiscountAmount,
    totalPointDiscountAmount: row.totalPointDiscountAmount,
    totalShippingFee: row.totalShippingFee,
    paidAmount: row.paidAmount,
  }
}

/**
 * 「울 코트 외 2건」.
 *
 * 목록이 항목을 전부 싣지 않는 이유는 A5 다 — 주문 20건의 항목을 모두 실으면 한
 * 화면이 수백 줄을 내려받는다. 대신 첫 항목의 이름과 개수를 서버가 만든다: 그
 * 문장을 화면이 만들면 앱마다 다른 규칙이 생긴다.
 */
function summarise(row: {
  readonly id: string
  readonly orderNumber: string
  readonly createdAt: Date
  readonly paidAmount: number
  readonly sellerOrders: readonly {
    readonly status: string
    readonly items: readonly { readonly productSnapshot: unknown }[]
  }[]
}): {
  id: string
  orderNumber: string
  createdAt: string
  headline: string
  itemCount: number
  statuses: OrderStatus[]
  paidAmount: number
} {
  const items = row.sellerOrders.flatMap((entry) => entry.items)
  const first = items[0]
  const headline = first === undefined ? '' : snapshotFrom(first.productSnapshot).productName

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    headline,
    itemCount: items.length,
    statuses: row.sellerOrders.map((entry) => entry.status as OrderStatus),
    paidAmount: row.paidAmount,
  }
}
