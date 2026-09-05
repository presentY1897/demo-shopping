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
import type { TossConfirmRefusal } from './toss-rules.js'
import { confirmDecision } from './toss-rules.js'

type Tx = Prisma.TransactionClient

/**
 * 결과를 모르던 결제 하나를 풀어 본 결과 (TASK-0056).
 *
 * 넷을 나눠 두는 이유는 **배치가 세는 것이 달라서**다. `pending` 이 늘어나는 것은
 * 정상이지만 줄지 않는 것은 저쪽에 물어보지 못한다는 뜻이고, `noop` 이 많은 것은
 * 웹훅이 이미 일을 하고 있다는 뜻이라 아무 문제가 아니다.
 */
export type RecoveryOutcome =
  /** 승인이 확인돼 매입까지 끝났다. */
  | 'settled'
  /** 저쪽에도 없었다. 결제는 실패로 끝난다. */
  | 'failed'
  /** 저쪽도 아직 모른다. 다음 주기가 다시 묻는다. */
  | 'pending'
  /** 이 결제는 이미 누가 풀었다. */
  | 'noop'

/** 잠금 아래에서 읽은 결제 한 줄. */
interface PaymentRow {
  readonly id: string
  /** 어느 결제사인가. 토스 승인 라우트가 남의 결제를 받지 않기 위해 본다 (TASK-0055). */
  readonly provider: PaymentProviderName
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

