import { randomBytes } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { VirtualCardStatus } from './virtual-card-rules.js'
import {
  canIssueVirtualCard,
  chargeDecision,
  maskVirtualCardNumber,
  releaseDecision,
  VIRTUAL_CARD_RANDOM_DIGITS,
  VIRTUAL_CARDS_PER_USER,
  virtualCardNumberFrom,
} from './virtual-card-rules.js'

type Tx = Prisma.TransactionClient

/** 유니크 위반. 카드번호가 겹쳤을 때만 본다. */
const UNIQUE_VIOLATION = 'P2002'

/** 카드 한 장, 부르는 쪽이 보는 모양. **번호는 마스킹된 것만 나간다.** */
export interface IssuedCard {
  readonly id: string
  readonly maskedNumber: string
  readonly brand: string
  readonly creditLimit: number
  readonly usedAmount: number
  readonly status: VirtualCardStatus
  readonly expiresAt: string
}

/**
 * 사용 내역 한 줄 (TASK-0058).
 *
 * `amount` 에 부호가 있다 — 승인은 양수(한도를 쓴다), 취소·환불은 음수(돌려준다).
 * 화면이 그 부호로 방향을 그리므로, 절댓값만 보내고 종류로 추측하게 두지 않는다.
 */
export interface CardTransaction {
  readonly id: string
  readonly kind: 'CHARGE' | 'CANCEL' | 'REFUND'
  readonly amount: number
  readonly balanceAfter: number
  readonly createdAt: Date
  /** 이 사건이 어느 주문의 결제였나. 결제를 거치지 않았으면 `null` 이다 (4.2). */
  readonly orderNumber: string | null
  readonly orderId: string | null
}

/** `usedAmount` 가 원장과 어긋난 카드 (F3). */
export interface CardDiscrepancy {
  readonly cardId: string
  readonly usedAmount: number
  readonly ledgerBalance: number
}

/** 발급이 쓰는 만큼의 Prisma — 트랜잭션 핸들도 이 모양을 만족한다. */
type CardClient = Pick<PrismaService, 'virtualCard'>

/** 잠금 아래에서 읽은 카드 한 줄. */
interface LockedCard {
  readonly id: string
  readonly status: VirtualCardStatus
  readonly creditLimit: number
  readonly usedAmount: number
  readonly expiresAt: Date
}

/** 카드가 유효한 기간. 3년은 실물 카드의 관례를 따른 것이다. */
const VALID_FOR_YEARS = 3

/** 데모 계정이 자동으로 받는 한도 (F5). */
export const DEMO_CARD_LIMIT = 1_000_000

/**
 * 가상 카드 (TASK-0053).
 *
 * **환불이 제대로 됐는지 잔액으로 눈으로 확인할 수 있게 하는 것**이 이 카드의
 * 목적이다. 그래서 잔액이 있는 것은 원장을 둔다는 원칙(재고·적립금과 같다)이
 * 여기에도 적용되고, 각 행이 `balanceAfter` 를 들고 있어 대사가 가능하다.
 *
 * **실제 카드가 아니라는 것이 번호에서 보인다** (R1). 접두어 `9999` 는 실제 BIN 과
 * 겹치지 않으므로 어떤 결제망에도 닿지 않고, `VirtualCard_number_format_check` 가
 * 그 형식을 DB 에서 지킨다.
 *
 * **전문은 밖으로 나가지 않는다.** 부르는 쪽이 받는 것은 마스킹된 번호뿐이다 —
 * 6.2 가 「로그에 카드번호 전문이 남지 않는지」를 요구하고, 나가지 않는 값은 로그에
 * 찍힐 수도 없다.
 */
