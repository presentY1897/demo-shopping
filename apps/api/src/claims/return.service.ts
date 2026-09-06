import { randomBytes } from 'node:crypto'

import type { HttpException } from '@nestjs/common'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  ClaimStatus,
  CreateReturnRequest,
  InspectReturnRequest,
  ReturnDetail,
  ReturnResponse,
  ReturnShipmentDirection,
} from '@shopping/shared'

import type { AccountRow, SellerRow } from '../auth/resource-ownership.js'
import { accountOwnershipSelect, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { isUniqueViolationOn } from '../common/unique-violation.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  carrierFrom,
  carrierNameOf,
  TRACKING_NUMBER_DIGITS,
  trackingNumberFrom,
} from '../shipping/shipment-rules.js'
import { claimTransitionNeedsReason } from './claim-console.js'
import { ClaimService } from './claim.service.js'
import type { ReturnCompleted, ReturnRefundEvents, ReturnRestockEvents } from './return-events.js'
import { RETURN_REFUND_EVENTS, RETURN_RESTOCK_EVENTS } from './return-events.js'
import type { ReturnStepRefusal } from './return-rules.js'
import { returnInspectionOutcome, returnStepDecision } from './return-rules.js'

type Tx = Prisma.TransactionClient

/** 「누구 것인가」를 답하는 데 필요한 열들. `ClaimService` 가 읽는 것 그대로다. */
const OWNERSHIP_SELECT = {
  sellerId: true,
  seller: { select: sellerOwnershipSelect },
  order: { select: { user: { select: accountOwnershipSelect } } },
} as const

const DETAIL_SELECT = {
  claimId: true,
  reason: true,
  feeBearer: true,
  returnShippingFee: true,
  originalShippingRefund: true,
  returnShippingDeduction: true,
  inspectedAt: true,
  inspectionPassed: true,
  inspectionNote: true,
  photos: { orderBy: { position: 'asc' }, select: { key: true } },
  shipments: {
    orderBy: { issuedAt: 'asc' },
    select: {
      direction: true,
      carrierCode: true,
      carrierName: true,
      trackingNumber: true,
      issuedAt: true,
    },
  },
} as const satisfies Prisma.ReturnDetailSelect

type DetailRow = Prisma.ReturnDetailGetPayload<{ select: typeof DETAIL_SELECT }>

/** 걸음 하나를 판정하는 데 필요한 만큼의 클레임. */
interface StepRow {
  readonly id: string
  readonly type: 'CANCEL' | 'RETURN'
  readonly status: ClaimStatus
  readonly sellerOrderId: string
  readonly owner: {
    readonly sellerId: string
    readonly seller: SellerRow
    readonly order: { readonly user: AccountRow }
  }
}

