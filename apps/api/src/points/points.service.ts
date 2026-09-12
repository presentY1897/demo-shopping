import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  PointBalance,
  PointLedgerEntry,
  PointLedgerResponse,
  PointPolicy,
  PointReconciliationFault,
  PointRefType,
  PointTransactionType,
} from '@shopping/shared'
import { POINT_LEDGER_DEFAULT_LIMIT } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { PointIssue, PointLedgerAudit, PointMovementDraft } from './point-ledger.js'
import {
  earnedAmount,
  expiryFrom,
  movementIssues,
  nextBalance,
  planConsumption,
  reconciliationFaults,
  usageAmountIssue,
} from './point-ledger.js'

/** 부르는 쪽이 연 트랜잭션의 손잡이. */
type Tx = Prisma.TransactionClient

/** 한 사건을 두 번 적는 것을 거절하는 인덱스. */
const REF_INDEX = 'PointTransaction_ref_key'

/** 유니크 위반. 계좌가 동시에 두 번 만들어졌을 때만 본다. */
const UNIQUE_VIOLATION = 'P2002'

/** 정책 행에서 읽는 것 전부. */
const POLICY_SELECT = { earnRateBp: true, validityDays: true } as const

/** 거절마다의 문장. 빠짐없는 레코드라 새 코드가 조용히 문장을 잃지 못한다. */
const ISSUE_MESSAGE: Readonly<Record<PointIssue['code'], string>> = {
  zero_amount: '적립금 변동은 0원일 수 없어요.',
  not_positive: '적립금은 1원 이상 원 단위로 입력해 주세요.',
  wrong_direction: '이 변동 유형에는 쓸 수 없는 부호예요.',
  amount_too_large: '한 번에 움직일 수 있는 금액을 넘었어요.',
  unpaired_reference: '참조 유형과 참조 id 는 함께 보내야 해요.',
  reason_required: '적립금을 조정하려면 사유를 입력해 주세요.',
  blank_reason: '사유를 입력해 주세요.',
}

/** 적립 한 건, 부르는 쪽이 말하는 대로. */
export interface EarnInput {
  readonly userId: string
  /** 적립의 근거가 된 금액 — 그 판매자 몫의 **실결제금액**. */
  readonly paidAmount: number
  readonly refType: PointRefType
  readonly refId: string
}

/** 사용 한 건. */
export interface UseInput {
  readonly userId: string
  /** 양수. 부호는 원장이 붙인다. */
  readonly amount: number
  readonly refType: PointRefType
  readonly refId: string
}

/** 원장이 잔액을 설명하지 못하는 계정 하나. */
export interface PointDiscrepancy {
  readonly userId: string
  readonly balance: number
  readonly ledgerBalance: number
  readonly lotBalance: number
  readonly faults: readonly PointReconciliationFault[]
}

/** 만료 한 주기가 실제로 닫은 통. */
export interface ExpiredLot {
  readonly userId: string
  readonly lotId: string
  readonly amount: number
}

/** 잠금 아래에서 읽은 계좌 한 줄. */
interface LockedAccount {
  readonly id: string
  readonly balance: number
}

/** 아직 살아 있는 통 하나, 데이터베이스가 돌려주는 모양. */
interface LotRow {
  readonly id: string
  readonly remainingAmount: number
}

/** 원장 행 하나, 데이터베이스가 돌려주는 모양. */
interface EntryRow {
  readonly seq: number
  readonly type: PointTransactionType
  readonly amount: number
  readonly balanceAfter: number
  readonly refType: PointRefType | null
  readonly refId: string | null
  readonly reason: string | null
  readonly expiresAt: Date | null
  readonly remainingAmount: number | null
  readonly earnRateBp: number | null
  readonly createdAt: Date
}