    await this.assertNothingUnresolved(order.id)

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
      ...(context.methodRef === null ? {} : { methodRef: context.methodRef }),
    })
    const now = this.clock.now()

    // 승인이 안 된 두 방식이 **다른 상태로** 간다 (D-220). 저쪽이 답한 거절은
    // `FAILED`, 닿지 못한 것은 `UNRESOLVED` — 뒤쪽은 저쪽에서 승인이 나 있을 수
    // 있고, 그것을 「실패」로 적으면 되돌릴 길이 없다.
    const landing: PaymentStatus = result.outcome === 'declined' ? 'FAILED' : 'UNRESOLVED'

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)

      // 그 사이에 남이 옮겼을 수 있다. 결제사 응답을 들고 있어도 상태가 이미
      // 움직였다면 그것을 덮어쓰면 안 된다.
      this.assertTransition(fresh.status, result.outcome === 'approved' ? 'AUTHORIZED' : landing)

      if (result.outcome !== 'approved') {
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: landing, updatedAt: now },
        })
        // 사건의 종류는 둘 다 `FAILED` 다 — 「승인이 끝나지 않았다」가 일어난
        // 것이고, 그것이 어디에 앉았는지는 `toStatus` 가 말한다. 사건 종류를
        // 늘리면 같은 사실을 두 벌로 적게 된다.
        await this.log(tx, paymentId, 'FAILED', fresh.status, landing, now, {
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

  /**
   * 토스 결제창이 돌아왔다. 금액을 대조하고 승인으로 넘긴다 (TASK-0055 F1 · F2).
   *
   * **이 메서드의 존재 이유는 대조다.** 결제창 성공은 승인이 아니고, 돌아온
   * `amount` 는 사용자가 고칠 수 있는 쿼리스트링에서 온 값이다. 비교 대상은
   * **DB 의 승인액**이고 그 값은 주문이 정했다 — 그 대조를 빠뜨리는 것이 PG
   * 연동에서 가장 흔하고 가장 비싼 실수다.
   *
   * **어긋나면 토스를 부르지 않는다.** 부르고 나서 거절하는 구현도 「거절됐다」는
   * 단언은 통과하지만, 그쪽은 저쪽에 승인된 결제가 남고 우리 장부에는 남지 않는
   * 훨씬 나쁜 모양이다. 그래서 대조가 프로바이더 호출보다 **앞**에 있다.
   *
   * 거절해도 결제는 `READY` 로 남는다. 다른 카드로 다시 시도하는 길을 막지 않기
   * 위해서고(F3), 대신 **무슨 일이 있었는지는 이벤트로 남는다** — 금액 조작 시도는
   * 조용히 사라지면 안 되는 종류의 사건이다.
   */
  async confirmToss(
    principal: RequestPrincipal,
    paymentId: string,
    paymentKey: string,
    amount: number,
  ): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')
    const held = await this.own(account.id, paymentId)
    const decision = confirmDecision(held, amount)

    if (decision.outcome === 'refused') {
      const now = this.clock.now()

      // 상태를 바꾸지 않는 사건이다. `PaymentEvent_transition_check` 가 두 상태의
      // 짝을 강제하므로 둘 다 `null` 이고, 그것이 「아무 데도 가지 않았다」의 표현이다.
      await this.prisma.$transaction((tx) =>
        this.log(tx, paymentId, 'FAILED', null, null, now, {
          reason: decision.reason,
          expected: held.authorizedAmount,
          received: amount,
        }),
      )

      throw confirmRefusalOf(decision.reason)
    }

    // 결제창이 돌려준 키를 결제에 붙인다. 승인 경로는 **하나뿐**이다 — 프로바이더가
    // 그 키를 `methodRef` 로 받으므로, 토스도 가상 카드와 같은 `authorize` 를 지난다.
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { methodRef: paymentKey, updatedAt: this.clock.now() },
    })

    return this.authorize(principal, paymentId)
  }

  /** 매입 확정. `AUTHORIZED` → `PAID`. */
  async capture(principal: RequestPrincipal, paymentId: string): Promise<PaymentResponse> {
    const account = await this.account(principal, 'order.write')

    await this.own(account.id, paymentId)
    await this.settle(paymentId)

    return this.get(principal, paymentId)
  }

  /**
   * 매입하고 주문을 완료시킨다 — **권한을 보지 않는다** (TASK-0056).
   *
   * `capture` 에서 떼어 낸 것은 **부르는 쪽이 사람이 아닐 수 있기 때문**이다.
   * 대사가 끊겼던 승인을 되찾으면 그 결제를 끝까지 보내야 하는데, 그때 화면 앞에
   * 아무도 없다 — 권한을 볼 주체가 없는 것이지 권한이 없는 것이 아니다.
   *
   * 그래서 **부르는 쪽이 자기 방식으로 자격을 먼저 본다.** `capture` 는 소유를
   * 확인하고, 대사는 자기가 배치라는 사실로 그것을 대신한다. 이 메서드를 라우트에
   * 직접 붙이면 남의 결제를 매입할 수 있으므로, 붙이지 않는다.
   */
  async settle(paymentId: string): Promise<void> {
    const held = await this.read(paymentId)

    this.assertTransition(held.status, 'PAID')

    const provider = this.registry.resolve(held.provider)

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
  }

  /**
   * 결과를 모르던 결제 하나를 푼다 (TASK-0056 F9 · D-220).
   *
   * **웹훅과 대사 배치가 같은 이 문을 쓴다.** 웹훅은 「지금 확인해 보라」는 신호일
   * 뿐이고 그 본문을 믿지 않는다 — 상태를 정하는 것은 저쪽에 **우리가 다시 물어본
   * 답**이다. 신호를 믿는 구현은 중복·순서 역전·위조를 각각 따로 막아야 하지만,
   * 다시 묻는 구현은 그 셋이 전부 같은 답으로 접힌다.
   *
   * 상태를 옮기지 않는 갈래가 둘이고 **이유가 다르다.**
   *
   * | 답 | 결과 | 왜 |
   * | --- | --- | --- |
   * | 승인 | `AUTHORIZED` → 매입까지 | 저쪽에 돈이 잡혀 있었다 |
   * | 거절 | `FAILED` | 저쪽에도 없거나 이미 끝났다 |
   * | 모름 | `pending` | 저쪽도 아직 처리 중이다. 다음 주기가 다시 묻는다 |
   * | 이미 옮겨짐 | `noop` | 다른 신호가 먼저 도착했다 — 그것이 멱등의 모양이다 |
   *
   * **`pending` 은 사건을 남기지 않는다.** 대사가 1분마다 도는데 그때마다 한 줄씩
   * 쌓으면, 정작 읽어야 할 상태 변화가 그 사이에 묻힌다.
   */
  async resolveUnresolved(paymentId: string): Promise<RecoveryOutcome> {
    const held = await this.read(paymentId)

    if (held.status !== 'UNRESOLVED') return 'noop'

    const result = await this.registry.resolve(held.provider).recover(paymentId)

    if (result.outcome === 'unknown') return 'pending'

    const now = this.clock.now()
    const landing: PaymentStatus = result.outcome === 'approved' ? 'AUTHORIZED' : 'FAILED'
    const moved = await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)

      // 그 사이에 다른 신호가 이 결제를 풀었다. 던지지 않는 이유는 **이것이
      // 정상이기 때문**이다 — 웹훅과 배치는 같은 건을 동시에 만나도록 되어 있다.
      if (fresh.status !== 'UNRESOLVED') return false

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: landing,
          ...(result.outcome === 'approved'
            ? { paymentKey: result.paymentKey, approvedAt: now }
            : {}),
          updatedAt: now,
        },
      })
      await this.log(
        tx,
        paymentId,
        landing === 'AUTHORIZED' ? 'AUTHORIZED' : 'FAILED',
        'UNRESOLVED',
        landing,
        now,
        {
          reason: result.outcome === 'approved' ? '대사가 승인을 확인했습니다.' : result.reason,
        },
      )

      return true
    })

    if (!moved) return 'noop'
    // 승인만 확인하고 멈추면 돈은 잡혀 있는데 주문이 없다 — 이 TASK 가 없애려는
    // 상태 그대로다. 그래서 여기서 끝까지 보낸다.
    if (result.outcome === 'approved') await this.settle(paymentId)

    return result.outcome === 'approved' ? 'settled' : 'failed'
  }

  /**
   * 승인 취소 — 매입 없이 남은 건을 되감는다 (TASK-0057 F2 · D-221).
   *
   * **환불이 아니다.** 매입 전이라 돈이 아직 우리 쪽으로 오지 않았고, 프로바이더
   * API 도(`cancel` 대 `refund`) 수수료도 다르며 **부분이 없다** — 매입한 적이
   * 없으니 나눌 것이 없다. `PaymentProviderPort.cancel` 이 처음부터 있었고 지금까지
   * 아무도 부르지 않았던 자리가 이것이다.
   *
   * **권한을 보지 않는다.** 부르는 쪽이 배치이기 때문이고, 그래서 라우트에 붙이지
   * 않는다 — 사용자에게 「승인 취소」 버튼은 없다. 그 사람은 이미 화면을 떠났고,
   * 떠나지 않았다면 다음 행동은 결제를 마치는 것이다.
   *
   * 프로바이더 호출이 **잠금 안**인 이유는 환불과 같다(4.4). 저쪽에 먼저 말하고
   * 우리가 못 적으면 「돈은 풀렸는데 장부는 잡혀 있다」가 되고, 그 불일치는 다음
   * 주기가 같은 건을 또 취소하게 만든다.
   */
  async cancelAuthorization(paymentId: string, reason: string): Promise<void> {
    const held = await this.read(paymentId)

    this.assertTransition(held.status, 'CANCELED')

    const provider = this.registry.resolve(held.provider)
    const now = this.clock.now()

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.lock(tx, paymentId)

      // 그 사이에 매입이 끝났을 수 있다 — 사람이 돌아와 결제를 마친 경우다.
      // 던지지 않는 이유는 **그것이 좋은 결과이기 때문**이다: 되감을 이유가
      // 사라졌고, 배치는 다음 건으로 가면 된다.
      if (fresh.status !== 'AUTHORIZED') return

      await provider.cancel(this.keyOf(fresh), fresh.authorizedAmount, reason)

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'CANCELED',
          // 승인액은 그대로 두고 취소 누계를 채운다. 「얼마가 잡혔다가 풀렸나」를
          // 나중에 셀 수 있어야 하고, 승인액을 0으로 지우면 그 사실이 사라진다.
          canceledAmount: fresh.authorizedAmount,
          updatedAt: now,
        },
      })
      await this.log(tx, paymentId, 'CANCELED', fresh.status, 'CANCELED', now, { reason })
    })
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

  /**
   * 결과를 모르는 결제가 있으면 새 결제를 시작하지 않는다 (D-220).
   *
   * **이것이 `UNRESOLVED` 를 만든 값의 절반이다.** 저쪽에서 승인이 나 있었다면
   * 다시 결제한 사람의 카드에서 두 번 빠지고, 그 두 번째는 우리가 만든 것이다.
   * 화면에 「다시 결제하지 마세요」라고 적는 것만으로는 부족하다 — API 를 직접
   * 부르는 길이 있고, 새로고침한 화면은 그 문장을 잊는다.
   *
   * 막혀 있는 시간은 대사 주기만큼이다. 그 사이 사람이 기다리는 것이 두 번
   * 결제되는 것보다 낫고, 대사가 풀면 다음 시도는 그냥 지나간다.
   */
  private async assertNothingUnresolved(orderId: string): Promise<void> {
    const pending = await this.prisma.payment.count({
      where: { orderId, status: 'UNRESOLVED' },
    })

    if (pending === 0) return

    throw new ConflictException(
      domainFailure(
        'PAYMENT_AWAITING_RESULT',
        '앞선 결제의 결과를 확인하는 중이에요. 잠시 후 다시 시도해 주세요.',
        { field: 'orderId' },
      ),
    )
  }

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

  /**
   * 결제 한 줄. **소유를 보지 않는다** — 부르는 쪽이 이미 봤거나 배치다.
   *
   * `own` 과 나뉜 이유가 그것뿐이라 select 는 같다. 합치고 `userId` 를 선택적으로
   * 두면 「소유를 안 보는 길」이 기본값 하나 뒤에 숨는다.
   */
  private async read(paymentId: string): Promise<PaymentRow> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        provider: true,
        status: true,
        authorizedAmount: true,
        canceledAmount: true,
        paymentKey: true,
      },
    })

    if (row === null) throw new NotFoundException('결제를 찾을 수 없어요.')

    return row
  }

  /** 이 계정의 결제인가. 잠그기 전의 읽기다. */
  private async own(userId: string, paymentId: string): Promise<PaymentRow> {
    const row = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { userId } },
      select: {
        id: true,
        provider: true,
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
      SELECT "id", "provider", "status", "authorizedAmount", "canceledAmount", "paymentKey"
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

/**
 * 토스 승인 거절 셋을 각자의 답으로 (TASK-0055 F2).
 *
 * 금액 불일치가 400 인 이유는 **요청이 틀렸기 때문**이다 — 상태를 기다려도 낫지
 * 않는다. `READY` 가 아닌 것은 409 다: 같은 리다이렉트가 두 번 열린 것(뒤로 가기·
 * 새로고침)이 대부분이고, 그때는 이미 끝난 결제가 하나 있다.
 */
function confirmRefusalOf(reason: TossConfirmRefusal): Error {
  if (reason === 'amount_mismatch') {
    return new BadRequestException(
      domainFailure('PAYMENT_AMOUNT_MISMATCH', '결제 금액이 주문 금액과 달라요.', {
        field: 'amount',
      }),
    )
  }

  if (reason === 'awaiting_result') {
    // 「이미 처리됐다」가 아니다. 그 사람의 결제는 아직 끝나지 않았고, 우리가 할
    // 말은 「확인 중이니 다시 결제하지 마세요」다 — 새 결제를 막을 때와 같은 코드를
    // 쓰는 이유가 그것이다. 화면은 두 자리를 같은 문장으로 답한다.
    return new ConflictException(
      domainFailure(
        'PAYMENT_AWAITING_RESULT',
        '앞선 결제의 결과를 확인하는 중이에요. 잠시 후 다시 시도해 주세요.',
        { field: 'status' },
      ),
    )
  }

  if (reason === 'provider_mismatch') {
    return new BadRequestException(
      domainFailure('PAYMENT_PROVIDER_MISMATCH', '토스로 시작한 결제가 아니에요.', {
        field: 'provider',
      }),
    )
  }

  return new ConflictException(
    domainFailure('PAYMENT_TRANSITION_REFUSED', '이미 처리된 결제예요.', { field: 'status' }),
  )
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