/**
 * 반품 — 수거 · 검수 (TASK-0067 · 설계서 4장).
 *
 * ## 이 서비스가 `ClaimService` 옆에 따로 있는 이유
 *
 * 상태·전이·항목·수량은 저쪽 것이고 여기서 다시 만들지 않는다. **신청도 저쪽이다** —
 * 계약이 하나가 된 뒤로 취소와 반품이 같은 문으로 태어나고, 부속은 신청서와 한
 * 트랜잭션에 쓰인다 (`ClaimService.create`). 여기 남은 것은 **신청 뒤의 걸음들**과,
 * 그 걸음이 만드는 사실들(회수 운송장 · 검수 기록)이다.
 *
 * ## 전이는 언제나 `ClaimService` 의 문을 지난다
 *
 * 상태를 직접 쓰지 않는다. 그 문이 하는 일이 상태 변경 하나가 아니기 때문이다 —
 * 이력을 쓰고, 멱등을 지키고, **거절된 반품이 잡고 있던 수량을 돌려준다**
 * (`RELEASES_QUANTITY`). 검수 불합격도 거절이므로 그 마지막 항목이 이 TASK 에서
 * 실제로 걸린다: 상태를 직접 쓰면 떨어진 반품이 그 항목을 영영 잠근다.
 *
 * 그리고 **그 문 안으로 들어간다.** `ClaimService.applyWithin` 은 부르는 쪽의
 * 트랜잭션에서 도는 문이라(`SellerOrderService.applyWithin` 과 같은 성질이고, 배송이
 * 바로 그렇게 운송장 발급과 전이를 한 트랜잭션에 담는다) 이 서비스의 걸음도 조건과
 * 전이를 **한 트랜잭션**에 담는다. 예전에는 그것을 순서로만 메웠고, 그때는
 * 「회수중인데 운송장이 없다」와 「운송장은 났는데 상태는 그대로다」가 둘 다 가능한
 * 상태였다 — 두 번째는 다시 부르면 이어졌지만, 이어 부르는 사람이 있어야 했다.
 *
 * ① **한 트랜잭션이다.** 운송장·검수 결과를 쓰고 전이하는 것이 함께 커밋되거나 함께
 *    없다. 문 앞에서 해야 하는 두 가지 — 주체를 정하는 것과 걸음의 자리를 확인하는
 *    것 — 은 그 밖이고, 왜 그런지는 `ClaimService.applyWithin` 에 적혀 있다.
 * ② **다시 불러도 안전하다.** 앞의 쓰기는 전부 멱등이고(운송장은
 *    `(claimId, direction)` 유니크, 검수는 「아직 안 한 경우에만」 갱신), 전이도
 *    멱등이다. 트랜잭션이 통째로 물러난 뒤의 재시도가 같은 결과에 닿는다.
 * ③ **후속 처리는 커밋 뒤에, 멱등 열쇠와 함께.** 환불·재입고는
 *    `changed` 가 아니라 **최종 상태**를 보고 부른다 — 재시도가 실제로 일어나면
 *    그때는 `changed` 가 거짓이기 때문이다 (`ReturnCompleted.idempotencyKey`).
 *
 * ## 회수 운송장은 배송과 표를 나눴다 — 번호는 나누지 않았다
 *
 * `ReturnShipment` 를 따로 둔 이유는 스키마 주석에 있고(요약하면 `Shipment` 는
 * `SellerOrder` 당 하나로 못 박혀 있다), 여기서는 **나누지 않은 쪽**이 중요하다:
 * 번호는 `shipment-rules.ts` 의 `trackingNumberFrom` 이 그대로 만든다. 발급한 번호가
 * 진짜 운송장과 구분되어야 한다는 성질은 물건이 가는 방향과 아무 상관이 없기
 * 때문이고, 발급기를 한 벌 더 만들면 그 성질도 한 벌 더 관리해야 한다.
 *
 * 반면 **추적 사건은 옮겨 오지 않았다.** `TrackingEventSource` 는 `CARRIER` 와
 * `SELLER` 둘인데 회수의 집화는 **구매자**에게서 일어나고, 그쪽 문장표는
 * 「판매자로부터 상품을 인수했어요」로 시작한다 — 회수에 그대로 쓰면 이력이 거짓이
 * 된다. 그래서 회수의 진행은 사건표가 아니라 **클레임 상태**(`PICKING_UP` ·
 * `INSPECTING`)가 말한다. 상태를 한 벌 더 두면 두 표가 같은 순간에 대해 서로 다른
 * 말을 하게 된다.
 */