/**
 * 적립금 원장 (TASK-0076).
 *
 * **`PointAccount.balance` 를 바꾸는 길은 여기 하나뿐이다.** 재고(`StockService`)와
 * 가상카드(`VirtualCardService`)가 앞선 둘이고, 셋이 같은 네 가지 규율을 지킨다.
 *
 * **계좌 행을 먼저, 그리고 명시적으로 잠근다.** 잠금 안에서 정해지는 것이 셋이다 —
 * 쓸 수 있는가, 이 사건이 몇 번째인가, 그 뒤 잔액이 얼마인가 — 그리고 셋 다 **다른
 * 행들에서** 읽는다(통 · 원장 · 계좌). 그래서 조건부 갱신이 아니라 잠금이다.
 *
 * 그 갈림의 기준은 이 저장소가 이미 적어 두었다: **「판단이 그 행 안에서 끝나는가」**
 * (TASK-0065 4.1). `ReservationService.reserve` 는 `stock - reserved >= q` 라 한
 * 문장이 됐고, `PaymentService.lock` 은 프로바이더 응답을 봐야 해서 잠금이 됐다.
 * 적립금 사용은 **잔액만 보면 뒤쪽처럼 보이지만 아니다** — `balance >= amount` 하나면
 * 조건부 갱신으로 충분한데, 같은 트랜잭션이 「어느 통에서 빼는가」(다른 행들)와
 * 「이 사건의 자리」(원장의 max(seq))와 「그 뒤 잔액」(원장에 박제될 값)까지 함께
 * 정해야 하고 그 셋은 계좌 행 안에 없다. 조건부 갱신으로 잔액만 지키면 통과 잔액이
 * 갈라지고(P5), 그것은 만료가 돌 때까지 보이지 않는다.
 *
 * **잠금과 읽기는 일부러 두 문장이다.** READ COMMITTED 에서 기다리다 풀린
 * `SELECT … FOR UPDATE` 는 그 행을 다시 읽지만, 같은 문장 안의 부질의는 시작할 때의
 * 스냅샷을 그대로 든다. 잠그는 문장에서 `max(seq)` 까지 물으면 **최신 잔액 옆에 낡은
 * 자리**가 돌아오고, 증상은 바쁜 계정에서의 유니크 충돌이다 — 아무도 재현하지 못하는
 * 종류의 실패다 (`StockService` 가 같은 자리에 같은 주석을 달아 두었다).
 *
 * **현재값은 무엇을 향해 조정되지 않는다.** `balance` 에는 방금 원장에 적은
 * `balanceAfter` 를 **대입한다.** `balance = balance - n` 이 어디에도 없으므로 둘은
 * 산술로 갈라질 수 없고, 갈라지려면 이 파일 밖에서 누가 써야 한다 — 그것을
 * {@link reconcile} 이 본다.
 *
 * **마지막 방어선은 데이터베이스다.** `PointAccount_balance_check (balance >= 0)`.
 * 잠금이 답이라도 제약이 없으면 그 잠금을 안 쓰는 코드가 하나 생기는 날 조용히
 * 넘친다 (TASK-0065 4.1 의 음성 대조).
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ 정책

  /**
   * 적립 정책 한 행. 없으면 만든다.
   *
   * **`?? 기본값` 으로 메우지 않는다.** 코드에 적힌 기본값은 두 번째 정책이 되고,
   * 관리자가 적립률을 바꿔 둔 뒤 행이 사라지면 그 두 번째 정책이 조용히 되살아난다.
   * 대신 **빈 행을 만들어** 컬럼 기본값이 값을 정하게 한다 — 그 기본값은
   * `schema.prisma` 한 곳에만 있고, 마이그레이션의 `INSERT` 도 열쇠만 넣고 나머지를
   * 같은 기본값에 맡긴다. 즉 숫자가 적힌 자리는 여전히 하나다.
   *
   * 만드는 일이 여기 있는 이유는 **행이 사라질 수 있기 때문**이다: 마이그레이션이
   * 넣은 행도 `TRUNCATE` 한 번에 없어지고(테스트 격리가 그렇게 돈다), 그때 적립이
   * 통째로 멈추면 원인과 아무 상관 없어 보이는 실패만 남는다.
   */
  async policy(): Promise<PointPolicy> {
    const existing = await this.readPolicy()

    if (existing !== null) return existing

    try {
      return await this.prisma.pointPolicy.create({ data: {}, select: POLICY_SELECT })
    } catch (error: unknown) {
      // 동시에 둘이 만들려 한 경우. 진 쪽은 이긴 쪽이 커밋한 뒤에 위반을 받으므로
      // 이 재조회는 반드시 그 행을 본다 ({@link accountIdFor} 와 같은 이유).
      if (!isUniqueViolation(error)) throw error

      const winner = await this.readPolicy()

      if (winner === null) throw error

      return winner
    }
  }

  private readPolicy(): Promise<PointPolicy | null> {
    return this.prisma.pointPolicy.findUnique({ where: { id: 1 }, select: POLICY_SELECT })
  }

  // ------------------------------------------------------------------ 쓰기

  /**
   * 구매확정 한 건이 지급하는 적립금 (F1).
   *
   * 지급액은 **적립 시점의 정책**으로 정해지고, 그 적립률이 원장 행에 함께 박제된다
   * (R2) — 정책 행을 나중에 읽어 되짚으면 적립률을 바꾼 날 과거가 전부 바뀐다.
   *
   * 0원이면 아무 행도 만들지 않고 `null` 이다. 적립률이 0이거나 결제액이 작아서
   * 내림이 0이 되는 것은 **정상**이고, 0원짜리 원장 행은 `seq` 를 하나 차지한 채
   * 아무것도 설명하지 않는다.
   */
  async earn(input: EarnInput): Promise<PointLedgerEntry | null> {
    const policy = await this.policy()
    const amount = earnedAmount(input.paidAmount, policy.earnRateBp)

    if (amount === 0) return null

    const accountId = await this.accountIdFor(input.userId)
    const now = this.clock.now()

    return this.prisma.$transaction((tx) =>
      this.recordEarning(tx, input, policy, accountId, amount, now),
    )
  }

  /** Keeps example confirmation rewards atomic with the new demo account. */
  async earnWithin(
    tx: Tx,
    input: EarnInput,
    now = this.clock.now(),
  ): Promise<PointLedgerEntry | null> {
    const policy = await tx.pointPolicy.upsert({
      where: { id: 1 },
      create: {},
      update: {},
      select: POLICY_SELECT,
    })
    const amount = earnedAmount(input.paidAmount, policy.earnRateBp)
    if (amount === 0) return null
    const account = await tx.pointAccount.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
      select: { id: true },
    })
    return this.recordEarning(tx, input, policy, account.id, amount, now)
  }

  private async recordEarning(
    tx: Tx,
    input: EarnInput,
    policy: PointPolicy,
    accountId: string,
    amount: number,
    now: Date,
  ): Promise<PointLedgerEntry> {
    const account = await this.lock(tx, accountId)
    const balance = account.balance + amount

    return this.record(tx, account.id, {
      draft: {
        type: 'EARN',
        amount,
        refType: input.refType,
        refId: input.refId,
        reason: null,
      },
      balanceAfter: balance,
      lot: {
        expiresAt: expiryFrom(now, policy.validityDays),
        remainingAmount: amount,
        earnRateBp: policy.earnRateBp,
      },
      now,
    })
  }

  /**
   * 주문이 쓰는 적립금 (F3 · F4 · F7).
   *
   * **잔액보다 많이 쓸 수 없고, 동시 요청에서도 그렇다.** 판단과 쓰기가 같은 잠금
   * 안에 있으므로 동시에 들어온 둘은 줄을 서고, 뒤에 선 쪽은 앞사람이 커밋한 잔액을
   * 다시 읽어 거절된다. 그 거절이 **그 순간의 쓸 수 있는 금액**을 함께 든다.
   *
   * 만료 시각이 지난 통은 후보에서 빠진다. 배치가 아직 안 돌았다는 이유로 이미 죽은
   * 적립금이 쓰이면, 배치가 도는 순간 그 금액을 두 번 없애야 한다.
   */
  async use(input: UseInput): Promise<PointLedgerEntry> {
    // 계획을 세우기 **전에** 본다. 음수 요청이 계획으로 들어가면 통의 잔고가 늘고,
    // 그 뒤에 원장 행이 부호 검사에 걸려도 이미 통을 손본 뒤다.
    const issue = usageAmountIssue(input.amount)

    if (issue !== null) throw refusal([issue])

    const accountId = await this.accountIdFor(input.userId)
    const now = this.clock.now()

    return this.prisma.$transaction(async (tx) => {
      const account = await this.lock(tx, accountId)
      const lots = await this.liveLots(tx, account.id, now)
      const plan = planConsumption(lots, input.amount)

      if (plan.outcome === 'refused') throw insufficient(plan.available)

      const balance = nextBalance(account.balance, -input.amount)

      // 통은 채웠는데 잔액이 모자란 계정 — 원장이 이미 어긋나 있다는 뜻이다(P5).
      // 여기서 통과시키면 `PointAccount_balance_check` 가 500 으로 막고, 그때
      // 사용자는 자기가 무엇을 잘못했는지 알 수 없는 오류를 본다.
      if (balance === null) throw insufficient(account.balance)

      const entry = await this.record(tx, account.id, {
        draft: {
          type: 'USE',
          amount: -input.amount,
          refType: input.refType,
          refId: input.refId,
          reason: null,
        },
        balanceAfter: balance,
        lot: null,
        now,
      })

      for (const draw of plan.draws) await this.drawLot(tx, draw.lotId, draw.remainingAfter)

      return entry
    })
  }

  /**
   * 한 계정의 기한 지난 통을 전부 닫는다 (F8).
   *
   * 계정 단위인 것이 중요하다 — 통마다 트랜잭션을 열면 `seq` 를 나눠 주는 잠금을
   * 통 수만큼 잡았다 놓고, 그 사이에 사용이 끼어들어 **같은 통을 이미 비운 뒤**
   * 만료가 도착할 수 있다. 한 잠금 안에서 다시 읽으면 그 경합이 없다.
   *
   * 각 만료 행은 **자기가 닫은 통을 가리킨다**(`refType: 'POINT_TRANSACTION'`).
   * 그래서 배치가 겹쳐 돌아도 둘째 행은 `PointTransaction_ref_key` 에 막힌다 —
   * 통이 이미 비어 후보에서 빠지는 것이 첫 번째 방어이고, 이 인덱스가 두 번째다.
   */
  async expireDueFor(userId: string): Promise<readonly ExpiredLot[]> {
    const accountId = await this.accountIdFor(userId)
    const now = this.clock.now()

    return this.prisma.$transaction(async (tx) => {
      const account = await this.lock(tx, accountId)
      const due = await tx.$queryRaw<readonly LotRow[]>`
        SELECT "id", "remainingAmount"
          FROM "PointTransaction"
         WHERE "accountId" = ${account.id}::uuid
           AND "remainingAmount" > 0
           AND "expiresAt" <= ${now}
         ORDER BY "expiresAt" ASC, "seq" ASC
      `
      const closed: ExpiredLot[] = []
      let balance = account.balance

      for (const lot of due) {
        const after = nextBalance(balance, -lot.remainingAmount)

        // 통을 다 더하면 잔액을 넘는 계정. 여기서 멈추는 것이 옳다 — 남은 통을
        // 마저 닫으면 `PointAccount_balance_check` 가 트랜잭션 전체를 되돌려
        // **이미 옳게 만료된 것까지** 없던 일이 된다.
        if (after === null) break

        await this.record(tx, account.id, {
          draft: {
            type: 'EXPIRE',
            amount: -lot.remainingAmount,
            refType: 'POINT_TRANSACTION',
            refId: lot.id,
            reason: null,
          },
          balanceAfter: after,
          lot: null,
          now,
        })
        await this.drawLot(tx, lot.id, 0)

        closed.push({ userId, lotId: lot.id, amount: lot.remainingAmount })
        balance = after
      }

      return closed
    })
  }

  /**
   * 환불이 되돌리는 적립금 (TASK-0078 F1 · F2).
   *
   * **이미 열린 트랜잭션 안에서 돈다.** 환불은 현금·쿠폰·적립금이 함께 움직이는 한
   * 사건이고, 그중 하나만 따로 커밋되면 되돌릴 수 없는 어긋남이 남는다 —
   * `PaymentService.refundWithin` 이 같은 이유로 같은 모양이다.
   *
   * **되돌아온 적립금은 새 통이다.** 원래 어느 통에서 얼마씩 빠졌는지는 기록되지
   * 않으므로(사용 행은 통을 가리키지 않는다) 그 통들의 남은 기간을 되살릴 방법이
   * 없고, 정책의 유효기간을 그날부터 다시 주는 것이 할 수 있는 유일하게 정직한
   * 일이다. 그래서 이 행에는 `earnRateBp` 이 없다 — 적립된 것이 아니라 **돌아온
   * 것**이다.
   *
   * 0원이면 아무것도 쓰지 않는다. 0원짜리 사건은 사건이 아니고, 원장에 그런 행을
   * 남기면 「왜 줄지도 늘지도 않은 줄이 있나」를 읽는 사람이 묻게 된다.
   */
  async restoreWithin(
    tx: Tx,
    input: { readonly userId: string; readonly amount: number; readonly refId: string },
  ): Promise<PointLedgerEntry | null> {
    if (input.amount <= 0) return null

    const policy = await this.policy()
    const accountId = await this.accountIdFor(input.userId)
    const now = this.clock.now()
    const account = await this.lock(tx, accountId)

    return this.record(tx, account.id, {
      draft: {
        type: 'RESTORE',
        amount: input.amount,
        refType: 'CLAIM_REQUEST',
        refId: input.refId,
        reason: null,
      },
      balanceAfter: account.balance + input.amount,
      lot: {
        expiresAt: expiryFrom(now, policy.validityDays),
        remainingAmount: input.amount,
        earnRateBp: null,
      },
      now,
    })
  }

  /**
   * 구매확정 후 반품에서 지급된 적립금을 되가져온다 (TASK-0078 F5 · F6).
   *
   * **음수 잔액을 만들지 않는다.** 이미 써 버린 적립금은 되가져올 수 없고, 잔액을
   * 마이너스로 두면 그 사람은 다음에 적립받는 만큼을 잃는데 그 사실을 아무 화면도
   * 설명하지 못한다. 못 가져온 몫은 이유에 적혀 남고, 그것이 관리자가 볼 자리다.
   *
   * `ADJUST` 인 이유는 이것이 사용도 만료도 아니기 때문이다 — 양방향인 유일한
   * 종류이고, 그래서 이유를 말해야 하는 유일한 종류다.
   *
   * 나가는 움직임이므로 **통도 함께 비운다.** 잔액만 줄이면 남은 통들의 합이 잔액을
   * 넘고(P5), 그 어긋남은 다음 사용에서 「쓸 수 있다는데 잔액이 모자란다」로 나타난다.
   */
  async clawbackWithin(
    tx: Tx,
    input: {
      readonly userId: string
      readonly amount: number
      readonly refId: string
      readonly reason: string
    },
  ): Promise<{ readonly taken: number; readonly shortfall: number }> {
    if (input.amount <= 0) return { taken: 0, shortfall: 0 }

    const accountId = await this.accountIdFor(input.userId)
    const now = this.clock.now()
    const account = await this.lock(tx, accountId)
    const taken = Math.min(input.amount, account.balance)
    const shortfall = input.amount - taken

    if (taken === 0) return { taken: 0, shortfall }

    const plan = planConsumption(await this.liveLots(tx, account.id, now), taken)

    // 잔액은 있는데 살아 있는 통이 모자라다 — 원장이 이미 어긋나 있다는 뜻이다(P5).
    // 가져갈 수 있는 만큼만 가져가고 나머지를 못 가져온 몫으로 넘긴다.
    if (plan.outcome === 'refused') return { taken: 0, shortfall: input.amount }

    await this.record(tx, account.id, {
      draft: {
        type: 'ADJUST',
        amount: -taken,
        refType: 'CLAIM_REQUEST',
        refId: input.refId,
        reason:
          shortfall === 0
            ? input.reason
            : `${input.reason} (잔액 부족으로 ${String(shortfall)}원 회수하지 못함)`,
      },
      balanceAfter: account.balance - taken,
      lot: null,
      now,
    })

    for (const draw of plan.draws) await this.drawLot(tx, draw.lotId, draw.remainingAfter)

    return { taken, shortfall }
  }

  /**
   * 관리자가 손으로 움직이는 적립금 (TASK-0093 F5).
   *
   * ## 왜 여기 있는가
   *
   * 관리자 서비스가 원장을 직접 쓰면 잔액과 통(lot)의 관계를 그쪽에서 다시 구현하게
   * 되고, 두 구현은 어긋난다 — 그 어긋남은 다음 사용에서 「쓸 수 있다는데 잔액이
   * 모자란다」로 나타난다 (P5). 원장을 아는 곳은 이 파일 하나여야 한다.
   *
   * ## 지급과 차감이 한 문이다
   *
   * 사람이 하는 조정에서 「더하기」와 「빼기」는 같은 판단의 두 방향이고, 문을 둘로
   * 나누면 화면이 부호를 보고 어느 쪽을 부를지 정하게 된다 — 그 분기가 틀리면 더하려던
   * 것이 빠진다.
   *
   * **지급에는 유효기간이 없다.** 통을 만들지 않는다는 뜻이고, 그래서 이 적립금은
   * 만료 배치가 건드리지 않는다 — 관리자가 사과의 뜻으로 준 것이 한 달 뒤에 조용히
   * 사라지면 그것은 사과를 무르는 일이다. 대신 쓸 때는 통 없는 잔액이 먼저 쓰이지
   * 않으므로(`planConsumption` 은 통만 본다) **통의 합과 잔액이 갈린다** — 그
   * 어긋남은 이미 `balanceOf` 가 두 값을 함께 답해 드러내고 있다.
   *
   * ## 차감은 잔액까지만 간다
   *
   * 음수 잔액을 만들지 않는다. 이미 써 버린 적립금은 되가져올 수 없고, 마이너스로
   * 두면 그 사람은 다음에 적립받는 만큼을 잃는데 그 사실을 아무 화면도 설명하지
   * 못한다 (`clawbackWithin` 이 같은 판단을 먼저 했다). 실제로 움직인 몫을 답한다.
   */
  async adjustByAdmin(input: {
    readonly userId: string
    readonly amount: number
    readonly reason: string
  }): Promise<number> {
    if (input.amount === 0) return 0

    const accountId = await this.accountIdFor(input.userId)
    const now = this.clock.now()

    return this.prisma.$transaction(async (tx) => {
      const account = await this.lock(tx, accountId)
      const applied = input.amount > 0 ? input.amount : -Math.min(-input.amount, account.balance)

      if (applied === 0) return 0

      const balanceAfter = account.balance + applied

      if (applied < 0) {
        const plan = planConsumption(await this.liveLots(tx, account.id, now), -applied)

        // 잔액은 있는데 살아 있는 통이 모자라다 — 통 없는 조정 지급이 섞인 계정이
        // 정확히 이 상태다. 통에서 뺄 수 있는 만큼만 빼고 나머지는 잔액에서만 빠진다.
        if (plan.outcome !== 'refused') {
          for (const draw of plan.draws) await this.drawLot(tx, draw.lotId, draw.remainingAfter)
        }
      }

      await this.record(tx, account.id, {
        draft: {
          type: 'ADJUST',
          amount: applied,
          // 주문도 클레임도 가리키지 않는다. 사람의 판단이 유일한 근거이고, 그래서
          // 이유 칸이 비면 나중에 아무도 이 줄을 설명할 수 없다.
          refType: null,
          refId: null,
          reason: input.reason,
        },
        balanceAfter,
        lot: null,
        now,
      })

      return applied
    })
  }

  // ------------------------------------------------------------------ 읽기

  /** 이 사람의 잔액과, 원장이 말하는 잔액. 둘 다 나가는 이유는 계약에 적었다. */
  async balanceOf(userId: string): Promise<PointBalance> {
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly balance: number
        readonly ledgerBalance: number
        readonly lotBalance: number
        readonly entryCount: number
        readonly nextExpiresAt: Date | null
      }[]
    >`
      SELECT a."balance",
             COALESCE(l."sum", 0)::int      AS "ledgerBalance",
             COALESCE(l."remaining", 0)::int AS "lotBalance",
             COALESCE(l."entries", 0)::int  AS "entryCount",
             l."nextExpiresAt"
        FROM "PointAccount" a
        LEFT JOIN LATERAL (
          SELECT count(*)::int                      AS "entries",
                 COALESCE(sum(t."amount"), 0)::int  AS "sum",
                 COALESCE(sum(t."remainingAmount") FILTER (WHERE t."remainingAmount" > 0), 0)::int
                   AS "remaining",
                 min(t."expiresAt") FILTER (WHERE t."remainingAmount" > 0) AS "nextExpiresAt"
            FROM "PointTransaction" t
           WHERE t."accountId" = a."id"
        ) l ON TRUE
       WHERE a."userId" = ${userId}::uuid
    `
    const row = rows[0]

    // 계좌가 아직 없는 것은 오류가 아니다 — 한 번도 적립받지 않은 사람이고, 그
    // 사람의 잔액은 0이다. 없는 계좌를 조회만으로 만들면 「계좌가 있다」가 아무
    // 뜻도 없는 사실이 된다.
    if (row === undefined) {
      return { balance: 0, ledgerBalance: 0, lotBalance: 0, entryCount: 0, nextExpiresAt: null }
    }

    return {
      balance: row.balance,
      ledgerBalance: row.ledgerBalance,
      lotBalance: row.lotBalance,
      entryCount: row.entryCount,
      nextExpiresAt: row.nextExpiresAt?.toISOString() ?? null,
    }
  }

  /**
   * 한 사람의 원장, 최신순.
   *
   * 커서가 `seq` 인 이유는 재고 원장과 같다 — 새 사건은 언제나 **더 큰** 번호를
   * 가지므로, 읽는 사람이 이미 지나온 쪽에 얹히지 지금 읽는 쪽 한가운데로 끼어들지
   * 않는다.
   */
  async ledger(
    userId: string,
    query: { readonly limit?: number; readonly cursor?: number } = {},
  ): Promise<PointLedgerResponse> {
    const account = await this.balanceOf(userId)
    const limit = query.limit ?? POINT_LEDGER_DEFAULT_LIMIT
    const rows = await this.prisma.pointTransaction.findMany({
      where: {
        account: { userId },
        ...(query.cursor === undefined ? {} : { seq: { lt: query.cursor } }),
      },
      orderBy: { seq: 'desc' },
      // 물어본 것보다 하나 더. 「다음 쪽이 있나」에 두 번째 질의도 전체 개수도
      // 필요 없어진다.
      take: limit + 1,
    })
    const page = rows.slice(0, limit)

    return {
      account,
      entries: page.map((row) => toEntry(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
    }
  }

  /**
   * 원장이 잔액을 설명하지 못하는 계정 전부 — `StockService.reconcile` 의 적립금판.
   *
   * 다섯 진술을 한 번의 질의로 잰다. 창 함수가 각 계정의 이력을 `seq` 순서로 걸으며
   * `balanceAfter` 가 직전 값 + 자기 금액이 아닌 행을 세므로, 답이 **어느 규칙이
   * 깨졌는지**를 말한다 — 숫자가 어긋났다고만 말하는 대사는 잃어버린 갱신과 지워진
   * 행을 구분하지 못한다.
   *
   * 스크립트가 아니라 메서드인 것도 저쪽과 같은 이유다. `scripts/*.mjs` 사본은 아무
   * 검사도 돌리지 않는 두 번째 구현이 되고, 아무도 안 돌리는 쪽이 프로덕션에 남는다.
   */
  async reconcile(): Promise<readonly PointDiscrepancy[]> {
    const audits = await this.prisma.$queryRaw<
      readonly (PointLedgerAudit & { readonly userId: string })[]
    >`
      SELECT a."userId",
             a."balance",
             COALESCE(l."entries", 0)          AS "entries",
             COALESCE(l."sum", 0)              AS "sum",
             COALESCE(l."lastBalanceAfter", 0) AS "lastBalanceAfter",
             COALESCE(l."maxSeq", 0)           AS "maxSeq",
             COALESCE(l."chainBreaks", 0)      AS "chainBreaks",
             COALESCE(l."lotRemaining", 0)     AS "lotRemaining"
        FROM "PointAccount" a
        LEFT JOIN LATERAL (
          SELECT count(*)::int                                       AS "entries",
                 COALESCE(sum(e."amount"), 0)::int                   AS "sum",
                 max(e."seq")::int                                   AS "maxSeq",
                 COALESCE(max(e."balanceAfter")
                          FILTER (WHERE e."seq" = e."lastSeq"), 0)::int AS "lastBalanceAfter",
                 count(*) FILTER (WHERE e."balanceAfter" <> e."expected")::int AS "chainBreaks",
                 COALESCE(sum(e."remainingAmount"), 0)::int          AS "lotRemaining"
            FROM (
              SELECT t."seq",
                     t."amount",
                     t."balanceAfter",
                     COALESCE(t."remainingAmount", 0) AS "remainingAmount",
                     COALESCE(lag(t."balanceAfter") OVER (ORDER BY t."seq"), 0) + t."amount"
                       AS "expected",
                     max(t."seq") OVER () AS "lastSeq"
                FROM "PointTransaction" t
               WHERE t."accountId" = a."id"
            ) e
        ) l ON TRUE
    `

    return audits
      .map((audit) => ({
        userId: audit.userId,
        balance: audit.balance,
        ledgerBalance: audit.sum,
        lotBalance: audit.lotRemaining,
        faults: reconciliationFaults(audit),
      }))
      .filter((row) => row.faults.length > 0)
  }

  // -------------------------------------------------------------- 내부

  /**
   * 이 사람의 계좌 id. 없으면 만든다.
   *
   * **원장 트랜잭션 바깥이다.** Postgres 는 실패한 문장 하나가 트랜잭션 전체를
   * 중단시키므로, 유니크 위반을 안에서 잡아 다시 읽으면 그 읽기가 「current
   * transaction is aborted」로 거절된다 — `OrderService.place` 가 주문서 열쇠에서
   * 같은 함정을 적어 두었다. 여기 도달한 시점에 진 쪽의 삽입은 이미 되돌아갔고,
   * 이긴 쪽은 커밋을 마쳤다(유니크 위반은 상대의 커밋을 **기다렸다가** 난다). 그래서
   * 이 재조회는 반드시 이긴 행을 본다.
   */
  private async accountIdFor(userId: string): Promise<string> {
    const existing = await this.prisma.pointAccount.findUnique({
      where: { userId },
      select: { id: true },
    })

    if (existing !== null) return existing.id

    try {
      const created = await this.prisma.pointAccount.create({
        data: { userId },
        select: { id: true },
      })

      return created.id
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error

      const winner = await this.prisma.pointAccount.findUnique({
        where: { userId },
        select: { id: true },
      })

      if (winner === null) throw error

      return winner.id
    }
  }

  /**
   * 계좌 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다. 다른 표를 함께 읽으면
   * 부질의가 문장 시작 시점의 스냅샷을 들고 와, 기다린 보람 없이 낡은 상태로
   * 판단하게 된다 (`VirtualCardService.lock` · `SellerOrderService.lock` 과 같다).
   */
  private async lock(tx: Tx, accountId: string): Promise<LockedAccount> {
    const rows = await tx.$queryRaw<readonly LockedAccount[]>`
      SELECT "id", "balance" FROM "PointAccount" WHERE "id" = ${accountId}::uuid FOR UPDATE
    `
    const row = rows[0]

    if (row === undefined) throw new Error(`적립금 계좌를 찾지 못했습니다: ${accountId}`)

    return row
  }

  /** 아직 살아 있는 통들, **먼저 사라질 것부터.** 순서가 곧 소진 정책이다. */
  private liveLots(tx: Tx, accountId: string, now: Date): Promise<readonly LotRow[]> {
    return tx.$queryRaw<readonly LotRow[]>`
      SELECT "id", "remainingAmount"
        FROM "PointTransaction"
       WHERE "accountId" = ${accountId}::uuid
         AND "remainingAmount" > 0
         AND "expiresAt" > ${now}
       ORDER BY "expiresAt" ASC, "seq" ASC
    `
  }

  /** 통에서 빼고 **남는 값을 대입한다.** 빼기가 아닌 이유는 잔액과 같다. */
  private async drawLot(tx: Tx, lotId: string, remainingAfter: number): Promise<void> {
    await tx.$executeRaw`
      UPDATE "PointTransaction" SET "remainingAmount" = ${remainingAfter}
       WHERE "id" = ${lotId}::uuid
    `
  }

  /**
   * 원장에 한 줄을 적고 잔액을 그 결과로 **대입한다.**
   *
   * `seq` 는 잠금 아래에서 새 스냅샷으로 읽는다 — 잠그는 문장에서 함께 물으면 최신
   * 잔액 옆에 낡은 자리가 온다(위의 클래스 주석).
   */
  private async record(
    tx: Tx,
    accountId: string,
    entry: {
      readonly draft: PointMovementDraft
      readonly balanceAfter: number
      readonly lot: {
        readonly expiresAt: Date
        readonly remainingAmount: number
        /** 적립의 사실이다 — 되돌아온 적립금에는 그런 비율이 없다 (TASK-0078). */
        readonly earnRateBp: number | null
      } | null
      readonly now: Date
    },
  ): Promise<PointLedgerEntry> {
    const issues = movementIssues(entry.draft)

    if (issues.length > 0) throw refusal(issues)

    const rows = await tx.$queryRaw<readonly { readonly lastSeq: number }[]>`
      SELECT COALESCE(max("seq"), 0)::int AS "lastSeq"
        FROM "PointTransaction" WHERE "accountId" = ${accountId}::uuid
    `
    const lastSeq = rows[0]?.lastSeq ?? 0

    try {
      const row = await tx.pointTransaction.create({
        data: {
          accountId,
          seq: lastSeq + 1,
          type: entry.draft.type,
          amount: entry.draft.amount,
          balanceAfter: entry.balanceAfter,
          refType: entry.draft.refType,
          refId: entry.draft.refId,
          reason: entry.draft.reason,
          expiresAt: entry.lot?.expiresAt ?? null,
          remainingAmount: entry.lot?.remainingAmount ?? null,
          earnRateBp: entry.lot?.earnRateBp ?? null,
          createdAt: entry.now,
        },
      })

      await tx.$executeRaw`
        UPDATE "PointAccount"
           SET "balance" = ${entry.balanceAfter}, "updatedAt" = ${entry.now}
         WHERE "id" = ${accountId}::uuid
      `

      return toEntry(row)
    } catch (error: unknown) {
      throw duplicateOrRethrow(error)
    }
  }
}

/**
 * 어느 입력이 잘못됐는지 이름을 부르는 400.
 *
 * 금액에 대한 거절만 자기 코드를 갖는다. 나머지는 `INVALID` 인데, 화면이 그것으로
 * 무엇을 다르게 할 수 있는 것이 없기 때문이다 — 참조가 반쪽이거나 사유가 비었다는
 * 것은 부르는 쪽 코드의 잘못이지 사람이 고칠 입력이 아니다. 금액은 다르다: 사람이
 * 입력한 값이고, 그래서 그 칸 밑에 붙을 문장이 필요하다.
 */
function refusal(issues: readonly PointIssue[]): BadRequestException {
  return new BadRequestException({
    message: issues.map((issue) => ({
      field: issue.field,
      message: ISSUE_MESSAGE[issue.code],
      code: issue.field === 'amount' ? 'POINT_AMOUNT_INVALID' : 'INVALID',
    })),
  })
}

/** 잔액이 모자라다는 답. **그 순간 쓸 수 있는 금액**을 함께 싣는다. */
function insufficient(available: number): ConflictException {
  return new ConflictException(
    domainFailure(
      'POINT_INSUFFICIENT',
      `적립금이 모자라요. 지금 ${String(available)}원까지 쓸 수 있어요.`,
      { field: 'amount', params: { available } },
    ),
  )
}

/**
 * 인덱스의 거절을 답으로 바꾸거나, 그대로 던진다.
 *
 * `PointTransaction_ref_key` 가 재시도된 적립을 기록 불가능하게 만드는 그것이다 —
 * 애플리케이션이 「이미 적립했나」를 확인하는 방식이면 동시에 들어온 둘이 **둘 다
 * 없다를 읽는다.**
 */
function duplicateOrRethrow(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error

  if (error.code === UNIQUE_VIOLATION && violatedIndexOf(error) === REF_INDEX) {
    return new ConflictException(
      domainFailure('POINT_ALREADY_RECORDED', '이미 처리된 적립금 내역이에요.', {
        field: 'refId',
      }),
    )
  }

  return error
}

/** 이 예외가 유니크 위반인가. 계좌 생성이 겹쳤을 때만 묻는다. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
}

/**
 * 유니크 위반이 지목한 인덱스 이름, 드라이버 어댑터가 전하는 그대로.
 *
 * `meta.target` 은 여기서 비어 있다 — Prisma 는 스키마 언어로 선언된 인덱스에만
 * 그것을 채우는데 이 인덱스는 **부분 인덱스**라 마이그레이션에 있다. 어댑터는
 * 데이터베이스 자신의 답을 여전히 들고 있고, 그것을 읽는다. 메시지로 판별하면 로케일이나
 * 버전이 바뀌는 첫날 깨진다 (`StockService` 가 같은 길을 간다).
 */
function violatedIndexOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const index = (
    error.meta as
      { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined
  )?.driverAdapterError?.cause?.constraint?.index

  return typeof index === 'string' ? index : undefined
}

/** 저장된 행을, `@shopping/shared` 가 선언한 모양으로. */
function toEntry(row: EntryRow): PointLedgerEntry {
  return {
    seq: row.seq,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    refType: row.refType,
    refId: row.refId,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    remainingAmount: row.remainingAmount,
    earnRateBp: row.earnRateBp,
    createdAt: row.createdAt.toISOString(),
  }
}
