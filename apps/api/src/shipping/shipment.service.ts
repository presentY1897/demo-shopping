import { randomBytes } from 'node:crypto'

import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  DemoCarrierCode,
  SellerOrderDeliveryResponse,
  Shipment,
  ShipmentResponse,
  ShipmentStatus,
  ShipSellerOrderRequest,
  TrackingEventKind,
} from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow, SellerRow } from '../auth/resource-ownership.js'
import {
  accountOwnership,
  accountOwnershipSelect,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { isUniqueViolationOn } from '../common/unique-violation.js'
import type { SellerOrderStatusChanged } from '../orders/seller-order-events.js'
import type { TransitionCommand } from '../orders/seller-order.service.js'
import { SellerOrderService } from '../orders/seller-order.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { TrackingEventSource } from './shipment-rules.js'
import {
  carrierFrom,
  carrierNameOf,
  furthestShipmentStatus,
  pickupHubOf,
  SELLER_REPORTED_LOCATION,
  shipmentStatusAfter,
  TRACKING_NUMBER_DIGITS,
  trackingEventDescriptionOf,
  trackingNumberFrom,
} from './shipment-rules.js'

type Tx = Prisma.TransactionClient

/** 첫 이벤트는 언제나 집화다 — 운송사가 물건을 받은 순간이 발송이다. */
const FIRST_EVENT: TrackingEventKind = 'PICKED_UP'

/**
 * 사건을 알려 온 쪽과, 그 사건이 일으키는 전이의 주체 (TASK-0060 4.3).
 *
 * **한 값인 이유는 둘이 갈리면 안 되기 때문이다.** 「판매자가 확인했다」고 적힌 추적
 * 줄 옆에 「`SYSTEM` 이 옮겼다」는 상태 이력이 남으면 두 표가 같은 순간에 대해 서로
 * 다른 말을 하고, 그 둘 중 어느 쪽이 맞는지는 나중에 아무도 알 수 없다. 인자를
 * 둘로 두면 부르는 쪽이 그 조합을 틀리게 만들 수 있고, 하나로 두면 만들 수 없다.
 */
export interface TrackingEventReporter {
  readonly source: TrackingEventSource
  readonly command: TransitionCommand
}

/**
 * 운송사가 알려 온 사건 — 이 서비스의 정상 경로다 (TASK-0062 의 시뮬레이터).
 *
 * 주체가 `SYSTEM` 인 것이 라우트를 열지 않은 이유였다: 사람이 이 자리를 부르면
 * 「운송사가 알려 준 사실」을 사람이 주장하게 된다.
 */
const CARRIER_REPORTER: TrackingEventReporter = {
  source: 'CARRIER',
  command: { actor: 'SYSTEM', actorId: null },
}

/**
 * 운송사를 고르는 데 쓰는 난수의 길이.
 *
 * 번호의 12바이트와 따로 뽑는다. 같은 바이트열에서 운송사와 번호를 함께 뽑으면
 * 「번호를 보면 운송사를 알 수 있다」가 두 가지 뜻이 되고(가운데 칸 · 숫자 열두 개),
 * 둘 중 하나가 나중에 바뀔 때 무엇이 깨지는지 아무도 모른다.
 */
const CARRIER_PICK_BYTES = 4

const EVENT_SELECT = {
  id: true,
  kind: true,
  location: true,
  description: true,
  occurredAt: true,
} as const

/**
 * 배송 한 건과 그 이력 전부.
 *
 * **정렬이 여기 있는 것이 핵심이다.** 시각만으로 정렬하면 같은 밀리초에 들어온 둘의
 * 순서가 정해지지 않는다 — 시뮬레이터(TASK-0062)가 한 트랜잭션에서 두 줄을 적으면
 * 실제로 같은 밀리초이고, 그때 화면이 새로고침마다 다른 순서를 보여 주면 읽는 사람이
 * 기록을 믿지 못한다. `id` 가 UUIDv7 이라 그 자체로 시간순이고 동률의 타이브레이커가
 * 된다 (`PaymentService` 의 `refunds` 가 같은 이유로 같은 모양이다).
 */
export const SHIPMENT_SELECT = {
  id: true,
  sellerOrderId: true,
  carrierCode: true,
  carrierName: true,
  trackingNumber: true,
  status: true,
  shippedAt: true,
  deliveredAt: true,
  events: {
    select: EVENT_SELECT,
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  },
  // `as const` 가 아니라 `satisfies` 인 것은 정렬 때문이다 — 읽기 전용 튜플은
  // Prisma 의 `orderBy` 에 들어가지 못하고, 그냥 두면 `'asc'` 가 `string` 으로
  // 넓어져 역시 거절된다.
} satisfies Prisma.ShipmentSelect

/** 「누구 것인가」를 답하는 데 필요한 열들. 구매자와 판매자 **둘 다** 읽는다. */
const ACCESS_SELECT = {
  id: true,
  sellerId: true,
  seller: { select: sellerOwnershipSelect },
  order: { select: { user: { select: accountOwnershipSelect } } },
} as const

/** 잠근 배송 행에서 읽는 것. 판단에 필요한 만큼이다. */
interface LockedShipment {
  readonly id: string
  readonly sellerOrderId: string
  readonly carrierCode: string
  readonly status: string
  readonly deliveredAt: Date | null
}

/**
 * 추적 사건 하나 (F6).
 *
 * `shipmentId` 로 받는 이유는 부르는 쪽이 시뮬레이터(TASK-0062)이기 때문이다 —
 * 그쪽이 손에 들고 있는 것은 「지금 움직여야 할 배송들」이지 주문이 아니다.
 *
 * `description` 이 없는 것은 뜻이 있다. 문장은 종류가 정하고 서버가 쓴다
 * (`trackingEventDescriptionOf`) — 부르는 쪽이 문장을 주면 같은 사건이 자리마다 다른
 * 말로 남고, 그때 이력은 「무슨 일이 있었나」가 아니라 「누가 무엇을 적었나」가 된다.
 */
export interface TrackingEventInput {
  readonly shipmentId: string
  readonly kind: TrackingEventKind
  /** 가상 지명. 생략하면 알려 온 쪽에 따라 정해진다. */
  readonly location?: string
  /** 사건이 일어난 시각. 생략하면 지금이다. */
  readonly occurredAt?: Date
  /** 누가 알려 왔는가. 생략하면 운송사다. */
  readonly reporter?: TrackingEventReporter
}

/** 소유권 판정이 보는 모양. 두 갈래가 각각 다른 사람을 통과시킨다. */
interface OwnedSellerOrder {
  readonly sellerId: string
  readonly seller: SellerRow
  readonly order: { readonly user: AccountRow }
}

/**
 * 가상 배송 (TASK-0061).
 *
 * **운송사에 연동하지 않는다.** 도메인과 상태 전이는 실제와 같게 두고 운송장·추적만
 * 지어낸다 (CLAUDE.md 5장). 그래서 이 서비스가 실제로 지키는 것은 둘이다.
 *
 * ① **발송과 발급은 한 트랜잭션이다.** 갈라지면 「발송했다는데 운송장이 없다」가
 *    가능해지고, 그것은 구매자에게 「배송중」이라고 말해 놓고 어디 있는지 답하지
 *    못하는 상태다. 반대 방향 — 운송장은 났는데 전이가 거절된 경우 — 도 같은
 *    트랜잭션이라 없던 일이 된다. 발송 조건을 못 갖춘 주문에 운송장만 남으면 그
 *    번호는 아무 배송도 가리키지 않는다.
 *
 * ② **전이는 `SellerOrderService.applyWithin` 을 지난다** (TASK-0059). 상태를 여기서
 *    직접 쓰면 「정의되지 않은 전이는 불가능하다」가 **그 문을 지나는 코드에만**
 *    적용되는 규칙이 되고, 그때 이 파일의 검사는 전부 초록이다. 그 문이 요구하는
 *    운송장의 사실(`SellerOrder.trackingNumber`)을 **먼저 적고** 문을 여는 순서인
 *    것도 그래서다 — 문을 고치지 않고 조건을 갖추는 것이 부르는 쪽의 일이다.
 *
 * 발송이 `POST /seller-orders/:id/transitions` 로 되지 않는 이유가 ②에 있다. 그
 * 라우트는 조건을 **갖춘 뒤에** 지나는 문이고, 운송장이 없는 주문에는 언제나
 * `ORDER_TRANSITION_REQUIREMENT` 로 답한다. 조건을 만드는 일이 이 라우트다.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sellerOrders: SellerOrderService,
  ) {}

  /**
   * 발송 처리 — 운송장을 발급하고 `PREPARING → SHIPPED` 를 지난다 (F1).
   *
   * **멱등이다.** 이미 발급된 몫은 그 배송을 그대로 돌려준다. 두 번째 요청을 오류로
   * 답하면 두 번 누른 판매자가 「실패했다」를 보는데, 그 사람이 원한 결과는 이미
   * 이뤄져 있다 — `SellerOrderService.transition` 이 같은 이유로 같은 성질을 갖는다.
   *
   * 알림은 **커밋한 뒤에** 나간다. 트랜잭션 안에서 발행하면 롤백된 발송의 알림이
   * 나가고, 그 메일은 되돌릴 수 없다.
   */
  async ship(
    principal: RequestPrincipal,
    sellerOrderId: string,
    input: ShipSellerOrderRequest,
  ): Promise<ShipmentResponse> {
    const row = await this.access(sellerOrderId)

    // **파는 쪽에게만 연다.** 전이표의 `PREPARING → SHIPPED` 주체가 판매자뿐이라
    // (`state-machines.md` 1장) 다른 사람은 아래 문에서 거절되지만, 여기서 먼저
    // 스토어 소유권을 요구하는 것은 남의 주문을 발송하려는 요청에 「운송장이
    // 없다」가 아니라 「당신 것이 아니다」로 답하기 위해서다.
    assertResourceAccess(principal, 'order.write', sellerOwnership(row.seller))

    const command: TransitionCommand = {
      actor: principal.sellerId === row.sellerId ? 'SELLER' : 'ADMIN',
      actorId: principal.userId,
    }
    const issued = await this.issueRetrying(sellerOrderId, input, command)

    await this.sellerOrders.publish(issued.change === null ? [] : [issued.change])

    return { shipment: issued.shipment }
  }

  /**
   * 배송 조회 (F4 · F5). **구매자와 판매자가 같은 답을 받는다.**
   *
   * 둘의 차이는 답의 모양이 아니라 **누구의 배송을 읽을 수 있는가**다. 판매자는 자기
   * 스토어의 것을, 구매자는 자기가 산 것을 읽고, 어느 쪽도 아닌 사람은 403 이다.
   * 화면마다 다른 모양을 주면 「판매자 화면에는 있는데 구매자 화면에는 없는 값」이
   * 생기고, 그것을 메우는 두 번째 조회가 반드시 따라온다.
   *
   * 한 번에 읽는다(A5). 소유권과 배송과 이력이 각각 왕복하면 목록 화면에서 그대로
   * N+1 이 된다.
   */
  async get(principal: RequestPrincipal, sellerOrderId: string): Promise<ShipmentResponse> {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { ...ACCESS_SELECT, shipment: { select: SHIPMENT_SELECT } },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    this.assertReadable(principal, row)

    // 소유권을 **먼저** 본다. 없는 것을 먼저 답하면 남의 주문에 배송이 붙었는지를
    // 아무나 알 수 있고, 그것은 403 이 막으려던 것의 절반이다.
    if (row.shipment === null) throw new NotFoundException('배송 정보를 찾을 수 없어요.')

    return { shipment: presentShipment(row.shipment) }
  }

  /**
   * 추적 사건 한 줄을 적는다 — 그리고 **그 사건이 뜻하는 것을 함께 적는다** (F6).
   *
   * 한 트랜잭션에서 셋이 일어난다: 이력 한 줄 · 배송 상태 갱신 · 배송완료면 주문
   * 전이. 갈라지면 「배송완료라고 적혀 있는데 주문은 배송중」이 되고, 그것은 발송
   * 때 막은 것과 같은 종류의 어긋남이다. 전이가 거절되면(취소된 주문 등) 이벤트도
   * 남지 않는다.
   *
   * **기본 주체는 `SYSTEM` 이다.** 운송사가 알려 준 사실이지 사람이 누른 것이 아니다.
   * 판매자가 직접 배송완료를 찍는 길은 {@link markDelivered} 이고, 그쪽은 추적 줄에도
   * 이력에도 판매자를 남긴다({@link TrackingEventReporter}) — 두 사실을 같은 주체로
   * 적으면 이력이 거짓이 된다.
   *
   * **순서가 뒤집힌 사건은 기록하되 상태를 되돌리지 않는다.** 사건은 일어난
   * 사실이므로 지우지 않고(TASK-0056 의 판단 — 멱등은 「기록을 막는 것」이 아니라
   * 「상태를 한 번만 옮기는 것」이다), 요약만 {@link furthestShipmentStatus} 로
   * 사다리를 지킨다. 같은 사건이 두 번 와도 같다 — 줄은 둘이 되고 상태는 한 번만
   * 움직이며, 주문 전이는 이미 멱등이라 이력이 늘지 않는다.
   *
   * **이 자리는 여전히 HTTP 로 열려 있지 않다.** 부르는 것은 우리 코드뿐이고
   * (TASK-0062 의 시뮬레이터가 이어받는다), 임의의 사건을 받는 라우트를 열면 사람이
   * 「운송사가 알려 준 사실」을 주장하게 된다 — 그 순간 이력의 `SYSTEM` 은 거짓이
   * 된다. 판매자에게 연 것은 **사건 하나짜리 문**({@link markDelivered})이고, 그
   * 문은 주체를 요청이 아니라 서버가 정한다.
   */
  async recordTrackingEvent(input: TrackingEventInput): Promise<ShipmentResponse> {
    const recorded = await this.prisma.$transaction((tx) => this.record(tx, input))

    await this.sellerOrders.publish(recorded.change === null ? [] : [recorded.change])

    return { shipment: recorded.shipment }
  }

  /**
   * 판매자의 「배송완료 처리」 (TASK-0060 4.3 · TASK-0061 4.4 가 넘긴 항목).
   *
   * ## 왜 전이 라우트가 아닌가
   *
   * 전이표는 `SHIPPED → DELIVERED` 를 판매자에게도 허용한다 — 시뮬레이터가 멈춘
   * 데모에서 흐름을 이어 갈 수 있어야 하기 때문이다(`state-machines.md` 1장). 그런데
   * `POST /seller-orders/:id/transitions` 로 그 길을 가면 **주문만 움직이고
   * `Shipment.status` 는 그대로 남는다**: 구매자의 추적 화면이 「이동 중」인 채로
   * 주문은 배송완료다. 두 표가 갈린 채 남는 그 결말이 TASK-0061 이 넘긴 문제다.
   *
   * 반대 방향으로 닫을 수는 없었다. 전이의 문(`applyWithin`) 안에 배송을 아는 코드를
   * 넣으면 **주문이 배송을 알게 되고**, `SellerOrderModule` 이 `PrismaModule` 하나만
   * 아는 성질 — 예약 스케줄러와 결제 확정이 순환 없이 그 문을 지나는 이유 — 이
   * 사라진다. 그래서 문은 그대로 두고, **조건을 갖춘 뒤에 문을 지나는 쪽**을 여기에
   * 하나 더 만들었다. 발송(`ship`)이 이미 정확히 그 모양이다.
   *
   * ## 이 라우트가 지키는 것
   *
   * ① 배송 사건 · 배송 상태 · 주문 전이가 **한 트랜잭션**이다. 전이가 거절되면
   *    (아직 발송 전, 이미 취소됨) 추적 줄도 남지 않는다.
   * ② **주체는 `SELLER` 다.** 사람이 누른 것이 사실이므로 이력에 그렇게 남고, 추적
   *    줄의 문장과 지점도 「판매자가 확인했다」로 남는다 — `SYSTEM` 으로 적으면
   *    TASK-0061 이 라우트를 열지 않은 이유가 그대로 되살아난다.
   * ③ **멱등이다.** 이미 배송완료인 배송에는 아무것도 적지 않고 그대로 돌려준다.
   *    {@link recordTrackingEvent} 가 중복 사건을 **줄로 남기는** 것과 반대인데,
   *    이유는 두 곳이 세는 것이 다르기 때문이다 — 저쪽에서 두 번은 「운송사가 두 번
   *    알려 왔다」는 조사할 가치가 있는 사실이고, 여기서 두 번은 **버튼을 두 번
   *    누른 것**이다. 그것을 이력에 남기면 타임라인에 같은 줄이 둘 생긴다.
   */
  async markDelivered(
    principal: RequestPrincipal,
    sellerOrderId: string,
  ): Promise<SellerOrderDeliveryResponse> {
    const row = await this.access(sellerOrderId)

    // 발송과 같은 문이다. 남의 주문에는 「지금 상태에서는 할 수 없다」가 아니라
    // 「당신 것이 아니다」로 답한다.
    assertResourceAccess(principal, 'order.write', sellerOwnership(row.seller))

    const reporter: TrackingEventReporter = {
      source: 'SELLER',
      command: {
        actor: principal.sellerId === row.sellerId ? 'SELLER' : 'ADMIN',
        actorId: principal.userId,
      },
    }
    const delivered = await this.prisma.$transaction((tx) =>
      this.deliver(tx, sellerOrderId, reporter),
    )

    await this.sellerOrders.publish(delivered.change === null ? [] : [delivered.change])

    // 커밋 뒤에 버튼을 다시 묻는다. 답의 상태와 버튼은 **지금** 사실이어야 하고,
    // 그것을 아는 것은 전이의 문이다 — 여기서 버튼 목록을 손으로 만들면 규칙이
    // 두 곳에 살게 된다.
    const fresh = await this.sellerOrders.actions(principal, sellerOrderId)

    return {
      transition: {
        id: sellerOrderId,
        status: fresh.status,
        changed: delivered.change !== null,
        actions: fresh.actions,
      },
      shipment: delivered.shipment,
    }
  }

  // ---------------------------------------------------------------- internals

  /** {@link recordTrackingEvent} 의 트랜잭션 본체. */
  private async record(tx: Tx, input: TrackingEventInput): Promise<Issued> {
    // 배송 행을 먼저 잠근다. 두 사건이 겹치면 각자 「지금 상태」를 읽고 둘 다 쓰는데,
    // 그때 나중에 커밋한 쪽이 사다리를 모르고 상태를 되돌릴 수 있다.
    const locked = await this.lockShipment(tx, input.shipmentId)
    const reporter = input.reporter ?? CARRIER_REPORTER
    const occurredAt = input.occurredAt ?? this.clock.now()
    const carrierCode = locked.carrierCode as DemoCarrierCode
    const status = furthestShipmentStatus(
      locked.status as ShipmentStatus,
      shipmentStatusAfter(input.kind),
    )

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: locked.id,
        kind: input.kind,
        location: input.location ?? locationOf(reporter.source, carrierCode),
        description: trackingEventDescriptionOf(input.kind, reporter.source),
        occurredAt,
      },
    })
    await tx.shipment.update({
      where: { id: locked.id },
      data: {
        status,
        // **처음 도착한 시각이 배송완료 시각이다.** 두 번째 `DELIVERED` 가 이미 적힌
        // 시각을 덮으면 「언제 받았나」의 답이 사건이 올 때마다 바뀐다. 완료가 아닌
        // 상태에서 시각만 남는 것은 `Shipment_delivered_check` 가 거절한다.
        deliveredAt: locked.deliveredAt ?? (status === 'DELIVERED' ? occurredAt : null),
      },
    })

    const change =
      input.kind === 'DELIVERED'
        ? await this.sellerOrders.applyWithin(
            tx,
            locked.sellerOrderId,
            'DELIVERED',
            reporter.command,
          )
        : null
    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: locked.id },
      select: SHIPMENT_SELECT,
    })

    return { shipment: presentShipment(shipment), change }
  }

  /**
   * 배송 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * 한 문장이고 읽는 것도 그 행의 컬럼뿐이다 — 다른 표를 함께 읽으면 잠금을 기다린
   * 뒤에도 문장이 시작할 때의 스냅샷을 들고 와, 기다린 보람 없이 **낡은 상태로**
   * 판단하게 된다 (`SellerOrderService.lock` 이 같은 이유로 같은 모양이다).
   */
  private async lockShipment(tx: Tx, shipmentId: string): Promise<LockedShipment> {
    const rows = await tx.$queryRaw<readonly LockedShipment[]>`
      SELECT "id", "sellerOrderId", "carrierCode", "status"::text AS "status", "deliveredAt"
        FROM "Shipment"
       WHERE "id" = ${shipmentId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('배송 정보를 찾을 수 없어요.')

    return row
  }

  /**
   * {@link markDelivered} 의 트랜잭션 본체.
   *
   * 배송 행부터 찾는 이유는 그것이 「발송된 적이 있는가」의 답이기 때문이다. 없으면
   * 이 몫은 아직 `SHIPPED` 일 수 없고(운송장 사본이 복합 외래키로 배송을 가리킨다),
   * 전이의 문에 물어봤자 「정의되지 않은 전이」로 끝난다 — 그것보다 「아직 발송되지
   * 않았다」가 판매자에게 할 수 있는 말이다.
   */
  private async deliver(
    tx: Tx,
    sellerOrderId: string,
    reporter: TrackingEventReporter,
  ): Promise<Issued> {
    const existing = await tx.shipment.findUnique({
      where: { sellerOrderId },
      select: { id: true },
    })

    if (existing === null) throw new NotFoundException('배송 정보를 찾을 수 없어요.')

    const locked = await this.lockShipment(tx, existing.id)

    // ③ 이미 도착해 있으면 아무것도 적지 않는다. 잠근 뒤에 보는 것이 요점이다 —
    // 잠금 밖에서 읽으면 두 번 눌린 버튼이 둘 다 「아직 아니다」를 읽는다.
    if (locked.status === 'DELIVERED') {
      const shipment = await tx.shipment.findUniqueOrThrow({
        where: { id: locked.id },
        select: SHIPMENT_SELECT,
      })

      return { shipment: presentShipment(shipment), change: null }
    }

    return await this.record(tx, { shipmentId: locked.id, kind: 'DELIVERED', reporter })
  }

  /**
   * 번호가 겹치면 **전부 다시 한다** (F3).
   *
   * 다시 하는 단위가 트랜잭션 전체인 것이 중요하다. PostgreSQL 은 트랜잭션 안의 한
   * 문장이 실패하면 그 트랜잭션을 통째로 중단시키므로, 유니크 위반을 안에서 잡아
   * 다른 번호로 다시 쓰는 것은 불가능하다 (`OrderService.place` 가 주문번호에 대해
   * 같은 모양이다).
   *
   * **한 번만 다시 한다.** 10^12 의 공간에서 같은 번호가 연달아 두 번 겹칠 확률은
   * 이미 없는 일이고, 무한히 다시 하는 고리는 **다른 이유로 실패할 때** 영원히 돈다.
   */
  private async issueRetrying(
    sellerOrderId: string,
    input: ShipSellerOrderRequest,
    command: TransitionCommand,
  ): Promise<Issued> {
    try {
      return await this.prisma.$transaction((tx) => this.issue(tx, sellerOrderId, input, command))
    } catch (error) {
      if (!isTrackingNumberCollision(error)) throw error

      return await this.prisma.$transaction((tx) => this.issue(tx, sellerOrderId, input, command))
    }
  }

  /**
   * 한 트랜잭션 안에서 일어나는 발송의 전부.
   *
   * 순서가 규칙이다.
   *
   * ① **행 잠금이 먼저다.** 두 번 눌린 발송이 각자 「아직 배송이 없다」를 읽으면 둘
   *    다 발급하려 들고, 지는 쪽은 `Shipment_sellerOrderId_key` 에 걸려 500 으로
   *    끝난다 — 사용자가 볼 이유가 없는 오류다. 잠근 뒤에 읽으면 뒤에 온 요청은
   *    앞사람이 커밋한 배송을 보고 그것을 돌려준다.
   * ② 배송을 만들고 ③ **그 번호를 몫에 적는다.** 순서가 반대면 복합 외래키
   *    (`SellerOrder_trackingNumber_shipment_fkey`)가 거절한다 — 자기 배송의 번호가
   *    아닌 값은 그 칸에 들어갈 수 없기 때문이고, 그것이 사본이 원본과 갈라지지
   *    않는다는 보증의 값이다.
   * ④ **문을 지난다.** 여기서 거절되면(발송할 수 없는 상태·주체) ②③ 이 함께
   *    되돌아간다.
   * ⑤ 첫 추적 이벤트. 전이·운송장·이벤트가 **함께** 만들어지거나 **함께** 없다.
   */
  private async issue(
    tx: Tx,
    sellerOrderId: string,
    input: ShipSellerOrderRequest,
    command: TransitionCommand,
  ): Promise<Issued> {
    await this.lock(tx, sellerOrderId)

    const already = await tx.shipment.findUnique({
      where: { sellerOrderId },
      select: SHIPMENT_SELECT,
    })

    if (already !== null) return { shipment: presentShipment(already), change: null }

    const now = this.clock.now()
    const carrierCode: DemoCarrierCode =
      input.carrierCode ?? carrierFrom(randomBytes(CARRIER_PICK_BYTES))
    const trackingNumber = trackingNumberFrom(carrierCode, randomBytes(TRACKING_NUMBER_DIGITS))
    const created = await tx.shipment.create({
      data: {
        sellerOrderId,
        carrierCode,
        // 이름은 **복사한다**. 운송사 표가 바뀌어도 과거 배송은 그때의 이름이다.
        carrierName: carrierNameOf(carrierCode),
        trackingNumber,
        status: shipmentStatusAfter(FIRST_EVENT),
        shippedAt: now,
      },
      select: { id: true },
    })

    // 전이가 읽는 사실. 번호의 출처는 위의 행이고 이것은 그 사본이다.
    await tx.sellerOrder.update({ where: { id: sellerOrderId }, data: { trackingNumber } })

    const change = await this.sellerOrders.applyWithin(tx, sellerOrderId, 'SHIPPED', command)

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: created.id,
        kind: FIRST_EVENT,
        location: pickupHubOf(carrierCode),
        description: trackingEventDescriptionOf(FIRST_EVENT),
        occurredAt: now,
      },
    })

    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: created.id },
      select: SHIPMENT_SELECT,
    })

    return { shipment: presentShipment(shipment), change }
  }

  /**
   * 몫의 행을 잠근다.
   *
   * 한 문장이고 읽는 것도 그 행의 열 하나다. 발송이 두 번 눌렸을 때 **뒤에 온 쪽이
   * 앞사람의 커밋을 보게** 하는 것이 전부이고, 그 뒤의 읽기는 새 문장이라 갱신된
   * 스냅샷을 든다.
   */
  private async lock(tx: Tx, sellerOrderId: string): Promise<void> {
    const rows = await tx.$queryRaw<readonly { readonly id: string }[]>`
      SELECT "id" FROM "SellerOrder" WHERE "id" = ${sellerOrderId}::uuid FOR UPDATE
    `

    if (rows.length === 0) throw new NotFoundException('주문을 찾을 수 없어요.')
  }

  /** 소유권 판단에 필요한 만큼 읽는다. 잠그기 전의 읽기다. */
  private async access(sellerOrderId: string) {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: ACCESS_SELECT,
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    return row
  }

  /**
   * 이 배송을 읽어도 되는가 (F5).
   *
   * 순서가 곧 규칙이다. 판 사람을 먼저 보는 것은 자기 가게에서 자기가 산 경우 때문이고
   * (`SellerOrderService.actorFor` 와 같은 순서), 마지막 갈래는 「나머지 전부」가
   * 아니다 — 거기서 요구하는 것은 **전부에 닿는 권한**이라 아무것도 아닌 사람은
   * 403 으로 끝난다.
   */
  private assertReadable(principal: RequestPrincipal, row: OwnedSellerOrder): void {
    if (principal.sellerId !== null && principal.sellerId === row.sellerId) {
      assertResourceAccess(principal, 'order.read', sellerOwnership(row.seller))

      return
    }

    if (principal.userId === row.order.user.id) {
      assertResourceAccess(principal, 'order.read', accountOwnership(row.order.user))

      return
    }

    assertResourceAccess(principal, 'order.read', sellerOwnership(row.seller))
  }
}

/** 한 번의 발송이 남긴 것 — 돌려줄 배송과, 커밋 뒤에 알릴 거리. */
interface Issued {
  readonly shipment: Shipment
  /** 이미 발급돼 있었으면 `null` 이다. 두 번째 요청은 아무 상태도 옮기지 않는다. */
  readonly change: SellerOrderStatusChanged | null
}

/**
 * 추적 줄의 「어디서」.
 *
 * 판매자가 직접 찍은 줄에 집화 터미널 이름을 넣으면 **운송사가 보고한 것처럼
 * 보이고**, 그것이 `TrackingEventSource` 를 만든 이유와 정확히 반대다.
 */
function locationOf(source: TrackingEventSource, carrierCode: DemoCarrierCode): string {
  return source === 'SELLER' ? SELLER_REPORTED_LOCATION : pickupHubOf(carrierCode)
}

/** 운송장 번호가 겹쳤는가. 다른 유니크 위반은 재시도로 고쳐지지 않는다. */
function isTrackingNumberCollision(error: unknown): boolean {
  return isUniqueViolationOn(error, 'trackingNumber')
}

export interface ShipmentRow {
  readonly id: string
  readonly sellerOrderId: string
  readonly carrierCode: string
  readonly carrierName: string
  readonly trackingNumber: string
  readonly status: string
  readonly shippedAt: Date
  readonly deliveredAt: Date | null
  readonly events: readonly {
    readonly id: string
    readonly kind: string
    readonly location: string
    readonly description: string
    readonly occurredAt: Date
  }[]
}

/**
 * 행을 계약의 모양으로.
 *
 * 열거형을 `as` 로 좁히는 것은 Prisma 가 만든 타입과 `@shopping/shared` 의 문자열
 * 유니온이 **같은 값을 다른 타입으로** 부르기 때문이다 (`PaymentService.present` 가
 * 같은 자리에서 같은 일을 한다). 값이 갈라지면 마이그레이션이 막고, 계약이 갈라지면
 * 통합 검사의 zod 파싱이 막는다.
 */
export function presentShipment(row: ShipmentRow): Shipment {
  return {
    id: row.id,
    sellerOrderId: row.sellerOrderId,
    carrierCode: row.carrierCode as DemoCarrierCode,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    status: row.status as ShipmentStatus,
    shippedAt: row.shippedAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    events: row.events.map((event) => ({
      id: event.id,
      kind: event.kind as TrackingEventKind,
      location: event.location,
      occurredAt: event.occurredAt.toISOString(),
      description: event.description,
    })),
  }
}