@Injectable()
export class ReturnService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly claims: ClaimService,
    @Inject(RETURN_REFUND_EVENTS) private readonly refunds: ReturnRefundEvents,
    @Inject(RETURN_RESTOCK_EVENTS) private readonly restocks: ReturnRestockEvents,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 반품을 신청한다 (`POST /returns` · F1 · F2 · F6).
   *
   * **`ClaimService.create` 하나를 지난다.** 항목·수량·기간·잔여 판정도, 사유와
   * 사진의 판정도, 부속을 쓰는 것도 전부 저쪽이다 — 계약이 하나가 된 뒤로
   * (`createClaimRequestSchema`) 신청의 문도 하나이기 때문이다. 여기 남은 것은
   * **답의 모양** 하나다: 이 라우트는 클레임과 부속을 함께 싣는다.
   *
   * `fault` 를 `null` 로 넘기는 것이 이 함수의 유일한 번역이고, 그것이
   * `createReturnRequestSchema` 에 그 칸이 아예 없는 이유다 — 반품의 귀책은 사유에서
   * 파생되므로 요청이 주장할 자리를 두지 않는다.
   *
   * 경로가 취소인 주문에 이 라우트를 불러도 안전하다. 저쪽이 주문 상태로 경로를
   * 정한 뒤 요청이 실어 온 것과 맞춰 보고, 어긋나면 **신청서를 만들기 전에**
   * 거절한다 (`partsFor`).
   */
  async request(principal: RequestPrincipal, input: CreateReturnRequest): Promise<ReturnResponse> {
    const { claim } = await this.claims.create(principal, { ...input, fault: null })

    return this.responseOf(principal, claim.id)
  }

  /**
   * 수거를 시작한다 — **회수 운송장을 발급하고** `RETURN_APPROVED → PICKING_UP`
   * (F3).
   *
   * 발급과 전이가 **한 트랜잭션**이다. 갈라 두면 둘 중 하나가 사람에게 보이는
   * 어긋남으로 남는다 — 전이가 먼저면 「회수 중」이라고 말해 놓고 **어디로 보내야
   * 하는지 답하지 못하는** 구간이 생기고, 발급이 먼저면 전이가 거절됐을 때 아무
   * 반품에도 속하지 않은 운송장이 남는다. 함께 커밋되거나 함께 없는 편이 둘 다보다
   * 낫다.
   *
   * **문 앞에서 둘을 먼저 한다.** 주체를 정하고(`ClaimService.actorFor`), 이 반품이
   * 그 걸음의 자리에 서 있는지 확인한다. 뒤엣것을 빼도 전이표가 결국 거절하지만,
   * 그때는 이 트랜잭션이 통째로 물러나므로 **거절이 「지금 상태에서는 할 수 없는
   * 단계」가 아니라 「정의되지 않은 전이」로** 나간다 — 부르는 쪽이 읽어야 할 말은
   * 앞엣것이다.
   */
  async pickUp(principal: RequestPrincipal, claimId: string): Promise<ReturnResponse> {
    const step = await this.step(claimId)
    const actor = this.claims.actorFor(principal, step.owner, 'claim.handle')

    this.assertStep(step, 'RETURN_APPROVED', 'PICKING_UP')

    await this.reissuingOnCollision(() =>
      this.prisma.$transaction(async (tx) => {
        await this.issueShipment(tx, claimId, 'PICKUP')
        await this.claims.applyWithin(tx, claimId, 'PICKING_UP', {
          actor,
          actorId: principal.userId,
          reason: null,
        })
      }),
    )

    return this.responseOf(principal, claimId)
  }

  /**
   * 입고 검수 (F4 · F5).
   *
   * **합격일 때만 환불이다.** 그 조건은 `returnInspectionOutcome` 하나에 있고 여기서
   * 다시 쓰지 않는다 — 두 곳에 있으면 언젠가 한쪽만 고쳐지고, 그때 증상은 빨간
   * 테스트가 아니라 **물건을 돌려받지 못했는데 나간 돈**이다.
   *
   * 불합격은 **반송**이다. 물건은 판매자에게 있고 그것은 구매자의 것이므로, 검수
   * 결과를 적는 것과 같은 걸음에서 반대 방향 운송장이 난다.
   *
   * 검수 기록 · 반송장 · 전이가 **한 트랜잭션**이고, 후속(환불·재입고)만 커밋 뒤다.
   * 수거와 같은 이유이고 같은 모양이다.
   */
  async inspect(
    principal: RequestPrincipal,
    claimId: string,
    input: InspectReturnRequest,
  ): Promise<ReturnResponse> {
    const step = await this.step(claimId)
    const actor = this.claims.actorFor(principal, step.owner, 'claim.handle')
    const outcome = returnInspectionOutcome(input.passed)

    this.assertStep(step, 'INSPECTING', outcome.nextStatus)

    // **검수 불합격도 거절이다** (TASK-0070 5장). 그 판정은 여기서 다시 내리지 않고
    // 전이가 쓰는 것과 **같은 함수**에 묻는다 — 「어느 걸음이 사유를 요구하나」가 두
    // 곳에 적히면, 거절 하나에만 사유가 붙는 날이 온다.
    //
    // 붙는 자리는 `reason` 이 아니라 `note` 다. 이 요청에 `reason` 이라는 칸이
    // 없으므로, 그 이름으로 답하면 화면은 오류를 어느 입력에도 놓지 못한다.
    if (claimTransitionNeedsReason(outcome.nextStatus) && (input.note ?? '').trim() === '') {
      throw new BadRequestException(
        domainFailure('CLAIM_REASON_REQUIRED', '불합격 사유를 입력해 주세요.', { field: 'note' }),
      )
    }

    const inspectedAt = this.clock.now()

    const move = await this.reissuingOnCollision(() =>
      this.prisma.$transaction(async (tx) => {
        // **아직 검수하지 않은 경우에만** 적는다. 두 번째 호출이 시각을 덮어쓰면
        // 「언제 검수했나」가 재시도한 시각이 되고, 그 값은 환불 이벤트에도 그대로
        // 실린다.
        await tx.returnDetail.updateMany({
          where: { claimId, inspectedAt: null },
          data: {
            inspectedAt,
            inspectionPassed: input.passed,
            inspectionNote: input.note ?? null,
            updatedAt: inspectedAt,
          },
        })

        if (outcome.sendsBack) await this.issueShipment(tx, claimId, 'SEND_BACK')

        // **검수 결과와 전이 사유가 한 사실이다.** 불합격의 근거를 `ReturnDetail`
        // 에만 적으면 클레임 이력에는 사유 없는 거절이 남고, 분쟁에서 읽히는 것은
        // 그 이력이다 (`claimHistoryEntrySchema` 의 주석 — 「누가 그렇게 판단했나」).
        return this.claims.applyWithin(tx, claimId, outcome.nextStatus, {
          actor,
          actorId: principal.userId,
          reason: input.note ?? null,
        })
      }),
    )

    // **합격이 판매자 몫을 닫았으면 그 사실도 나가야 한다** (TASK-0071). 그 전이는
    // 위 트랜잭션 안에서 일어났고, 사건은 커밋된 뒤에 발행된다 — 봉투를 여기서
    // 버리면 「반품이 끝나 주문이 `RETURNED` 인데 아무도 그 사실을 못 들은」 상태가
    // 되고, **아무것도 실패하지 않는다.**
    await this.claims.publishMove(move)

    // **`changed` 가 아니라 검수 결과를 본다.** 위 트랜잭션이 커밋된 뒤 여기 닿기
    // 전에 죽은 요청을 다시 부르면 전이는 이미 끝나 있어 `changed` 가 거짓이고,
    // 그것으로 갈라 두면 환불이 영영 나가지 않으면서 아무것도 실패하지 않는다.
    // 대신 두 번 불려도 안전하도록 멱등 열쇠를 함께 싣는다
    // (`ReturnCompleted.idempotencyKey`).
    if (outcome.refunds) await this.publishCompleted(claimId, step)

    return this.responseOf(principal, claimId)
  }

  // ------------------------------------------------------------------- reads

  /**
   * 반품 하나 (`GET /returns/:claimId`).
   *
   * 클레임과 부속을 **함께** 싣는다. 따로 부르면 두 응답이 서로 다른 순간을 보게
   * 되고, 화면은 그 둘을 언제나 같이 그린다.
   */
  async get(principal: RequestPrincipal, claimId: string): Promise<ReturnResponse> {
    const step = await this.step(claimId)

    this.claims.actorFor(principal, step.owner, 'claim.read')

    return this.responseOf(principal, claimId)
  }

  // ---------------------------------------------------------------- internals

  /**
   * 회수·반송 운송장을 **부르는 쪽의 트랜잭션 안에서** 발급한다. **멱등이다.**
   *
   * 이미 그 방향의 운송장이 있으면 아무것도 하지 않는다 — `(claimId, direction)`
   * 유니크가 그 사실을 DB 에서 지키고, `skipDuplicates` 가 두 번째 호출을 조용히
   * 통과시킨다. 두 번째 요청에 오류로 답하면 물러난 걸음을 다시 부를 수 없게 된다.
   */
  private async issueShipment(
    tx: Tx,
    claimId: string,
    direction: ReturnShipmentDirection,
  ): Promise<void> {
    const carrierCode = carrierFrom(randomBytes(CARRIER_PICK_BYTES))
    const issuedAt = this.clock.now()

    await tx.returnShipment.createMany({
      data: [
        {
          claimId,
          direction,
          carrierCode,
          carrierName: carrierNameOf(carrierCode),
          trackingNumber: trackingNumberFrom(carrierCode, randomBytes(TRACKING_NUMBER_DIGITS)),
          issuedAt,
          createdAt: issuedAt,
        },
      ],
      skipDuplicates: true,
    })
  }

  /**
   * 운송장 번호가 겹치면 **걸음을 통째로 다시 밟는다.**
   *
   * 번호 충돌은 `Shipment` 와 같은 모양으로 다룬다 — 12자리 난수는 10^12 의 공간이라
   * 겹칠 일이 사실상 없지만 0은 아니고, 마지막 방어선은
   * `ReturnShipment_trackingNumber_key` 다.
   *
   * **재시도가 문장 하나가 아니라 트랜잭션 전체인 것이 요점이다.** PostgreSQL 에서
   * 제약 위반은 트랜잭션을 중단시키므로, 안에서 한 번 더 뽑아도 그 트랜잭션에서는
   * 아무것도 쓸 수 없다. 밖에서 다시 여는 것이 유일하게 동작하는 모양이고, 안의
   * 쓰기가 전부 멱등이라 두 번째 시도는 첫 번째가 남긴 것을 그대로 쓴다.
   */
  private async reissuingOnCollision<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (!isUniqueViolationOn(error, 'trackingNumber')) throw error

      return work()
    }
  }

  /**
   * 검수를 통과했다는 사실을 환불·재입고에 넘긴다 (TASK-0068 · 0069).
   *
   * **커밋 뒤다.** 트랜잭션 안에서 발행하면 롤백된 검수의 환불이 나가고, 그 돈은
   * 되돌릴 수 없다 — `SellerOrderService.publish` 가 같은 이유로 같은 자리에 있다.
   *
   * 던지지 않는 것은 **받는 쪽이 지킨다.** 두 실행기 모두 무슨 일이 있어도 값으로
   * 답하므로(`ClaimRefundService.settle` · `ClaimRestockService.restore`) 여기서 다시
   * 감쌀 것이 없다 — 감싸면 실패가 두 곳에서 다르게 다뤄진다 (`return-events.ts`).
   */
  private async publishCompleted(claimId: string, step: StepRow): Promise<void> {
    const detail = await this.prisma.returnDetail.findUniqueOrThrow({
      where: { claimId },
      select: { inspectedAt: true, originalShippingRefund: true, returnShippingDeduction: true },
    })
    const lines = await this.prisma.claimItem.findMany({
      where: { claimId },
      orderBy: { orderItemId: 'asc' },
      select: { orderItemId: true, quantity: true, orderItem: { select: { variantId: true } } },
    })

    // 검수 기록 없이 이 자리에 올 수 없다 — 바로 위에서 적었고, 그 앞에서
    // `assertStep` 이 자리를 확인했다. 그래도 갈래를 두는 것은 `inspectedAt` 이
    // 타입에서 `null` 을 허용하기 때문이고(아직 검수하지 않은 반품이 정상이다),
    // 값을 지어내는 대신 그 사실을 말한다.
    const inspectedAt = detail.inspectedAt

    if (inspectedAt === null) throw new ConflictException('검수 기록을 찾을 수 없어요.')

    const event: ReturnCompleted = {
      claimId,
      sellerOrderId: step.sellerOrderId,
      completedAt: inspectedAt,
      actor: 'SELLER',
      lines: lines.map((line) => ({
        orderItemId: line.orderItemId,
        variantId: line.orderItem.variantId,
        quantity: line.quantity,
      })),
      returnShippingDeduction: detail.returnShippingDeduction,
      originalShippingRefund: detail.originalShippingRefund,
      idempotencyKey: claimId,
    }

    await this.refunds.refund([event])
    await this.restocks.restock([event])
  }

  /** 걸음 하나를 판정하는 데 필요한 만큼의 클레임. 잠그기 전의 읽기다. */
  private async step(claimId: string): Promise<StepRow> {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        type: true,
        status: true,
        sellerOrderId: true,
        sellerOrder: { select: OWNERSHIP_SELECT },
      },
    })

    if (row === null) throw new NotFoundException('반품을 찾을 수 없어요.')

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      sellerOrderId: row.sellerOrderId,
      owner: row.sellerOrder,
    }
  }

  /**
   * 이 반품이 그 걸음의 자리에 서 있는가 (`returnStepDecision`).
   *
   * **전이표가 다시 볼 것을 미리 보는 이유**는 거절이 서로 다른 말을 하기
   * 때문이다. 전이표는 「정의되지 않은 전이」라고 답하는데, 엉뚱한 걸음을 부른
   * 사람이 들어야 할 말은 「지금 상태에서는 할 수 없는 **단계**」다 — 승인도 안 된
   * 반품에 검수를 부른 사람은 상태 머신이 아니라 **자기가 부른 라우트**를 고쳐야
   * 한다. 부속이 붙어 있는지는 더 이상 여기서 보지 않는다: 계약이 합쳐진 뒤로
   * 부속 없는 반품은 태어나지 않는다 (`ClaimService.create`).
   */
  private assertStep(step: StepRow, from: ClaimStatus, to: ClaimStatus): void {
    const decision = returnStepDecision(step.type, step.status, from, to)

    if (decision.outcome === 'refused') throw stepRefusal(decision.reason, step.status, to)
  }

  /**
   * 답으로 나갈 모양. 커밋된 사실을 다시 읽는다.
   *
   * **클레임 쪽은 `ClaimService.get` 이 만든다.** 여기서 다시 조립하지 않는 이유는
   * 한 벌 더 만들면 갈라지기 때문이다 — 이력과 항목 스냅샷의 정렬까지 저쪽이
   * 정해 두었고, 그 결정이 바뀌는 날 두 응답이 다른 모양이 된다.
   *
   * 부르는 사람을 그대로 넘긴다. 저쪽이 `claim.read` 를 한 번 더 요구하는데, 그것이
   * 낭비가 아니라 **이 자리에서 지켜야 하는 성질**이다 — 답을 만드는 조회가 권한을
   * 묻지 않으면, 언젠가 그 조회를 먼저 부르는 경로가 하나 생기는 날 남의 반품이
   * 그대로 나간다.
   */
  private async responseOf(principal: RequestPrincipal, claimId: string): Promise<ReturnResponse> {
    const detail = await this.prisma.returnDetail.findUnique({
      where: { claimId },
      select: DETAIL_SELECT,
    })

    if (detail === null) throw new NotFoundException('반품 정보를 찾을 수 없어요.')

    const { claim } = await this.claims.get(principal, claimId)

    return { claim, return: presentDetail(detail) }
  }
}