@Injectable()
export class VirtualCardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 발급 (F1 · F6).
   *
   * 번호가 겹치면 **한 번 다시 뽑는다.** 12자리 난수라 겹칠 일이 없지만 「없다」는
   * 애플리케이션이 보증할 수 있는 성질이 아니고, 무한히 다시 뽑는 고리는 다른
   * 이유로 실패할 때 영원히 돈다.
   */
  async issue(principal: RequestPrincipal, creditLimit: number): Promise<IssuedCard> {
    const account = await this.account(principal, 'profile.write')

    return this.issueFor(account.id, creditLimit)
  }

  /**
   * 계정 하나에 카드를 만든다. 데모 발급도 이쪽으로 온다 (F5).
   *
   * `principal` 을 받지 않는 이유는 부르는 쪽이 사람이 아니기 때문이다 — 데모
   * 계정은 발급되는 순간 자기 토큰이 없다.
   */
  async issueFor(
    userId: string,
    creditLimit: number,
    /**
     * 부르는 쪽이 이미 연 트랜잭션. 데모 발급이 그 모양이다 — 계정과 그 계정의
     * 첫 카드가 한 트랜잭션 안에서 생겨야, 카드 없는 데모 계정이라는 반쯤 지어진
     * 상태가 존재할 수 없다.
     */
    client: CardClient = this.prisma,
  ): Promise<IssuedCard> {
    if (!Number.isInteger(creditLimit) || creditLimit <= 0) {
      throw new BadRequestException(
        domainFailure('CARD_AMOUNT_INVALID', '한도를 올바르게 입력해 주세요.', {
          field: 'creditLimit',
        }),
      )
    }

    const living = await client.virtualCard.count({
      where: { userId, status: { not: 'DELETED' } },
    })

    if (!canIssueVirtualCard(living)) {
      throw new BadRequestException(
        domainFailure(
          'CARD_COUNT_REACHED',
          `카드는 ${String(VIRTUAL_CARDS_PER_USER)}장까지 만들 수 있어요.`,
          {
            field: 'creditLimit',
            params: { max: VIRTUAL_CARDS_PER_USER },
          },
        ),
      )
    }

    try {
      return await this.create(client, userId, creditLimit)
    } catch (error: unknown) {
      // 부르는 쪽의 트랜잭션 안이면 다시 시도할 수 없다 — Postgres 는 한 문장이
      // 실패하면 그 트랜잭션 전체를 중단시키고, 이후의 모든 문장이 거절된다
      // (TASK-0045 가 장바구니에서 겪었다). 그때는 그대로 던져 트랜잭션을
      // 되돌린다: 데모 발급은 통째로 다시 하는 것이 옳다.
      if (!isNumberCollision(error) || client !== this.prisma) throw error

      return this.create(client, userId, creditLimit)
    }
  }

  /** 이 사람의 카드들. 지운 것은 빼고 최신순. */
  async list(principal: RequestPrincipal): Promise<readonly IssuedCard[]> {
    const account = await this.account(principal, 'user.read')
    const rows = await this.prisma.virtualCard.findMany({
      where: { userId: account.id, status: { not: 'DELETED' } },
      orderBy: { id: 'desc' },
      select: CARD_SELECT,
    })

    return rows.map((row) => present(row))
  }

  /**
   * 승인 — 한도를 쓴다 (F2 · F4 · F8).
   *
   * **판단과 쓰기가 같은 잠금 안에 있다.** 동시에 들어온 두 승인이 각자 「아직
   * 여유가 있다」를 읽으면 합계가 한도를 넘고, 그 차액은 카드가 감당 못 하는 돈이다.
   * 잠금이 그것을 직렬화하고 `VirtualCard_usedAmount_check` 가 마지막 줄로 남는다.
   */
  charge(cardId: string, amount: number, refId: string): Promise<IssuedCard> {
    return this.prisma.$transaction(async (tx) => {
      const card = await this.lock(tx, cardId)

      // **유효기간은 여기서 본다.** 순수 판단 모듈은 시계를 갖지 않는데(그래야 분기
      // 100% 가 정직하다), 지난 카드로 결제되면 「가상 카드도 실물처럼 만료된다」는
      // 약속이 아무 데서도 지켜지지 않는다. 돌려주는 쪽(`release`)은 보지 않는다 —
      // 만료된 카드의 미결 환불도 반드시 돌아와야 한다.
      if (card.expiresAt.getTime() <= this.clock.now().getTime()) {
        throw new ConflictException(
          domainFailure('CARD_EXPIRED', '유효기간이 지난 카드예요.', { field: 'cardId' }),
        )
      }

      const decision = chargeDecision(card, amount)

      if (decision.outcome === 'refused') {
        throw chargeRefusal(decision.reason, decision.availableAmount)
      }

      return this.record(tx, card.id, 'CHARGE', amount, decision.usedAmount, refId)
    })
  }

  /**
   * 취소·환불 — 한도를 돌려준다 (F2).
   *
   * 카드가 정지·삭제됐어도 돌려준다. 막으면 카드를 정지시키는 순간 그 카드의 미결
   * 환불이 갈 곳을 잃고, `usedAmount` 는 영원히 그 금액을 물고 있는다 — 「원장
   * 합계와 사용액이 일치한다」가 「정지된 카드는 쓸 수 없다」보다 강하다.
   */
  release(
    cardId: string,
    amount: number,
    refId: string,
    kind: 'CANCEL' | 'REFUND',
  ): Promise<IssuedCard> {
    return this.prisma.$transaction(async (tx) => {
      const card = await this.lock(tx, cardId)
      const decision = releaseDecision(card, amount)

      if (decision.outcome === 'refused') {
        throw releaseRefusal(decision.reason, decision.releasableAmount)
      }

      return this.record(tx, card.id, kind, -amount, decision.usedAmount, refId)
    })
  }

  /** 정지. 되살릴 수 있으므로 삭제와 다르다. */
  suspend(principal: RequestPrincipal, cardId: string): Promise<IssuedCard> {
    return this.setStatus(principal, cardId, 'SUSPENDED')
  }

  /**
   * 삭제. **소프트 삭제다** — 원장이 이 카드를 가리키고, 그 기록은 남아야 한다.
   *
   * 개수 제한은 살아 있는 카드만 센다. 지워도 줄지 않는 제한은 사용자에게 고장으로
   * 보인다.
   */
  async remove(principal: RequestPrincipal, cardId: string): Promise<void> {
    await this.setStatus(principal, cardId, 'DELETED')
  }

  /**
   * 카드의 사용 내역 (TASK-0058 F3 · F4).
   *
   * **주문번호를 함께 싣는다** (4.2). 원장 행이 들고 있는 것은 결제 id 이고, 주문
   * 번호는 `Payment.orderId` 를 한 번 더 지나야 나온다 — 화면이 줄마다 다시 물어보게
   * 두면 왕복이 줄 수만큼 붙는다.
   *
   * 결제를 거치지 않은 행은 주문번호가 `null` 이다. 원장의 참조는 무엇이든 될 수
   * 있고, 그때는 **링크가 없는 줄이지 잘못된 줄이 아니다.**
   *
   * 질의 둘이다 — 소유권 하나, 원장 하나. **원장이 길어져도 늘지 않는다** (A5):
   * 주문번호는 조인으로 따라오지 줄마다 다시 묻지 않는다.
   */
  async transactions(
    principal: RequestPrincipal,
    cardId: string,
  ): Promise<readonly CardTransaction[]> {
    const account = await this.account(principal, 'user.read')
    const card = await this.prisma.virtualCard.findFirst({
      // 소유권을 조건에 둔다. 남의 카드 원장은 **있는지 없는지도** 알려 주지 않는다 —
      // 그 사람이 무엇을 샀는지가 그 목록에 그대로 적혀 있다.
      where: { id: cardId, userId: account.id },
      select: { id: true },
    })

    if (card === null) throw new NotFoundException('카드를 찾을 수 없어요.')

    return this.prisma.$queryRaw<readonly CardTransaction[]>`
      SELECT t."id",
             t."kind",
             t."amount",
             t."balanceAfter",
             t."createdAt",
             o."orderNumber",
             o."id" AS "orderId"
        FROM "VirtualCardTransaction" t
        LEFT JOIN "Payment" p ON p."id"::text = t."refId"
        LEFT JOIN "Order" o ON o."id" = p."orderId"
       WHERE t."cardId" = ${cardId}::uuid
       ORDER BY t."createdAt" ASC, t."id" ASC
    `
  }

  /** 정지를 푼다. 다시 결제할 수 있게 된다. */
  activate(principal: RequestPrincipal, cardId: string): Promise<IssuedCard> {
    return this.setStatus(principal, cardId, 'ACTIVE')
  }

  /**
   * 이 참조로 승인이 남아 있는 카드 (TASK-0054).
   *
   * 취소·환불이 결제키만 들고 오므로, 그것으로 카드를 되찾는 자리가 필요하다.
   * 원장이 그 답을 갖고 있다 — 승인 행의 `refId` 가 결제 id 다.
   */
  async cardIdFor(refId: string): Promise<string | null> {
    const row = await this.prisma.virtualCardTransaction.findFirst({
      where: { refId, kind: 'CHARGE' },
      select: { cardId: true },
    })

    return row?.cardId ?? null
  }

  /** 이 참조의 승인이 원장에 있는가. 대사가 묻는 질문이다. */
  async chargedFor(refId: string): Promise<boolean> {
    return (await this.cardIdFor(refId)) !== null
  }

  /**
   * `usedAmount` 가 원장과 어긋난 카드 전부 (F3).
   *
   * **고치지 않는다.** 원인을 모르는 채 값을 고치면 문제가 숨는다 — 재고와 예약이
   * 같은 판단을 했다(TASK-0036 · 0051).
   */
  reconcile(): Promise<readonly CardDiscrepancy[]> {
    return this.prisma.$queryRaw<readonly CardDiscrepancy[]>`
      SELECT c."id" AS "cardId",
             c."usedAmount",
             COALESCE(l."sum", 0)::int AS "ledgerBalance"
        FROM "VirtualCard" c
        LEFT JOIN LATERAL (
          SELECT sum(t."amount")::int AS "sum"
            FROM "VirtualCardTransaction" t
           WHERE t."cardId" = c."id"
        ) l ON TRUE
       WHERE c."usedAmount" <> COALESCE(l."sum", 0)
    `
  }

  // ---------------------------------------------------------------- internals

  private async account(
    principal: RequestPrincipal,
    permission: 'profile.write' | 'user.read',
  ): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, permission, accountOwnership(account))

    return account
  }

  private async create(
    client: CardClient,
    userId: string,
    creditLimit: number,
  ): Promise<IssuedCard> {
    const now = this.clock.now()
    const expiresAt = new Date(now)

    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + VALID_FOR_YEARS)

    const row = await client.virtualCard.create({
      data: {
        userId,
        number: virtualCardNumberFrom(randomBytes(VIRTUAL_CARD_RANDOM_DIGITS)),
        brand: '데모카드',
        creditLimit,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
      select: CARD_SELECT,
    })

    return present(row)
  }

  /**
   * 카드 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * 한 문장이다 — 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다.
   */
  private async lock(tx: Tx, cardId: string): Promise<LockedCard> {
    const rows = await tx.$queryRaw<readonly LockedCard[]>`
      SELECT "id", "status", "creditLimit", "usedAmount", "expiresAt"
        FROM "VirtualCard"
       WHERE "id" = ${cardId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('카드를 찾을 수 없어요.')

    return row
  }

  /** 원장에 한 줄을 적고 카드의 사용액을 그 결과로 **대입한다.** */
  private async record(
    tx: Tx,
    cardId: string,
    kind: 'CHARGE' | 'CANCEL' | 'REFUND',
    amount: number,
    usedAmount: number,
    refId: string,
  ): Promise<IssuedCard> {
    const now = this.clock.now()

    await tx.virtualCardTransaction.create({
      data: { cardId, kind, amount, balanceAfter: usedAmount, refId, createdAt: now },
    })

    // 더하는 것이 아니라 **대입**이다. 판단이 낸 값을 그대로 쓰므로 원장의 합과
    // 사용액이 산술로는 갈라질 수 없다 — 갈라지려면 이 파일 밖에서 누가 쓰는
    // 수밖에 없고, 그것을 F3 의 점검이 본다.
    const row = await tx.virtualCard.update({
      where: { id: cardId },
      data: { usedAmount, updatedAt: now },
      select: CARD_SELECT,
    })

    return present(row)
  }

  private async setStatus(
    principal: RequestPrincipal,
    cardId: string,
    status: VirtualCardStatus,
  ): Promise<IssuedCard> {
    const account = await this.account(principal, 'profile.write')
    const card = await this.prisma.virtualCard.findFirst({
      // `userId` 를 조건에 두는 것이 소유권 검사다. 남의 카드 id 를 보내면
      // 「없다」로 답한다 — 있는지 없는지를 알려 주지 않는 것이 옳다.
      where: { id: cardId, userId: account.id },
      select: { id: true },
    })

    if (card === null) throw new NotFoundException('카드를 찾을 수 없어요.')

    const row = await this.prisma.virtualCard.update({
      where: { id: cardId },
      data: { status, updatedAt: this.clock.now() },
      select: CARD_SELECT,
    })

    return present(row)
  }
}

const CARD_SELECT = {
  id: true,
  number: true,
  brand: true,
  creditLimit: true,
  usedAmount: true,
  status: true,
  expiresAt: true,
} as const

function present(row: {
  readonly id: string
  readonly number: string
  readonly brand: string
  readonly creditLimit: number
  readonly usedAmount: number
  readonly status: string
  readonly expiresAt: Date
}): IssuedCard {
  return {
    id: row.id,
    // 전문은 여기서 끝난다. 나가지 않는 값은 로그에 찍힐 수도 없다 (6.2).
    maskedNumber: maskVirtualCardNumber(row.number),
    brand: row.brand,
    creditLimit: row.creditLimit,
    usedAmount: row.usedAmount,
    status: row.status as VirtualCardStatus,
    expiresAt: row.expiresAt.toISOString(),
  }
}

/** 카드번호가 겹쳤는가. 다른 유니크 위반은 재시도로 고쳐지지 않는다. */
function isNumberCollision(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false

  const failure = error as { code?: unknown; meta?: { target?: unknown } }

  if (failure.code !== UNIQUE_VIOLATION) return false

  const target = failure.meta?.target

  return typeof target === 'string'
    ? target.includes('number')
    : Array.isArray(target) && target.includes('number')
}

/** 승인 거절 셋을 각자의 답으로. 사람이 할 일이 다르므로 코드도 다르다. */
function chargeRefusal(
  reason: 'card_unusable' | 'invalid_amount' | 'exceeds_credit',
  available: number,
): Error {
  if (reason === 'card_unusable') {
    return new ConflictException(
      domainFailure('CARD_UNUSABLE', '지금은 사용할 수 없는 카드예요.', { field: 'cardId' }),
    )
  }

  if (reason === 'invalid_amount') {
    return new BadRequestException(
      domainFailure('CARD_AMOUNT_INVALID', '금액이 올바르지 않아요.', { field: 'amount' }),
    )
  }

  return new ConflictException(
    domainFailure(
      'CARD_LIMIT_EXCEEDED',
      `이 카드로는 ${String(available)}원까지 결제할 수 있어요.`,
      {
        field: 'amount',
        params: { available },
      },
    ),
  )
}

function releaseRefusal(reason: 'invalid_amount' | 'exceeds_used', releasable: number): Error {
  if (reason === 'invalid_amount') {
    return new BadRequestException(
      domainFailure('CARD_AMOUNT_INVALID', '금액이 올바르지 않아요.', { field: 'amount' }),
    )
  }

  return new ConflictException(
    domainFailure('CARD_RELEASE_EXCEEDS', `돌려줄 수 있는 금액은 ${String(releasable)}원이에요.`, {
      field: 'amount',
      params: { releasable },
    }),
  )
}
