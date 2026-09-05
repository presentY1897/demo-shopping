import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  Payment,
  PaymentEventKind,
  PaymentProviderName,
  PaymentResponse,
  PaymentStatus,
} from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { OrderService } from '../orders/order.service.js'
import { PaymentProviderRegistry } from './payment-registry.js'
import type { RefundRefusal } from './payment-rules.js'
import { canTransition, refundDecision } from './payment-rules.js'

type Tx = Prisma.TransactionClient

/** 잠금 아래에서 읽은 결제 한 줄. */
interface PaymentRow {
  readonly id: string
  readonly status: PaymentStatus
  readonly authorizedAmount: number
  readonly canceledAmount: number
  readonly paymentKey: string | null
}

/**
 * 결제 (TASK-0052).
 *
 * **프로바이더가 둘이어야 추상화가 장식이 아닌 실제 설계가 된다** (D-031). 이
 * 서비스는 어느 쪽인지 모른다 — 레지스트리에서 꺼내 쓰고, 결과를 상태와 이벤트로
 * 남기는 일만 한다.
 *
 * **상태를 바꾸는 모든 자리가 잠금 안에 있다.** 결제는 돈이라 「읽고 판단하고
 * 쓰는」 사이에 남이 끼어들면 그 차액이 실제 손해다 — 특히 부분 환불이 그렇다
 * (F6). 재고에서 이미 같은 판단을 했고(TASK-0048), 여기서는 판단이 틀렸을 때
 * 되돌릴 방법이 더 적다.
 *
 * **모든 상태 변화가 이벤트로 남는다** (F5). 상태를 바꾸지 않은 사건도 남는다 —
 * 분쟁과 불일치 조사에서 유일한 근거가 그 로그다.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly registry: PaymentProviderRegistry,
    private readonly orders: OrderService,
  ) {}

  /**
   * 주문에 결제를 만든다. `READY` 로 시작한다.
   *
   * 승인액은 **주문이 정한다.** 부르는 쪽이 금액을 보내지 않는 이유는, 보내게 두면
   * 그 숫자가 주문과 다를 수 있고 그때 어느 쪽이 맞는지를 정해야 하기 때문이다.
   */
  async start(
    principal: RequestPrincipal,
    orderId: string,
    provider: PaymentProviderName,
    /** 어느 수단으로 — 가상 카드에서는 카드 id 다 (TASK-0054). */
    options: { readonly methodRef?: string } = {},
  ): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: account.id },
      select: { id: true, paidAmount: true },
    })

    if (order === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    // 등록되지 않은 결제수단은 **여기서** 막는다. 결제 행을 만들고 나서 승인
    // 단계에서 터지면 아무도 쓰지 않는 `READY` 행이 남는다.
    this.registry.resolve(provider)

    const now = this.clock.now()
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          orderId: order.id,
          provider,
          methodRef: options.methodRef ?? null,
          authorizedAmount: order.paidAmount,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })

      await this.log(tx, created.id, 'REQUESTED', null, null, now)

      return created
    })

    return this.get(principal, payment.id)
  }

  /**
   * 승인. 프로바이더를 부르고 결과를 상태와 이벤트로 남긴다.
   *
   * **프로바이더 호출은 트랜잭션 밖이다.** 남의 서버를 기다리는 동안 우리 행을
   * 잠그고 있으면, 저쪽이 느린 날 결제 표 전체가 밀린다 — 그리고 그 대기는 초 단위다.
   */
  async authorize(principal: RequestPrincipal, paymentId: string): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')
    const held = await this.own(account.id, paymentId)

    this.assertTransition(held.status, 'AUTHORIZED')

    const provider = await this.providerOf(paymentId)
    const context = await this.contextOf(paymentId)
    const result = await provider.authorize({
      paymentId: held.id,
      orderId: context.orderId,
      amount: held.authorizedAmount,
      ...(context.methodRef === null ? {} : { cardId: context.methodRef }),
    })
    const now = this.clock.now()

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)

      // 그 사이에 남이 옮겼을 수 있다. 결제사 응답을 들고 있어도 상태가 이미
      // 움직였다면 그것을 덮어쓰면 안 된다.
      this.assertTransition(fresh.status, result.approved ? 'AUTHORIZED' : 'FAILED')

      if (!result.approved) {
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'FAILED', updatedAt: now },
        })
        await this.log(tx, paymentId, 'FAILED', fresh.status, 'FAILED', now, {
          reason: result.reason,
        })

        return
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'AUTHORIZED',
          paymentKey: result.paymentKey,
          approvedAt: now,
          updatedAt: now,
        },
      })
      await this.log(tx, paymentId, 'AUTHORIZED', fresh.status, 'AUTHORIZED', now)
    })

    return this.get(principal, paymentId)
  }

  /** 매입 확정. `AUTHORIZED` → `PAID`. */
  async capture(principal: RequestPrincipal, paymentId: string): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')
    const held = await this.own(account.id, paymentId)

    this.assertTransition(held.status, 'PAID')

    const provider = await this.providerOf(paymentId)

    await provider.capture(this.keyOf(held), held.authorizedAmount)

    const now = this.clock.now()

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)

      this.assertTransition(fresh.status, 'PAID')

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID', updatedAt: now },
      })
      await this.log(tx, paymentId, 'CAPTURED', fresh.status, 'PAID', now)
    })

    // 결제가 확정됐으니 주문이 완료된다 (TASK-0054 4.2) — 예약이 실제 차감으로
    // 바뀌고 판매자 몫이 `PAID` 로 간다. **결제가 그 일을 직접 하지 않는다**:
    // 프로바이더가 무엇이든 그 뒤는 같아야 하고, 그 「뒤」를 아는 것은 주문 쪽이다.
    await this.orders.markPaid((await this.contextOf(paymentId)).orderId)

    return this.get(principal, paymentId)
  }

  /**
   * 부분 환불 (F3 · F4 · F6).
   *
   * **판단과 쓰기가 같은 잠금 안에 있다.** 동시에 들어온 두 환불이 각자 「아직
   * 여유가 있다」를 읽으면 합계가 승인액을 넘고, 그 차액은 실제로 나간 돈이다.
   * 잠금이 그것을 직렬화하고, `Payment_canceledAmount_check` 가 마지막 줄로 남는다.
   *
   * 프로바이더 호출은 잠금 **안**이다. 승인과 다른 이유는 순서다 — 우리 장부에
   * 먼저 적고 저쪽에 말하면, 저쪽이 거절했을 때 적은 것을 지워야 한다. 반대로
   * 저쪽에 먼저 말하고 우리가 못 적으면 **돈은 나갔는데 기록이 없다.** 둘 중
   * 나은 쪽은 잠금을 조금 더 오래 쥐는 것이다.
   */
  async refund(
    principal: RequestPrincipal,
    paymentId: string,
    amount: number,
    reason: string,
  ): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')

    await this.own(account.id, paymentId)

    const now = this.clock.now()
    const provider = await this.providerOf(paymentId)

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)
      const decision = refundDecision(fresh, amount)

      if (decision.outcome === 'refused')
        throw refusalOf(decision.reason, decision.refundableAmount)

      await provider.refund(this.keyOf(fresh), amount, reason)

      await tx.refund.create({ data: { paymentId, amount, reason, refundedAt: now } })
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: decision.nextStatus,
          canceledAmount: decision.canceledAmount,
          updatedAt: now,
        },
      })
      await this.log(tx, paymentId, 'REFUNDED', fresh.status, decision.nextStatus, now, {
        amount,
        reason,
      })
    })

    return this.get(principal, paymentId)
  }

  /** 결제 하나. 산 사람과 운영자가 읽는다. */
  async get(principal: RequestPrincipal, paymentId: string): Promise<PaymentResponse> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        status: true,
        authorizedAmount: true,
        canceledAmount: true,
        paymentKey: true,
        approvedAt: true,
        refunds: {
          // 시각만으로 정렬하면 **같은 밀리초에 들어온 둘의 순서가 정해지지
          // 않는다.** 부분 환불은 실제로 연달아 일어나고, 그때 화면이 새로고침마다
          // 다른 순서를 보여 주면 읽는 사람이 기록을 믿지 못한다. id 가 UUIDv7 이라
          // 그 자체로 시간순이고, 동률의 타이브레이커가 된다.
          orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
          select: { id: true, amount: true, reason: true, refundedAt: true },
        },
        order: { select: { user: { select: accountOwnershipSelect } } },
      },
    })

    if (row === null) throw new NotFoundException('결제를 찾을 수 없어요.')

    assertResourceAccess(principal, 'order.read', accountOwnership(row.order.user))

    return { payment: present(row) }
  }

  // ---------------------------------------------------------------- internals

  private async account(
    principal: RequestPrincipal,
    permission: 'order.read' | 'order.write',
    // 반환형이 `AccountRow` 인 것이 중요하다. 컬럼 이름을 여기서 적으면
    // `demo-containment.spec.ts` 가 잡는다 — 데모 판정은 인가 계층의 것이고,
    // 밖으로 새면 그 판정이 여러 곳에서 조금씩 다르게 반복된다.
  ): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, permission, accountOwnership(account))

    return account
  }

  /** 이 계정의 결제인가. 잠그기 전의 읽기다. */
  private async own(userId: string, paymentId: string): Promise<PaymentRow> {
    const row = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { userId } },
      select: {
        id: true,
        status: true,
        authorizedAmount: true,
        canceledAmount: true,
        paymentKey: true,
      },
    })

    if (row === null) throw new NotFoundException('결제를 찾을 수 없어요.')

    return row
  }

  /**
   * 결제 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * 한 문장이다. 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 — 다른 표를 함께
   * 읽어야 했다면 부질의가 시작할 때의 스냅샷을 들고 와 헛수고가 된다
   * (`StockService.lockVariant` 가 같은 이유로 둘로 나뉘어 있다).
   */
  private async lock(tx: Tx, paymentId: string): Promise<PaymentRow> {
    const rows = await tx.$queryRaw<readonly PaymentRow[]>`
      SELECT "id", "status", "authorizedAmount", "canceledAmount", "paymentKey"
        FROM "Payment"
       WHERE "id" = ${paymentId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('결제를 찾을 수 없어요.')

    return row
  }

  private assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (canTransition(from, to)) return

    throw new ConflictException(
      domainFailure('PAYMENT_TRANSITION_REFUSED', '지금 상태에서는 할 수 없는 요청이에요.', {
        params: { from, to },
        field: 'status',
      }),
    )
  }

  private async providerOf(paymentId: string) {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { provider: true },
    })

    if (row === null) throw new NotFoundException('결제를 찾을 수 없어요.')

    return this.registry.resolve(row.provider)
  }

  /** 이 결제가 어느 주문의 것이고 어느 수단으로 내는가. */
  private async contextOf(
    paymentId: string,
  ): Promise<{ readonly orderId: string; readonly methodRef: string | null }> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { orderId: true, methodRef: true },
    })

    if (row === null) throw new NotFoundException('결제를 찾을 수 없어요.')

    return row
  }

  /**
   * 결제키. 승인 전에는 없다.
   *
   * 없는데 여기까지 왔다면 상태 검사가 통과시킨 것이라 **우리 쪽 버그**다 —
   * 사용자가 고칠 수 있는 것이 없으므로 400 이 아니라 500 이다.
   */
  private keyOf(row: PaymentRow): string {
    if (row.paymentKey === null) {
      throw new ConflictException('승인되지 않은 결제예요.')
    }

    return row.paymentKey
  }

  /** 사건 하나를 남긴다. 상태를 바꾸지 않은 것도 남는다 (F5). */
  private async log(
    tx: Tx,
    paymentId: string,
    kind: PaymentEventKind,
    fromStatus: PaymentStatus | null,
    toStatus: PaymentStatus | null,
    now: Date,
    payload?: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.paymentEvent.create({
      data: {
        paymentId,
        kind,
        fromStatus,
        toStatus,
        ...(payload === undefined ? {} : { payload }),
        createdAt: now,
      },
    })
  }
}

/** 거절 셋을 각자의 답으로. 사람이 할 일이 다르므로 코드도 다르다. */
function refusalOf(reason: RefundRefusal, refundable: number): Error {
  if (reason === 'invalid_amount') {
    return new BadRequestException(
      domainFailure('PAYMENT_REFUND_INVALID', '환불 금액이 올바르지 않아요.', {
        field: 'amount',
      }),
    )
  }

  if (reason === 'status_forbidden') {
    return new ConflictException(
      domainFailure('PAYMENT_TRANSITION_REFUSED', '지금 상태에서는 환불할 수 없어요.', {
        field: 'status',
      }),
    )
  }

  return new ConflictException(
    domainFailure(
      'PAYMENT_REFUND_EXCEEDS',
      `환불할 수 있는 금액은 ${String(refundable)}원이에요.`,
      { field: 'amount', params: { refundable } },
    ),
  )
}

function present(row: {
  readonly id: string
  readonly orderId: string
  readonly provider: string
  readonly status: string
  readonly authorizedAmount: number
  readonly canceledAmount: number
  readonly paymentKey: string | null
  readonly approvedAt: Date | null
  readonly refunds: readonly {
    readonly id: string
    readonly amount: number
    readonly reason: string
    readonly refundedAt: Date
  }[]
}): Payment {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider as PaymentProviderName,
    status: row.status as PaymentStatus,
    authorizedAmount: row.authorizedAmount,
    canceledAmount: row.canceledAmount,
    paymentKey: row.paymentKey,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    refunds: row.refunds.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      reason: refund.reason,
      refundedAt: refund.refundedAt.toISOString(),
    })),
  }
}