/**
 * 운송사를 고르는 데 쓰는 난수의 길이 (`ShipmentService` 와 같은 값, 같은 이유).
 *
 * 번호의 12바이트와 따로 뽑는다. 같은 바이트열에서 운송사와 번호를 함께 뽑으면
 * 「번호를 보면 운송사를 알 수 있다」가 두 가지 뜻이 된다.
 */
const CARRIER_PICK_BYTES = 4

function presentDetail(row: DetailRow): ReturnDetail {
  return {
    claimId: row.claimId,
    reason: row.reason,
    feeBearer: row.feeBearer,
    returnShippingFee: row.returnShippingFee,
    originalShippingRefund: row.originalShippingRefund,
    returnShippingDeduction: row.returnShippingDeduction,
    photoKeys: row.photos.map((photo) => photo.key),
    shipments: row.shipments.map((shipment) => ({
      direction: shipment.direction,
      carrierCode: shipment.carrierCode,
      carrierName: shipment.carrierName,
      trackingNumber: shipment.trackingNumber,
      issuedAt: shipment.issuedAt.toISOString(),
    })),
    // 검수의 두 열은 함께 있거나 함께 없다(`ReturnDetail_inspection_check`). 그래서
    // 한쪽만 보고 갈라도 되고, 그것이 이 자리에 닿을 수 없는 분기를 만들지 않는
    // 방법이다.
    inspection:
      row.inspectedAt === null || row.inspectionPassed === null
        ? null
        : {
            passed: row.inspectionPassed,
            note: row.inspectionNote,
            inspectedAt: row.inspectedAt.toISOString(),
          },
  }
}

/** 걸음 거절 둘. 상태 코드가 다르므로 `Record` 가 아니라 `switch` 다. */
function stepRefusal(reason: ReturnStepRefusal, from: ClaimStatus, to: ClaimStatus): HttpException {
  switch (reason) {
    case 'not_a_return':
      return new BadRequestException(
        domainFailure('CLAIM_TRANSITION_UNDEFINED', '반품 신청이 아니에요.', {
          field: 'claimId',
          params: { from, to },
        }),
      )
    case 'wrong_status':
      return new ConflictException(
        domainFailure('CLAIM_TRANSITION_UNDEFINED', '지금 상태에서는 할 수 없는 단계예요.', {
          field: 'to',
          params: { from, to },
        }),
      )
  }
}
