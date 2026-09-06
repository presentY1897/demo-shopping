import type { HttpException } from '@nestjs/common'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  Claim,
  ClaimAppeal,
  ClaimableItem,
  ClaimableResponse,
  ClaimFault,
  ClaimHistoryEntry,
  ClaimItem,
  ClaimListItem,
  ClaimListQuery,
  ClaimListResponse,
  ClaimResponse,
  ClaimReturnDetails,
  ClaimStatus,
  ClaimTransitionRequest,
  ClaimTransitionResponse,
  ClaimType,
  CreateClaimRequest,
  OrderItemSnapshot,
  OrderStatus,
  Permission,
} from '@shopping/shared'
import { CLAIM_LIST_DEFAULT_LIMIT, grantedScopes, RETURN_PHOTO_MAX_COUNT } from '@shopping/shared'

import { accessDenied, assertResourceAccess } from '../auth/access-denied.js'
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
import { domainFailure } from '../common/domain-failure.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { autoConfirmWindowMsOf } from '../orders/order-confirm.js'
import type { SellerOrderStatusChanged } from '../orders/seller-order-events.js'
import type { SellerOrderActor } from '../orders/seller-order-transitions.js'
import { SellerOrderService } from '../orders/seller-order.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CancelApproved, CancelRefundEvents, CancelRestockEvents } from './cancel-events.js'
import { CANCEL_REFUND_EVENTS, CANCEL_RESTOCK_EVENTS } from './cancel-events.js'
import type { CancelLine } from './cancel-rules.js'
import { cancelApprovalFor, cancelScopeOf, cancelSettledStatuses } from './cancel-rules.js'
import type { ClaimEligibility, ClaimRefusal, ClaimRequestCheck } from './claim-rules.js'
import {
  CLAIM_INITIAL,
  claimEligibility,
  claimRouteFor,
  claimTransitionDecision,
  remainingQuantity,
} from './claim-rules.js'
import { claimTransitionNeedsReason } from './claim-console.js'
import type { ReturnLine, ReturnPhotoRefusal } from './return-rules.js'
import {
  returnCostShare,
  returnFaultOf,
  returnPhotoDecision,
  returnScopeOf,
  returnSettledStatuses,
} from './return-rules.js'

/**
 * 부르는 쪽이 이미 연 트랜잭션.
 *
 * `export` 인 것은 관리자의 문이 {@link ClaimIntake.alongside} 로 이 안에 자기 쓰기를
 * 얹기 때문이다 (TASK-0071).
 */
export type Tx = Prisma.TransactionClient

/**
 * 잡고 있던 수량을 **돌려주는** 상태.
 *
 * 세는 것이 「신청한 적 있는 수량」이 아니라 **「살아 있는 클레임이 잡고 있는
 * 수량」**이기 때문이다 (`claim-rules.ts` 의 `remainingQuantity`). 검수에서 떨어진
 * 반품이 그 항목을 영영 잠그면 사람이 할 수 있는 일이 없어진다.
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 막는다.** 안 그러면 새 상태는 「돌려줄지
 * 아무도 정한 적 없는 상태」로 태어나고, 그 결정이 빠졌다는 것은 어느 검사도
 * 알려 주지 않는다 — 증상은 몇 주 뒤 「반품을 거절했는데 다시 신청이 안 되는 항목」
 * 하나다.
 */
const RELEASES_QUANTITY: Readonly<Record<ClaimStatus, boolean>> = {
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: false,
  /** 거절됐다. 이 항목은 다시 신청할 수 있어야 한다. */
  CANCEL_REJECTED: true,
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_COMPLETED: false,
  /** 검수 불합격도 거절이다. 물건은 판매자에게 있지만 이 신청은 끝났다. */
  RETURN_REJECTED: true,
  /** 환불까지 끝났다. 이 수량은 영영 이 클레임의 것이다. */
  REFUNDED: false,
}

/** 「누구 것인가」를 답하는 데 필요한 열들. 소유권 매퍼가 읽는 것 그대로다. */
const OWNERSHIP_SELECT = {
  sellerId: true,
  seller: { select: sellerOwnershipSelect },
  order: { select: { user: { select: accountOwnershipSelect } } },
} as const

const CLAIM_SELECT = {
  id: true,
  sellerOrderId: true,
  type: true,
  status: true,
  reason: true,
  fault: true,
  requestedById: true,
  createdAt: true,
  updatedAt: true,
  /**
   * 관리자 개입의 두 방향 (TASK-0071).
   *
   * **한 조회에 함께 담는다.** 세 앱이 전부 이 사실을 그려야 하는데(판매자는 자기
   * 거절이 뒤집혔다는 것을, 구매자는 자기 이의가 어디까지 갔는지를) 따로 부르면 두
   * 응답이 서로 다른 순간을 본다. 셋 다 인덱스가 있거나 기본키 조회다.
   */
  overturnsClaimId: true,
  overturnedBy: { orderBy: { id: 'asc' }, select: { id: true } },
  appeal: {
    select: {
      claimId: true,
      filedById: true,
      reason: true,
      createdAt: true,
      reviewedAt: true,
      reviewedById: true,
      outcome: true,
      reviewNote: true,
    },
  },
  items: {
    orderBy: { orderItemId: 'asc' },
    select: {
      id: true,
      orderItemId: true,
      quantity: true,
      refundAmount: true,
      orderItem: { select: { variantId: true, productSnapshot: true } },
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      actor: true,
      actorId: true,
      createdAt: true,
    },
  },
  sellerOrder: { select: { orderId: true, order: { select: { orderNumber: true } } } },
} as const satisfies Prisma.ClaimRequestSelect

/** 전이를 일으킬 때 함께 적히는 것 — 누가, 왜. */
interface ClaimCommand {
  readonly actor: SellerOrderActor
  /** 사람이 없는 전이(`SYSTEM`)는 `null` 이다. */
  readonly actorId: string | null
  readonly reason: string | null
}

/** 잠근 행에서 읽는 것. 판단에 필요한 것뿐이다. */
interface LockedClaim {
  readonly id: string
  readonly status: ClaimStatus
  /**
   * 어느 몫의 클레임인가.
   *
   * **잠근 그 행에 이미 있는 열이라 함께 읽는다.** 승인이 판매자 몫을 옮길지
   * 판단하려면 이 값이 필요한데, 나중에 따로 읽으면 다른 순간의 스냅샷을 보게 되고
   * 무엇보다 잠금이 지켜 주지 않는 읽기가 하나 늘어난다.
   */
  readonly sellerOrderId: string
}

/**
 * 한 걸음이 남긴 것.
 *
 * `changed` 만 돌려주던 자리에 봉투가 생긴 이유는 **결론이 뒤에 일을 남기기**
 * 때문이다 (TASK-0066 · 0071). 승인은 두 길로 오지만(신청과 동시에 자동, 또는
 * 판매자·관리자가 눌러서) 둘 다 {@link ClaimService.applyWithin} 하나를 지나므로,
 * 그 뒤에 나가야 하는 것도 한 자리에서 만들어진다.
 *
 * **주문 사건이 봉투의 칸으로 올라와 있다.** 취소의 결론(`CANCEL_APPROVED`)과
 * 반품의 결론(`RETURN_COMPLETED`)이 둘 다 판매자 몫을 닫을 수 있는데, 앞엣것 안에만
 * 그 칸을 두면 반품 쪽은 자기 사건을 실을 자리가 없다 — 그때 증상은 「반품이 끝났는데
 * 주문은 배송완료」이고, **아무것도 실패하지 않는다.**
 */
interface ClaimMove {
  readonly changed: boolean
  /** 취소가 승인됐으면 커밋 뒤에 나갈 것. 그 밖의 전이에는 `null` 이다. */
  readonly approved: CancelApproved | null
  /** 이 걸음이 판매자 몫을 함께 옮겼으면 그 사실. 부분이면 `null`. */
  readonly orderEvent: SellerOrderStatusChanged | null
}

/** 아무 결론도 내지 않은 걸음. 멱등으로 물러난 호출의 답이기도 하다. */
const NOTHING_MOVED: ClaimMove = { changed: false, approved: null, orderEvent: null }

/**
 * 승인된 자리 — 유형마다 하나씩.
 *
 * `Record` 인 것은 유형이 늘면 컴파일이 막아야 하기 때문이고, 값을 손으로 적는 것은
 * 「승인」이 상태 이름의 접두사 규칙이 아니라 **전이표의 화살표**이기 때문이다
 * (`CLAIM_INITIAL` 과 같은 모양).
 */
const CLAIM_APPROVED: Readonly<Record<ClaimType, ClaimStatus>> = {
  CANCEL: 'CANCEL_APPROVED',
  RETURN: 'RETURN_APPROVED',
}

/**
 * 신청과 **같은 트랜잭션에서** 승인까지 갈 것인가, 간다면 누구로.
 *
 * `cancel-rules.ts` 의 `CancelApproval` 을 그대로 쓰지 않는 이유는 그것이 **주문
 * 상태만 보고 내리는 판단**이기 때문이다 (「판매자가 이미 손을 댔는가」). 관리자의
 * 개입은 그 판단을 지나지 않는다 — 개입 자체가 결론이고, 그 결론의 주체와 근거는
 * 요청이 들고 온다.
 */
type ClaimApproval =
  /** 판매자·관리자가 눌러 줄 때까지 신청 상태로 남는다. */
  | { readonly mode: 'REVIEW' }
  | {
      readonly mode: 'APPROVE'
      readonly actor: SellerOrderActor
      /** 사람이 없는 승인(`SYSTEM`)은 `null` 이다. */
      readonly actorId: string | null
      readonly reason: string | null
    }

/**
 * 신청이 **어느 문으로** 태어나는가 (TASK-0071).
 *
 * 구매자의 문(`POST /claims` · `POST /returns`)과 관리자의 문(`POST /admin/claims`)이
 * 다른 것을 넣는다. **문을 둘로 만들지 않는 것이 요점이다** — 잡는 순서, 부속을 쓰는
 * 순서, 이력의 첫 줄은 두 문에서 같아야 하고, 복사하면 그 셋이 언젠가 갈린다.
 */
export interface ClaimIntake {
  /**
   * 이 문이 요구하는 퍼미션.
   *
   * 구매자는 `order.write` 다 — 신청은 자기 주문에 대한 행위이고, `claim.handle` 을
   * 요구하면 아무도 신청할 수 없다. 관리자는 **`claim.handle`** 이다: 관리자가 대신
   * 내는 신청은 신청이 아니라 **처리**이고, 애초에 `ADMIN_OPERATOR` 에게
   * `order.write` 가 없다 (`role-permissions.ts`).
   */
  readonly permission: Permission
  /**
   * 이 신청을 받아도 되는가.
   *
   * 구매자는 `claimEligibility`, 관리자는 `adminClaimEligibility` 다. **저 함수를
   * 고쳐 관리자 갈래를 넣지 않는 이유**는 `admin-claim-rules.ts` 머리말에 있다 —
   * 한 함수가 두 사람에게 다른 말을 하기 시작하면, 실수 하나가 「구매자가 확정 후에도
   * 스스로 반품할 수 있다」가 된다.
   */
  readonly gate: (check: ClaimRequestCheck) => ClaimEligibility
  /** 신청과 같은 트랜잭션에서 결론까지 낼 것인가. */
  readonly approval: (orderStatus: OrderStatus, type: ClaimType) => ClaimApproval
  /** 이 신청이 뒤집는 거절. 관리자 개입에만 있다. */
  readonly overturnsClaimId: string | null
  /**
   * 이 문을 지날 수 있는 주체. `null` 이면 문이 주체를 가리지 않는다.
   *
   * 관리자의 문이 `'ADMIN'` 을 요구하는 것은 **퍼미션만으로는 부족하기 때문**이다.
   * 자기 가게의 클레임을 판매자가 이 문으로 들어오면 `claim.handle:own` 이 통과하고,
   * 그때 만들어지는 것은 「판매자가 스스로 낸 개입」 — 즉 자기 거절을 자기가 뒤집은
   * 행이다. 주체는 요청이 주장하지 않고 {@link ClaimService.actorFor} 가 행에서
   * 읽으므로, 여기서 그 답을 한 번 확인하면 그 상태가 생기지 않는다.
   */
  readonly requireActor: SellerOrderActor | null
  /**
   * 신청과 **같은 트랜잭션에서** 함께 일어나야 하는 것 (TASK-0071).
   *
   * 지금 하나뿐이다 — 개입이 이의를 **인용으로 닫는 것**. 커밋 뒤로 미루면 그 틈에서
   * 죽은 요청이 「개입은 섰는데 이의는 아직 검토 대기」인 상태를 남기고, 그것을 본
   * 다음 관리자는 같은 개입을 한 번 더 만든다.
   */
  readonly alongside: ((tx: Tx, claimId: string) => Promise<void>) | null
}

/**
 * 경로가 정해진 뒤의 신청서 — **귀책과, 반품이면 그 부속**.
 *
 * 요청의 `fault` 와 `return` 은 계약이 **둘 중 하나**로 좁혀 두었지만(그쪽 주석),
 * 어느 쪽이 실렸는지와 **주문이 무엇을 열어 주는지**는 다른 질문이다. 이 타입은 그
 * 둘을 맞춰 본 뒤의 결과라, 여기까지 온 값에는 「반품인데 사유가 없는」 조합이 없다.
 */
interface ClaimParts {
  readonly fault: ClaimFault
  /** 반품이면 사유와 사진, 취소면 `null`. */
  readonly details: ClaimReturnDetails | null
}

/** 「전체인가」를 세는 질의 한 줄. 항목 하나가 주문한 수량과 확정된 취소 수량. */
interface SettledLineRow extends CancelLine {
  readonly orderItemId: string
}

/** 같은 줄을, 반품에 대해 (TASK-0071). */
interface ReturnedLineRow extends ReturnLine {
  readonly orderItemId: string
}

/** 이 클레임이 걸고 있는 줄. 환불과 재고 복원이 받을 모양 그대로다. */
interface ClaimLineRow {
  readonly orderItemId: string
  readonly variantId: string
  readonly quantity: number
}

/** 목록 한 줄이 데이터베이스에서 나오는 모양. */
interface ListRow {
  readonly id: string
  readonly sellerOrderId: string
  readonly orderNumber: string
  readonly type: ClaimType
  readonly status: ClaimStatus
  readonly fault: 'CUSTOMER' | 'SELLER'
  readonly createdAt: Date
  readonly itemCount: number
  readonly totalQuantity: number
}

/**
 * 취소 · 반품 신청과 그 상태 (TASK-0065 · 설계서 4장).
 *
 * 규칙 자체는 `claim-rules.ts` 가 갖는다. 여기 있는 것은 그 규칙을 **데이터베이스에
 * 적용하는 순서**이고, 주문의 상태 전이(`SellerOrderService`)와 같은 모양이다.
 *
 * ## 동시 신청을 무엇으로 막았나 — 조건부 갱신이다 (R1)
 *
 * TASK 문서는 「`OrderItem` 행 잠금 후 잔여 확인」이라고 적었고, 이 저장소에는 같은
 * 문제를 푼 두 가지 선례가 있다.
 *
 * | 선례 | 모양 | 왜 그 모양인가 |
 * | --- | --- | --- |
 * | `PaymentService.lock()` | `SELECT … FOR UPDATE` → 판단 → 쓰기 | 판단이 **그 행 밖**을 본다(프로바이더 응답·상태 머신). 조건을 `WHERE` 에 담을 수 없다 |
 * | `ReservationService.reserve()` | `UPDATE … WHERE "stock" - "reserved" >= $q` | 판단이 **그 행 안**에서 끝난다. 조건을 `WHERE` 에 두면 판단과 갱신이 한 문장이 된다 |
 *
 * 잔여 수량은 뒤쪽이다. 「남았는가」는 `OrderItem` 한 행의 두 컬럼(`quantity` 와
 * `claimedQuantity`)만으로 답이 나오므로, 잠그고 읽고 판단하고 쓰는 네 걸음을 한
 * 문장으로 접을 수 있다.
 *
 * ```sql
 * UPDATE "OrderItem" SET "claimedQuantity" = "claimedQuantity" + $q
 *  WHERE "id" = $id AND "quantity" - "claimedQuantity" >= $q
 * ```
 *
 * **「읽고 → 판단하고 → 쓰는」 사이가 비지 않는 것이 요점이다.** 남은 것이 1개인데
 * 두 요청이 동시에 오면 잠금이 없는 구현에서는 둘 다 「아직 남았다」를 읽고 둘 다
 * 통과한다. 조건을 `WHERE` 에 두면 PostgreSQL 이 그 행을 한 번에 하나씩만 갱신하므로
 * **뒤에 온 쪽은 0행 갱신으로 진다.** 잠금을 따로 잡을 필요도 없다 — 갱신 자신이
 * 잠금이다.
 *
 * 그 대신 `claimedQuantity` 는 **캐시**다. `ProductVariant.reserved` 와 같은 성질이고
 * (매번 `ClaimItem` 을 합산하면 항목마다 집계가 붙는다), 같은 위험을 갖는다 — 어긋날
 * 수 있다.
 *
 * ## 마지막 방어선은 DB 에 있다
 *
 * `OrderItem_claimedQuantity_check`(`0 <= claimedQuantity <= quantity`)이다. 위
 * 문장을 안 지나는 쓰기가 하나 생기는 날 — 배치, 시드, 나중의 관리자 도구 — 초과분은
 * **조용히** 넘치고, 증상은 오류가 아니라 「주문한 것보다 많이 환불된 주문」이다.
 * `Payment_canceledAmount_check` 이 같은 이유로 같은 모양이고, 돈과 수량이 걸린
 * 자리에서 방어선이 하나뿐이면 안 된다.
 *
 * ## 주체는 서버가 정한다
 *
 * 요청이 자기 주체를 주장하게 두면 구매자가 `SELLER` 를 주장해 자기 클레임을
 * 승인한다. 그래서 {@link actorFor} 가 「이 사람은 이 몫의 무엇인가」를 행에서 읽어
 * 정하고, {@link transition} 은 절대 `SYSTEM` 을 만들지 않는다.
 *
 * ## 취소의 결론은 한 자리에서 난다 (TASK-0066)
 *
 * `PAID` 의 취소는 스스로 승인되고 `PREPARING` 의 취소는 판매자를 기다린다
 * (`cancel-rules.ts`). 그 둘은 **다른 길로 들어오지만 같은 문을 지난다** —
 * {@link applyWithin} 이 `CANCEL_APPROVED` 를 보면 그 자리에서 「이 몫에 남은 것이
 * 있는가」를 세고, 없으면 `SellerOrderService.applyWithin` 으로 주문을 옮긴다.
 * 자동 승인만 따로 처리하면 「구매자가 신청한 취소에만 주문이 안 닫히는」 종류의
 * 어긋남이 생기고, 그것은 한쪽 길을 실제로 걸어 본 사람만 발견한다
 * (`SellerOrderService.publish` 가 확정에 대해 같은 이유로 같은 모양이다).
 *
 * ## 반품의 부속도 여기서 태어난다 (TASK-0067)
 *
 * `ReturnDetail` 은 반품의 부속이지 별도의 신청서가 아니다. 그래서 이 서비스가
 * **신청서와 같은 트랜잭션에서** 쓴다 — 갈라 두면 그 틈에서 죽은 요청이 「걸을 수
 * 없는 반품」을 남기고, 그 행은 수거를 부를 때까지 아무 오류도 내지 않는다.
 *
 * 이것이 `ReturnService` 를 여기로 접는다는 뜻은 아니다. 저쪽이 갖는 것은 **신청
 * 뒤의 걸음들**(수거·검수)과 그 걸음이 만드는 사실들이고, 여기 있는 것은 신청
 * 하나다. 화살표는 여전히 `Return → Claim` 한 방향이다.
 *
 * 반품에만 있는 **판단**은 하나도 여기서 정하지 않는다 — 귀책도 배송비 분배도 사진의
 * 필요도 전부 `return-rules.ts` 의 순수 함수이고, 이 서비스는 그것을 부르는 순서만
 * 갖는다 (`cancel-rules.ts` 와 같은 관계다).
 */
@Injectable()
export class ClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerOrders: SellerOrderService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CANCEL_REFUND_EVENTS) private readonly refunds: CancelRefundEvents,
    @Inject(CANCEL_RESTOCK_EVENTS) private readonly restocks: CancelRestockEvents,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 신청한다 (`POST /claims` · F1 ~ F6).
   *
   * **신청은 전이가 아니라 생성이다.** 그래서 전이표를 지나지 않고, 시작하는 자리는
   * 유형이 정한다 (`CLAIM_INITIAL`). 유형도 요청이 아니라 **주문 상태**가 정한다.
   *
   * 다섯 걸음의 순서가 규칙이다.
   *
   * ① 소유권과 주체 — 잠금을 잡기 전이다. 남의 주문에 신청하는 요청이 잠금을 기다릴
   *    이유가 없다.
   * ② **판단은 `claimEligibility` 하나가 내린다.** 거절 여섯의 순서가 곧 사람에게
   *    할 말의 순서이고(배송 중인 주문에 「수량이 모자랍니다」라고 답하지 않는다),
   *    그 순서를 여기서 다시 적으면 규칙이 두 벌이 된다.
   * ③ **부속을 볼 차례다** (TASK-0067). 경로가 정해졌으므로 요청이 실은 것이 그
   *    경로의 것인지 맞춰 보고, 반품이면 사진까지 본다. **신청서를 만들기 전이다** —
   *    뒤로 미루면 사진 때문에 거절된 신청이 이미 수량을 잡은 뒤가 된다.
   * ④ 잡는 것과 신청서를 쓰는 것과 **부속을 쓰는 것**이 한 트랜잭션이다. 앞의 둘이
   *    갈리면 「수량은 잡혔는데 신청서가 없는 항목」이 남고, 뒤의 둘이 갈리면
   *    **걸을 수 없는 반품**이 남는다 — 회수 운송장이 매달릴 `ReturnDetail` 이 없어
   *    수거에서 409 로 끝나는, 신청한 사람이 아무것도 잘못하지 않은 행이다. 둘 다
   *    아무도 신고하지 않는다.
   * ⑤ **자동 승인도 같은 트랜잭션이다** (TASK-0066). `PAID` 의 취소는 판매자가 아직
   *    아무것도 하지 않아 거절할 근거가 없으므로 규칙이 그 자리에서 승인한다. 이것을
   *    커밋 뒤로 미루면 「승인되지 않은 채 아무도 안 보는 신청」이 남는데, 그것은
   *    승인 대기와 구분되지 않아 판매자 화면에서도 티가 나지 않는다.
   *
   * **두 라우트가 이 문 하나를 지난다** (`POST /claims` · `POST /returns`). 계약이
   * 하나이므로 문도 하나여야 한다 — 반품만 만드는 두 번째 생성 경로를 두면, 부속을
   * 쓰는 순서와 잡는 순서가 두 벌이 되고 그 둘은 언젠가 갈린다.
   */
  create(principal: RequestPrincipal, input: CreateClaimRequest): Promise<ClaimResponse> {
    return this.createWith(principal, input, {
      permission: 'order.write',
      gate: claimEligibility,
      requireActor: null,
      alongside: null,
      // 취소만 스스로 승인된다. 반품은 물건이 돌아와야 하므로 판단할 것이 남아
      // 있고, 그 판단은 사람의 것이다 (TASK-0067).
      approval: (orderStatus, type) => {
        if (type !== 'CANCEL') return { mode: 'REVIEW' }

        const approval = cancelApprovalFor(orderStatus)

        // 사람이 없는 승인이다. 신청한 사람을 여기 적으면 이력이 「구매자가
        // 승인했다」로 읽히고, 그것이 전이표가 `BUYER` 를 막아 둔 바로 그 모양이다.
        return approval.mode === 'AUTO'
          ? { mode: 'APPROVE', actor: approval.actor, actorId: null, reason: null }
          : { mode: 'REVIEW' }
      },
      overturnsClaimId: null,
    })
  }

  /**
   * 위 문의 몸통. **두 문이 이것 하나를 지난다** (TASK-0071).
   *
   * 다른 것은 {@link ClaimIntake} 넷뿐이고, 같은 것은 이 함수 전부다 — 잡는 순서,
   * 부속을 쓰는 순서, 이력의 첫 줄, 커밋 뒤에 나가는 것. 관리자 경로를 위해 이
   * 순서를 복사했다면 그 사본은 언젠가 이쪽과 갈리고, 갈린 자리는 「관리자가 만든
   * 클레임만 수량을 안 잡는다」처럼 **한참 뒤에 장부로** 드러난다.
   */
  async createWith(
    principal: RequestPrincipal,
    input: CreateClaimRequest,
    intake: ClaimIntake,
  ): Promise<ClaimResponse> {
    const order = await this.sellerOrder(input.sellerOrderId)
    const actor = this.actorFor(principal, order, intake.permission)

    if (intake.requireActor !== null && actor !== intake.requireActor) {
      throw accessDenied(intake.permission, 'out_of_scope')
    }

    const now = this.clock.now()
    const deliveredAt = await this.deliveredAt(order.id)
    const lines = this.linesOf(order.items, input)

    let type: ClaimType | null = null

    for (const line of lines) {
      const decision = intake.gate({
        orderStatus: order.status,
        deliveredAt,
        now,
        windowMs: this.returnWindowMs(),
        requested: line.quantity,
        remaining: remainingQuantity(line.item.quantity, line.item.claimedQuantity),
      })

      if (decision.outcome === 'refused') throw refusal(decision.reason, decision.remaining)

      type = decision.type
    }

    // 줄이 하나도 없는 요청은 계약이 이미 막는다(`items` 는 `min(1)`). 그래서 이
    // 갈래는 컴파일러를 위한 것이고, 값을 지어내는 대신 그 사실을 말한다.
    if (type === null) throw new BadRequestException('신청할 항목이 없습니다.')

    const parts = partsFor(type, input)

    if (parts.details !== null) {
      const decision = returnPhotoDecision(
        parts.details.returnReason,
        parts.details.photoKeys,
        principal.userId,
      )

      if (decision.outcome === 'refused') throw photoRefusal(decision.reason)
    }

    // **부속과 그 금액을 한 값으로 묶는다.** 둘이 따로 있으면 아래 트랜잭션에서
    // 「사유는 있는데 금액은 없는」 조합을 컴파일러가 의심하게 되고, 그것을 달래는
    // 검사 하나가 늘어난다 — 그 검사는 닿을 수 없다.
    //
    // 금액을 트랜잭션 밖에서 읽는 것은 그것이 **신청 시점의 사실**이기 때문이다.
    // 정책이 그 사이에 바뀌더라도 이 반품이 물 값은 사람이 신청 화면에서 본 값이어야
    // 하고, 다시 읽어 최신을 쓰는 쪽이 오히려 그 성질을 깬다 (CLAUDE.md 6장).
    const attachment =
      parts.details === null
        ? null
        : {
            details: parts.details,
            share: returnCostShare(parts.details.returnReason, {
              // 반품비는 **판매자의 정책값**이고 원 배송비는 이 몫에 실제로 부과된
              // 값이다. 앞엣것에 `SellerOrder.shippingFee` 를 쓰면 무료배송 주문은
              // 변심 반품이 공짜가 되는데, 회수 운송은 무료배송 조건과 아무 상관이 없다.
              returnShippingFee: order.seller.shippingFee,
              originalShippingFee: order.shippingFee,
            }),
          }

    const initial = CLAIM_INITIAL[type]
    const created = await this.prisma.$transaction(async (tx) => {
      // **항목 id 순서로 잡는다.** 두 신청이 같은 두 항목을 반대 순서로 잡으면
      // 데드락이 되고, 그것은 부하가 있는 날에만 나타난다.
      for (const line of [...lines].sort((left, right) =>
        left.item.id < right.item.id ? -1 : 1,
      )) {
        await this.hold(tx, line.item.id, line.quantity, now)
      }

      const claim = await tx.claimRequest.create({
        data: {
          sellerOrderId: order.id,
          type,
          status: initial,
          reason: input.reason,
          fault: parts.fault,
          requestedById: principal.userId,
          // 관리자 개입이면 어느 거절을 뒤집었는지 (TASK-0071). 없으면 평범한 신청이다.
          overturnsClaimId: intake.overturnsClaimId,
          createdAt: now,
          updatedAt: now,
          items: {
            create: lines.map((line) => ({
              orderItemId: line.item.id,
              quantity: line.quantity,
              // 환불액은 이 TASK 가 계산하지 않는다 (TASK-0068). 이 0 은 「0원을
              // 돌려준다」가 아니라 「아직 계산하지 않았다」다.
              createdAt: now,
              updatedAt: now,
            })),
          },
        },
        select: { id: true },
      })

      await tx.claimStatusHistory.create({
        data: {
          claimId: claim.id,
          // 생성이라 이전 상태가 없다.
          fromStatus: null,
          toStatus: initial,
          reason: input.reason,
          actor,
          actorId: principal.userId,
          createdAt: now,
        },
      })

      // **부속은 신청서와 같은 트랜잭션이다** (TASK-0067). 갈라 두면 그 틈에서 죽은
      // 요청이 「부속 없는 반품」을 남기고, 그것은 수거를 부를 때까지 아무 오류도
      // 내지 않는다 — 여기 `if` 하나가 그 상태를 **막는 것이 아니라 생기지 않게**
      // 하는 자리다.
      if (attachment !== null) {
        await tx.returnDetail.create({
          data: {
            claimId: claim.id,
            reason: attachment.details.returnReason,
            feeBearer: attachment.share.feeBearer,
            returnShippingFee: order.seller.shippingFee,
            originalShippingRefund: attachment.share.originalShippingRefund,
            returnShippingDeduction: attachment.share.returnShippingDeduction,
            createdAt: now,
            updatedAt: now,
            photos: {
              // 순서는 사람이 고른 순서다. 증거의 순서가 바뀌면 「이 사진이 무엇을
              // 보여 주는가」를 설명하던 사유와 어긋난다.
              create: attachment.details.photoKeys.map((key, position) => ({
                key,
                position,
                createdAt: now,
              })),
            },
          },
        })
      }

      // 이의를 인용으로 닫는 것 같은, 신청과 한 사실이어야 하는 쓰기 (TASK-0071).
      if (intake.alongside !== null) await intake.alongside(tx, claim.id)

      // 결론까지 갈 것인가는 **문이 정한다.** 구매자의 문에서는 `PAID` 의 취소만
      // 스스로 승인되고(`cancelApprovalFor`), 관리자의 문에서는 개입 자체가
      // 결론이라 언제나 승인이다.
      const approval = intake.approval(order.status, type)

      if (approval.mode !== 'APPROVE') return { claimId: claim.id, move: NOTHING_MOVED }

      const move = await this.applyWithin(tx, claim.id, CLAIM_APPROVED[type], {
        actor: approval.actor,
        actorId: approval.actorId,
        reason: approval.reason,
      })

      return { claimId: claim.id, move }
    })

    await this.publishMove(created.move)

    return { claim: await this.load(created.claimId) }
  }

  /**
   * 다음 상태로 옮긴다 (`POST /claims/:id/transitions` · F7).
   *
   * `SellerOrderService.transition` 이 본보기이고 순서가 같다 — 행 잠금 → 전이 판단
   * → 주체 확인 → 상태 변경과 이력(한 트랜잭션). **멱등**까지 같다.
   *
   * 트랜잭션이 잠금부터 이력까지만을 감싸는 것도 같다. 소유권 확인은 그 앞이고, 답을
   * 만드느라 클레임 전체를 다시 읽는 것은 그 뒤다 — 앞의 것은 잠금을 오래 쥐고 있을
   * 이유가 없고, 뒤의 것은 커밋된 사실을 읽어야 한다. 환불·재고 복원도 그 뒤다
   * (TASK-0066): 롤백된 승인의 환불은 되돌릴 수 없다.
   */
  async transition(
    principal: RequestPrincipal,
    claimId: string,
    input: ClaimTransitionRequest,
  ): Promise<ClaimTransitionResponse> {
    const access = await this.access(claimId)
    const actor = this.actorFor(principal, access.sellerOrder, 'claim.handle')
    const move = await this.prisma.$transaction((tx) =>
      this.applyWithin(tx, claimId, input.to, {
        actor,
        actorId: principal.userId,
        reason: input.reason ?? null,
      }),
    )

    await this.publishMove(move)

    return { claim: await this.load(claimId), changed: move.changed }
  }

  // ------------------------------------------------------------------- reads

  /** 클레임 하나 (`GET /claims/:id`). */
  async get(principal: RequestPrincipal, claimId: string): Promise<ClaimResponse> {
    const access = await this.access(claimId)

    this.actorFor(principal, access.sellerOrder, 'claim.read')

    return { claim: await this.load(claimId) }
  }

  /**
   * 클레임 목록 (`GET /claims`).
   *
   * **보이는 범위는 퍼미션의 스코프가 정한다.** `claim.read` 를 `any` 로 가진 사람은
   * 전부, 나머지는 자기가 산 주문과 자기 가게에 들어온 몫이다 — 서비스가 역할을 다시
   * 판단하지 않는 것이 이 저장소의 규약이고(TASK-0105), 그래서 여기서 읽는 것은
   * `grantedScopes` 하나다.
   *
   * `demo` 스코프는 목록의 축이 아니다. 그것은 「데모 계정이 만든 행」을 뜻하는데,
   * 소유자 조건 없이 그것만으로 좁히면 **다른 방문자의 클레임**이 섞인다. 데모
   * 관리자에게 필요한 화면이 생기면 그때 그 축으로 라우트를 하나 더 만든다.
   *
   * 커서는 `id` 하나다 — UUIDv7 이라 그 자체로 시간순이고, `createdAt` 으로 정렬하면
   * 같은 밀리초의 두 신청에서 커서가 한 건을 건너뛴다.
   */
  async list(principal: RequestPrincipal, query: ClaimListQuery): Promise<ClaimListResponse> {
    const everything = grantedScopes(principal, 'claim.read').includes('any')
    const limit = query.limit ?? CLAIM_LIST_DEFAULT_LIMIT
    const statuses = query.status ?? null
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT c."id",
             c."sellerOrderId",
             c."type"::text AS "type",
             c."status"::text AS "status",
             c."fault"::text AS "fault",
             c."createdAt",
             o."orderNumber",
             agg."itemCount",
             agg."totalQuantity"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "ClaimItem"
           WHERE "claimId" = c."id"
        ) agg ON true
       WHERE (${everything}::boolean
              OR o."userId" = ${principal.userId}::uuid
              OR so."sellerId" = ${principal.sellerId}::uuid)
         AND (${query.sellerOrderId ?? null}::uuid IS NULL
              OR c."sellerOrderId" = ${query.sellerOrderId ?? null}::uuid)
         AND (${statuses}::text[] IS NULL OR c."status"::text = ANY (${statuses}::text[]))
         AND (${query.type ?? null}::text IS NULL OR c."type"::text = ${query.type ?? null}::text)
         AND (${query.cursor ?? null}::uuid IS NULL OR c."id" < ${query.cursor ?? null}::uuid)
       ORDER BY c."id" DESC
       LIMIT ${limit + 1}::int
    `
    const page = rows.slice(0, limit)

    return {
      claims: page.map((row) => toListItem(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 「이 주문에 지금 무엇을 몇 개까지 신청할 수 있나」
   * (`GET /seller-orders/:id/claimable` · F8).
   *
   * **화면이 상태로 분기하지 않게 하려고 있다.** 「`DELIVERED` 면 반품 버튼」을
   * 화면에 적으면 그 판단이 세 앱에 흩어지고, 반품 기간처럼 배포 설정에 달린 값은
   * 화면이 **틀린 날짜를 자신 있게** 적게 된다 — `/seller-orders/:id/actions` 가
   * 전이에 대해 하는 일과 같다.
   */
  async claimable(principal: RequestPrincipal, sellerOrderId: string): Promise<ClaimableResponse> {
    const order = await this.sellerOrder(sellerOrderId)

    this.actorFor(principal, order, 'claim.read')

    const now = this.clock.now()
    const windowMs = this.returnWindowMs()
    const deliveredAt = await this.deliveredAt(order.id)
    // **수량 갈래를 지나가게 하려고 1·1 을 준다.** 이 답이 말해야 하는 것은 「주문이
    // 무엇을 열어 주는가」이고, 항목별 수량은 아래 `items` 가 말한다. 앞의 넷을 여기서
    // 다시 적으면 거절의 순서가 두 벌이 되고, 언젠가 둘이 다른 말을 한다.
    const verdict = claimEligibility({
      orderStatus: order.status,
      deliveredAt,
      now,
      windowMs,
      requested: 1,
      remaining: 1,
    })

    return {
      sellerOrderId: order.id,
      type: verdict.outcome === 'allowed' ? verdict.type : null,
      refusal: verdict.outcome === 'refused' ? verdict.reason : null,
      // 반품 경로에서만 뜻이 있다. 취소는 물건이 아직 떠나지 않아 기다릴 것이 없다.
      returnWindowEndsAt:
        claimRouteFor(order.status) === 'RETURN' && deliveredAt !== null
          ? new Date(deliveredAt.getTime() + windowMs).toISOString()
          : null,
      items: order.items.map((item) => toClaimableItem(item)),
    }
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이 항목의 남은 수량에서 `quantity` 를 **잡는다.** 한 문장이다 (R1).
   *
   * 0행이면 진 것이다 — 그 사이에 남이 먼저 잡았고, 지금 남은 것으로는 모자란다.
   * 그때 다시 읽어 **지금의 잔여**를 함께 답한다: 이 갈래에 오는 사람은 대개 다른
   * 창에서 방금 하나를 신청한 사람이고, 「신청할 수 없습니다」로 끝나는 화면은
   * 그에게 아무것도 알려 주지 않는다.
   *
   * 다시 읽은 값이 낡지 않는 이유는 잠금의 성질이다. 조건부 `UPDATE` 는 앞사람이
   * 커밋할 때까지 **기다렸다가** 조건을 다시 본다. 그래서 여기 도달했다는 것은
   * 앞사람이 이미 커밋했다는 뜻이고, 뒤이은 `SELECT` 는 그 값을 본다.
   */
  private async hold(tx: Tx, orderItemId: string, quantity: number, now: Date): Promise<void> {
    const taken = await tx.$executeRaw`
      UPDATE "OrderItem"
         SET "claimedQuantity" = "claimedQuantity" + ${quantity}, "updatedAt" = ${now}
       WHERE "id" = ${orderItemId}::uuid
         AND "quantity" - "claimedQuantity" >= ${quantity}
    `

    if (taken > 0) return

    const fresh = await tx.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: { quantity: true, claimedQuantity: true },
    })

    throw refusal('exceeds_remaining', remainingQuantity(fresh.quantity, fresh.claimedQuantity))
  }

  /** 이 클레임이 잡고 있던 수량을 **돌려준다.** 잡을 때와 같은 순서로 건드린다. */
  private async release(tx: Tx, claimId: string, now: Date): Promise<void> {
    const items = await tx.claimItem.findMany({
      where: { claimId },
      orderBy: { orderItemId: 'asc' },
      select: { orderItemId: true, quantity: true },
    })

    for (const item of items) {
      await tx.$executeRaw`
        UPDATE "OrderItem"
           SET "claimedQuantity" = "claimedQuantity" - ${item.quantity}, "updatedAt" = ${now}
         WHERE "id" = ${item.orderItemId}::uuid
      `
    }
  }

  /**
   * 잠금 아래에서 한 걸음 옮긴다. **옮겼으면 `changed: true`.**
   *
   * **멱등이다.** 이미 목표 상태면 아무것도 하지 않고 `changed: false` 를 돌려준다 —
   * 이력도 늘지 않고 뒤따르는 일도 없다. 「정의되지 않은 전이」로 거절하면 재시도한
   * 화면이 오류를 보는데, 그 사람이 원한 결과는 이미 이뤄져 있다. 그리고 그 멱등이
   * **환불이 두 번 나가지 않는 첫 번째 이유**다 — 두 번째 승인 요청은 여기서 멈춰
   * 아무것도 발행하지 않는다 (`idempotencyKey` 가 두 번째 이유다).
   *
   * **승인이면 그 자리에서 결론까지 낸다** (TASK-0066). 자동 승인과 판매자 승인이
   * 이 문 하나를 지나므로, 「전체인가」를 세는 곳도 판매자 몫을 옮기는 곳도 하나다.
   *
   * ## 왜 `public` 이어도 안전한가
   *
   * `SellerOrderService.applyWithin` 과 **같은 이유이고, 같은 조건이다.** 이것이
   * 트랜잭션을 열지 않고 남의 것을 받는 이유는 부르는 쪽이 **이미 트랜잭션 안**이기
   * 때문이다 — 반품의 수거는 회수 운송장을 먼저 쓰고 전이를 부르는데
   * (`ReturnService.pickUp`), 여기서 트랜잭션을 새로 열면 그 둘이 다른 트랜잭션이
   * 되어 「회수중인데 운송장이 없다」가 사람이 보는 상태로 남는다. `markPaid` 와
   * 예약 만료 스케줄러가 주문 쪽 문에 대해 갖는 문제와 같은 모양이다.
   *
   * **주체를 인자로 받는 것이 여기서 위험하지 않은 이유**는 이 문이 주체를 **믿지
   * 않기** 때문이다. 전이표(`claimTransitionDecision`)가 그 주체로 이 화살표를 지날
   * 수 있는지 다시 판정하므로, 부르는 쪽이 `SELLER` 를 지어내도 「신청자가 자기
   * 클레임을 승인하는」 화살표는 여전히 없다.
   *
   * 그래도 부르는 쪽이 **먼저 해야 하는 일이 둘** 있고, 그것을 여기서 대신 해 주지
   * 않는다.
   *
   * ① **소유권과 주체를 {@link actorFor} 로 정한다.** 요청이 주장한 주체를 그대로
   *    넘기면 구매자가 `SELLER` 를 주장하고, 그때 막는 것은 전이표뿐이라 「관리자만
   *    할 수 있는 일」과 「판매자도 할 수 있는 일」의 차이가 사라진다.
   * ② **자기 걸음의 자리를 미리 확인한다** (`returnStepDecision`). 이 문이 나중에
   *    거절해도 그 앞에서 쓴 운송장과 검수 기록은 남기 때문이다 — 그것이 이 문을
   *    여는 대신 순서로 메우던 시절의 틈이었다.
   *
   * `SYSTEM` 을 여기서 만들지 않는 것도 그대로다. {@link transition} 은 절대
   * `SYSTEM` 을 만들지 않고, 만드는 것은 규칙이 정한 자동 승인 하나다
   * (`cancelApprovalFor`).
   */
  async applyWithin(
    tx: Tx,
    claimId: string,
    to: ClaimStatus,
    command: ClaimCommand,
  ): Promise<ClaimMove> {
    const locked = await this.lock(tx, claimId)

    if (locked.status === to) return NOTHING_MOVED

    const decision = claimTransitionDecision(locked.status, to, command.actor)

    if (decision.outcome === 'refused') {
      throw transitionRefusal(decision.reason, locked.status, to)
    }

    // **거절에는 사유가 있어야 한다** (TASK-0070 5장). 전이 판정 **뒤**에 보는 것이
    // 순서다 — 있지도 않은 화살표에 「사유를 입력해 주세요」라고 답하면 사람은 사유를
    // 적어 다시 시도하고, 또 거절당한다 (`claimEligibility` 가 같은 이유로 같은
    // 순서를 갖는다).
    //
    // 여기가 유일한 자리인 것이 요점이다. 승인·거절·수거·검수가 전부 이 문을
    // 지나므로(`ReturnService` 도 그렇다) 화면을 우회한 요청도 같은 판정을 받는다.
    if (claimTransitionNeedsReason(to) && !hasText(command.reason)) throw reasonRequired()

    const now = this.clock.now()

    await tx.claimRequest.update({ where: { id: claimId }, data: { status: to, updatedAt: now } })
    await tx.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: locked.status,
        toStatus: to,
        reason: command.reason,
        actor: command.actor,
        // 사람이 없는 전이는 사람을 지어내지 않는다. 비어 있는 편이 사실이다.
        actorId: command.actor === 'SYSTEM' ? null : command.actorId,
        createdAt: now,
      },
    })

    if (RELEASES_QUANTITY[to]) await this.release(tx, claimId, now)

    // **결론은 둘이고, 둘 다 판매자 몫을 닫을 수 있다.** 취소는 승인이 곧 결론이고
    // (물건이 아직 떠나지 않았다), 반품은 검수를 통과해야 결론이다 —
    // `RETURN_APPROVED` 에서 닫으면 승인만 받고 물건을 안 보낸 반품이 주문을 끝낸다.
    if (to === 'CANCEL_APPROVED') return this.settleCancel(tx, locked, command, now)
    if (to === 'RETURN_COMPLETED') return this.settleReturn(tx, locked, command)

    return { changed: true, approved: null, orderEvent: null }
  }

  /**
   * 승인된 취소의 **결론** — 이 몫이 끝났는가 (TASK-0066 F1 · F2 · F7).
   *
   * ## 잠그는 순서가 규칙이다
   *
   * 판매자 몫의 행을 **세기 전에** 잠근다. 같은 몫에 두 부분 취소가 동시에 승인되면
   * 잠금 없이는 둘 다 상대의 수량을 못 보고(각자의 스냅샷에서 상대는 아직 커밋 전이다)
   * 둘 다 「아직 남았다」로 판단한다 — 마지막 한 개가 취소됐는데 주문은 **아무도
   * 옮기지 않은 채** 준비중으로 남고, 그 상태에서 실패하는 것은 아무것도 없다.
   * 먼저 잠그면 뒤에 온 쪽이 앞사람의 커밋을 보고 세게 되고, 그때 답이 `FULL` 로
   * 바뀐다.
   *
   * 같은 잠금이 R1(취소 처리 중 판매자가 동시에 발송) 도 막는다. 발송은
   * `SellerOrderService` 가 같은 행을 잠그고 지나므로 둘은 줄을 서고, 발송이
   * 먼저였다면 아래 `applyWithin` 이 `SHIPPED → CANCELED` 를 정의되지 않은 전이로
   * 거절한다 — 떠난 물건을 취소로 닫지 않는 것이 옳다.
   *
   * ## 부분 취소는 아무것도 옮기지 않는다
   *
   * 남은 항목은 계속 배송된다. `SellerOrder` 의 상태는 **남은 것 기준**이고
   * (설계서 1장 마지막 줄), 취소된 수량은 `ClaimItem` 이 들고 있다.
   */
  private async settleCancel(
    tx: Tx,
    claim: LockedClaim,
    command: ClaimCommand,
    now: Date,
  ): Promise<ClaimMove> {
    await this.lockSellerOrder(tx, claim.sellerOrderId)

    const scope = cancelScopeOf(await this.settledLines(tx, claim.sellerOrderId))
    const orderEvent =
      scope === 'FULL'
        ? await this.sellerOrders.applyWithin(tx, claim.sellerOrderId, 'CANCELED', {
            // **주체를 접지 않고 그대로 넘긴다.** 전이표가 이제 `SYSTEM` 을 열어
            // 두었으므로(TASK-0066), 자동 승인된 취소는 주문 이력에도 `SYSTEM` 으로
            // 남는다 — 접어 넣던 동안은 그 자리에 「판매자가 취소했다」는 거짓이
            // 적혔다.
            actor: command.actor,
            actorId: command.actorId,
            reason: command.reason,
          })
        : null

    return {
      changed: true,
      approved: {
        claimId: claim.id,
        sellerOrderId: claim.sellerOrderId,
        scope,
        approvedAt: now,
        actor: command.actor,
        lines: await this.claimLines(tx, claim.id),
        idempotencyKey: claim.id,
      },
      orderEvent,
    }
  }

  /**
   * 검수를 통과한 반품의 **결론** — 이 몫이 돌아왔는가 (TASK-0071).
   *
   * ## 이 함수가 없던 동안 무엇이 비어 있었나
   *
   * 전이표에 `DELIVERED → RETURNED` 가 있었지만 **그것을 지나는 코드가 하나도
   * 없었다.** 반품이 완료되고 환불까지 나가도 판매자 몫은 `DELIVERED` 로 남았고,
   * 아무것도 실패하지 않았다 — 주문 목록은 「배송완료」를 정직하게 그렸다. 두 표가
   * 다른 말을 하는 그 상태가 TASK-0071 4.0 이 확정 후 반품에 대해 거부한 바로 그
   * 모양이고, 확정 쪽만 고치면 같은 어긋남이 배송완료 쪽에 남는다.
   *
   * ## 잠그는 순서와 세는 대상은 취소와 같다
   *
   * 판매자 몫의 행을 **세기 전에** 잠근다. 같은 몫에 두 부분 반품이 동시에 완료되면
   * 잠금 없이는 둘 다 상대의 수량을 못 보고 둘 다 「아직 남았다」로 판단한다 —
   * 마지막 한 개가 돌아왔는데 주문은 아무도 옮기지 않은 채 남는다.
   *
   * 세는 것은 **확정된 반품**뿐이다 (`RETURN_SETTLED`). 승인만 받고 물건을 안 보낸
   * 반품까지 세면 판매자 몫이 `RETURNED` 로 닫히고, 거기서 돌아오는 화살표는 없다.
   *
   * ## 주체를 접지 않는다
   *
   * `CONFIRMED → RETURNED` 는 주체가 **`ADMIN` 뿐**이므로(4.0), 확정된 주문의 반품을
   * 판매자가 검수로 끝내려 하면 여기서 거절된다. 그것이 옳다 — 확정을 되돌리는 것은
   * 관리자 한 사람의 판단이고, 접어서 통과시키면 이력에 「관리자가 되돌렸다」는
   * 거짓이 남는다.
   */
  private async settleReturn(
    tx: Tx,
    claim: LockedClaim,
    command: ClaimCommand,
  ): Promise<ClaimMove> {
    await this.lockSellerOrder(tx, claim.sellerOrderId)

    const scope = returnScopeOf(await this.returnedLines(tx, claim.sellerOrderId))

    return {
      changed: true,
      // 환불과 재입고는 검수 라우트가 자기 사실(`ReturnCompleted`)로 발행한다.
      // 여기서 한 번 더 실으면 같은 환불이 두 봉투에 담긴다.
      approved: null,
      orderEvent:
        scope === 'FULL'
          ? await this.sellerOrders.applyWithin(tx, claim.sellerOrderId, 'RETURNED', {
              actor: command.actor,
              actorId: command.actorId,
              reason: command.reason,
            })
          : null,
    }
  }

  /**
   * 걸음 하나가 남긴 것을 **커밋한 뒤에** 내보낸다 (TASK-0068 · 0069 · 0071).
   *
   * **트랜잭션 안에서 부르면 롤백된 승인의 돈이 나가고 재고가 늘어난다.** 둘 다 실제
   * 구현이 붙었고(`cancel-events.ts`) 둘 다 던지지 않으므로, 한쪽이 실패해도 승인은
   * 그대로 서 있다.
   *
   * **돈이 먼저다.** 기다리는 사람이 있는 쪽이 앞이다 — 재고 복원은 원장 행 잠금을
   * 쥐고 도는 일이라 붐빌 때 늦어질 수 있고, 그 뒤에 환불이 서면 안 된다.
   * 재고가 늦는 것은 아무도 신고하지 않지만 돈이 늦는 것은 사람이 문의한다.
   *
   * **`public` 인 이유는 이 문을 밖에서도 지나기 때문**이다. 반품의 검수
   * (`ReturnService.inspect`)는 자기 트랜잭션 안에서 {@link applyWithin} 을 부르므로,
   * 그 걸음이 판매자 몫을 `RETURNED` 로 옮겼다는 사실도 저쪽이 커밋한 뒤에 나가야
   * 한다. 저쪽이 봉투를 버리면 그 사건은 아무 데도 가지 않고, **아무것도 실패하지
   * 않는다.**
   */
  async publishMove(move: ClaimMove): Promise<void> {
    // 상태가 옮겨졌다는 사실은 주문 쪽 문이 알린다. 여기서 따로 알리면 같은 사건이
    // 두 번 나가고, 받는 쪽은 그 둘을 구분할 방법이 없다.
    await this.sellerOrders.publish(move.orderEvent === null ? [] : [move.orderEvent])

    if (move.approved === null) return

    await this.refunds.refund([move.approved])
    await this.restocks.restock([move.approved])
  }

  /**
   * 클레임 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 — 다른 표를 함께
   * 읽으면 부질의가 시작할 때의 스냅샷을 들고 와 **낡은 상태로** 판단하게 된다
   * (`SellerOrderService.lock` · `PaymentService.lock` 이 같은 이유로 같은 모양이다).
   */
  private async lock(tx: Tx, claimId: string): Promise<LockedClaim> {
    const rows = await tx.$queryRaw<readonly LockedClaim[]>`
      SELECT "id", "status"::text AS "status", "sellerOrderId"
        FROM "ClaimRequest"
       WHERE "id" = ${claimId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /**
   * 판매자 몫의 행을 잠근다. **읽는 것이 없다** — 필요한 것은 잠금 자체다.
   *
   * 바로 뒤의 {@link SellerOrderService.applyWithin} 도 같은 행을 잠그고 그때는
   * 상태까지 읽는다. 그런데 그것만으로는 늦다: 「전체인가」를 세는 질의가 그
   * 잠금보다 **앞**에 있어야 하는데, 세고 나서 잠그면 세는 동안 남이 끼어든다.
   * 그래서 잠금을 앞으로 당기고, 두 번째 잠금은 같은 트랜잭션이 이미 쥔 것이라
   * 아무것도 기다리지 않는다.
   */
  private async lockSellerOrder(tx: Tx, sellerOrderId: string): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM "SellerOrder" WHERE "id" = ${sellerOrderId}::uuid FOR UPDATE`
  }

  /**
   * 이 몫의 항목마다 「주문한 수량」과 「취소가 확정된 수량」.
   *
   * **`OrderItem.claimedQuantity` 를 쓰지 않는다.** 그 캐시가 세는 것은 살아 있는
   * 신청이 **잡고 있는** 수량이라 아직 승인되지 않은 신청까지 들어 있고, 그것으로
   * 판단하면 판매자가 거절할 신청 하나가 주문을 `CANCELED` 로 닫는다 — 그리고
   * 전이표에 거기서 돌아오는 화살표가 없다. 그래서 확정된 것만 다시 센다
   * (`cancel-rules.ts` 의 `CANCEL_SETTLED`).
   *
   * `type` 으로 취소만 고르는 것은 `REFUNDED` 를 두 경로가 함께 쓰기 때문이다.
   * 환불까지 끝난 반품이 「취소된 수량」으로 세어지면 반품된 주문이 취소로 닫힌다.
   */
  private async settledLines(tx: Tx, sellerOrderId: string): Promise<readonly CancelLine[]> {
    return tx.$queryRaw<readonly SettledLineRow[]>`
      SELECT oi."id" AS "orderItemId",
             oi."quantity" AS "ordered",
             COALESCE(sum(ci."quantity") FILTER (
               WHERE c."type" = 'CANCEL'
                 AND c."status"::text = ANY (${cancelSettledStatuses}::text[])
             ), 0)::int AS "canceled"
        FROM "OrderItem" oi
        LEFT JOIN "ClaimItem" ci ON ci."orderItemId" = oi."id"
        LEFT JOIN "ClaimRequest" c ON c."id" = ci."claimId"
       WHERE oi."sellerOrderId" = ${sellerOrderId}::uuid
       GROUP BY oi."id", oi."quantity"
    `
  }

  /**
   * 같은 셈을 **반품에 대해** (TASK-0071).
   *
   * 질의를 하나로 합치지 않는 이유는 `type` 으로 갈리는 두 값이 **서로 다른 결론**을
   * 만들기 때문이다 — 취소가 전부면 `CANCELED`, 반품이 전부면 `RETURNED` 이고, 한
   * 줄에 담으면 부르는 쪽이 「어느 쪽이 전부인가」를 다시 판정하게 된다. 세는 상태도
   * 다르다: 취소는 승인부터, 반품은 **검수 통과부터**다.
   */
  private async returnedLines(tx: Tx, sellerOrderId: string): Promise<readonly ReturnLine[]> {
    return tx.$queryRaw<readonly ReturnedLineRow[]>`
      SELECT oi."id" AS "orderItemId",
             oi."quantity" AS "ordered",
             COALESCE(sum(ci."quantity") FILTER (
               WHERE c."type" = 'RETURN'
                 AND c."status"::text = ANY (${returnSettledStatuses}::text[])
             ), 0)::int AS "returned"
        FROM "OrderItem" oi
        LEFT JOIN "ClaimItem" ci ON ci."orderItemId" = oi."id"
        LEFT JOIN "ClaimRequest" c ON c."id" = ci."claimId"
       WHERE oi."sellerOrderId" = ${sellerOrderId}::uuid
       GROUP BY oi."id", oi."quantity"
    `
  }

  /** 이 클레임이 걸고 있는 줄들. 되돌릴 대상을 받는 쪽이 조회 없이 알아야 한다. */
  private async claimLines(tx: Tx, claimId: string): Promise<readonly ClaimLineRow[]> {
    return tx.$queryRaw<readonly ClaimLineRow[]>`
      SELECT ci."orderItemId", oi."variantId", ci."quantity"
        FROM "ClaimItem" ci
        JOIN "OrderItem" oi ON oi."id" = ci."orderItemId"
       WHERE ci."claimId" = ${claimId}::uuid
       ORDER BY ci."orderItemId"
    `
  }

  /**
   * 반품을 받아 주는 기간 (R2).
   *
   * **새 축을 만들지 않는다.** 자동 구매확정(TASK-0064)이 이미 그 축을 세웠고
   * (`FULFILLMENT_PACE` — `demo` 5분 / `realistic` 7일), 반품 기간은 그 값과 **같아야
   * 한다.** 다르면 둘 중 하나가 반드시 이상해진다: 반품 기간이 짧으면 확정을
   * 기다리는 동안 아무것도 못 하는 구간이 생기고, 길면 확정된 주문에 반품을 받아야
   * 하는데 그것은 `CONFIRMED` 가 이미 거절한다(F5).
   *
   * 그래서 값을 새로 정의하지 않고 저쪽 함수를 그대로 부른다. 여기 숫자가 하나
   * 적히는 순간 「데모 모드」가 두 벌이 되고, 그때 증상은 「배송은 6분인데 반품은
   * 7일」이며 아무것도 실패하지 않는다.
   */
  private returnWindowMs(): number {
    return autoConfirmWindowMsOf(this.config)
  }

  /**
   * 이 몫이 **배송완료로 선언된** 순간, 또는 그런 적이 없으면 `null`.
   *
   * **`Shipment.deliveredAt` 이 아니라 상태 이력을 읽는다** (TASK-0064 4.1).
   * `SHIPPED → DELIVERED` 는 판매자도 전이 라우트로 찍을 수 있고, 그때 배송 표는
   * 따라오지 않는다 — 그것을 기준으로 삼으면 그 주문은 **영원히 반품 기간 밖**이
   * 되고 아무것도 실패하지 않는다. 이력은 상태를 옮기는 문이 같은 트랜잭션에서
   * 쓰므로 예외 없이 있다.
   *
   * 첫 줄을 읽는 것도 같은 이유다. 반품 기간이 재는 것은 「구매자가 반품을 말할
   * 시간을 얼마나 가졌나」이고, 그 시작은 처음 도착이 선언된 순간이다.
   */
  private async deliveredAt(sellerOrderId: string): Promise<Date | null> {
    const row = await this.prisma.orderStatusHistory.findFirst({
      where: { sellerOrderId, toStatus: 'DELIVERED' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })

    return row?.createdAt ?? null
  }

  /**
   * 신청이 볼 주문 한 몫. 잠그기 전의 읽기다.
   *
   * **배송비 두 값을 여기서 함께 읽는다** (TASK-0067). 반품의 부담액을 정하는 데
   * 필요한데, 이 조회가 이미 두 행을 다 잡고 있으므로 따로 물으면 왕복만 하나
   * 늘어난다. 취소 경로에서는 읽고 쓰지 않는데, 그것이 두 번째 조회보다 싸다.
   */
  private async sellerOrder(sellerOrderId: string) {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: {
        id: true,
        status: true,
        /** 이 몫에 실제로 부과된 배송비. 판매자 귀책이면 이만큼을 돌려준다. */
        shippingFee: true,
        ...OWNERSHIP_SELECT,
        // 소유권이 읽는 열에 **정책값 하나를 얹는다.** 반품비는 `Seller.shippingFee`
        // 이고, 그 근거는 위 `create` 의 주석에 있다.
        seller: { select: { ...sellerOwnershipSelect, shippingFee: true } },
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            claimedQuantity: true,
            productSnapshot: true,
          },
        },
      },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    return row
  }

  /** 클레임의 소유권 판단에 필요한 만큼. */
  private async access(claimId: string) {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: { id: true, sellerOrder: { select: OWNERSHIP_SELECT } },
    })

    if (row === null) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /** 답으로 나갈 모양 그대로 다시 읽는다. 커밋된 사실이어야 한다. */
  private async load(claimId: string): Promise<Claim> {
    const row = await this.prisma.claimRequest.findUniqueOrThrow({
      where: { id: claimId },
      select: CLAIM_SELECT,
    })

    return {
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      orderId: row.sellerOrder.orderId,
      orderNumber: row.sellerOrder.order.orderNumber,
      type: row.type,
      status: row.status,
      reason: row.reason,
      fault: row.fault,
      requestedById: row.requestedById,
      requestedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: row.items.map((item) => toClaimItem(item)),
      history: row.statusHistory.map((entry) => toHistoryEntry(entry)),
      overturnsClaimId: row.overturnsClaimId,
      overturnedByClaimIds: row.overturnedBy.map((entry) => entry.id),
      appeal: row.appeal === null ? null : toAppeal(row.appeal),
    }
  }

  /**
   * 요청한 줄을 이 주문의 항목에 맞춘다.
   *
   * 남의 주문 항목 id 를 섞어 보내는 요청이 여기서 끝난다. 조용히 무시하면 사람이
   * 고른 것과 다른 것이 신청되고, 그것은 화면과 실제가 갈리는 가장 나쁜 모양이다
   * (`ORDER_ITEM_MISSING` 과 같은 판단).
   */
  private linesOf(
    items: readonly OrderItemRow[],
    input: CreateClaimRequest,
  ): readonly { readonly item: OrderItemRow; readonly quantity: number }[] {
    const byId = new Map(items.map((item) => [item.id, item]))

    return input.items.map((line) => {
      const item = byId.get(line.orderItemId)

      if (item === undefined) {
        throw new BadRequestException(
          domainFailure('CLAIM_ITEM_MISSING', '이 주문에 없는 항목이 있어요.', {
            field: 'items',
          }),
        )
      }

      return { item, quantity: line.quantity }
    })
  }

  /**
   * 이 요청을 보낸 사람은 이 몫의 **무엇**인가.
   *
   * `SellerOrderService.actorFor` 와 같은 순서이고, 같은 이유다 — 자기 가게에서 자기가
   * 산 경우에 두 자격을 다 갖는데, 이 몫의 주인은 판 사람이다. 클레임에서 그 순서가
   * 실제로 결과를 바꾼다: 판매자로 읽히면 승인할 수 있고 구매자로 읽히면 못 한다.
   *
   * 마지막 갈래의 `ADMIN` 은 「나머지 전부」가 아니다 — 바로 위 {@link assertResourceAccess}
   * 가 **전부에 닿는 권한**을 요구하므로, 아무것도 아닌 사람은 여기서 403 으로 끝난다.
   *
   * 퍼미션을 인자로 받는 이유는 라우트마다 요구하는 것이 다르기 때문이다 — 신청은
   * 자기 주문에 대한 행위라 `order.write`, 승인·거절은 `claim.handle`, 조회는
   * `claim.read` 다. 구매자가 `claim.handle` 을 갖지 않는 것이 「신청자가 자기
   * 클레임을 승인하지 못한다」의 **첫 번째** 방어선이고, 전이표가 두 번째다.
   *
   * **`public` 인 이유는 이 답이 하나여야 하기 때문이다.** 반품의 걸음들도 같은
   * 질문을 하는데(`ReturnService`), 사본을 두면 「이 사람은 이 반품의 무엇인가」에
   * 답이 둘이 생기고 그중 하나는 반드시 틀린다 — 갈라지는 날 증상은 오류가 아니라
   * **자기 가게에서 자기가 산 주문의 반품을 자기가 승인하는 일**이다. 읽는 것이
   * 인자로 받은 행뿐이라(데이터베이스도 시계도 보지 않는다) 밖에서 불러도 안전하다.
   */
  actorFor(
    principal: RequestPrincipal,
    row: {
      readonly sellerId: string
      readonly seller: SellerRow
      readonly order: { readonly user: AccountRow }
    },
    permission: Permission,
  ): SellerOrderActor {
    if (principal.sellerId !== null && principal.sellerId === row.sellerId) {
      assertResourceAccess(principal, permission, sellerOwnership(row.seller))

      return 'SELLER'
    }

    if (principal.userId === row.order.user.id) {
      assertResourceAccess(principal, permission, accountOwnership(row.order.user))

      return 'BUYER'
    }

    assertResourceAccess(principal, permission, sellerOwnership(row.seller))

    return 'ADMIN'
  }
}

/** 주문 항목 한 줄이, 신청 판단에 필요한 만큼. */
interface OrderItemRow {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
  readonly claimedQuantity: number
  readonly productSnapshot: unknown
}

/**
 * 주문한 때의 상품.
 *
 * 검사 없이 옮긴다 — 이 열을 쓰는 곳은 주문 생성 하나뿐이고, 그쪽이 계약의 스키마로
 * 만든 객체를 그대로 넣는다 (`OrderService` 의 같은 함수).
 */
function snapshotFrom(value: unknown): OrderItemSnapshot {
  return value as OrderItemSnapshot
}

function toClaimableItem(item: OrderItemRow): ClaimableItem {
  return {
    orderItemId: item.id,
    variantId: item.variantId,
    snapshot: snapshotFrom(item.productSnapshot),
    quantity: item.quantity,
    claimedQuantity: item.claimedQuantity,
    remainingQuantity: remainingQuantity(item.quantity, item.claimedQuantity),
  }
}

function toClaimItem(row: {
  readonly id: string
  readonly orderItemId: string
  readonly quantity: number
  readonly refundAmount: number
  readonly orderItem: { readonly variantId: string; readonly productSnapshot: unknown }
}): ClaimItem {
  return {
    id: row.id,
    orderItemId: row.orderItemId,
    variantId: row.orderItem.variantId,
    snapshot: snapshotFrom(row.orderItem.productSnapshot),
    quantity: row.quantity,
    refundAmount: row.refundAmount,
  }
}

function toHistoryEntry(row: {
  readonly id: string
  readonly fromStatus: ClaimStatus | null
  readonly toStatus: ClaimStatus
  readonly reason: string | null
  readonly actor: SellerOrderActor
  readonly actorId: string | null
  readonly createdAt: Date
}): ClaimHistoryEntry {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actor: row.actor,
    actorId: row.actorId,
    occurredAt: row.createdAt.toISOString(),
  }
}

/**
 * 이의 한 건을 계약의 모양으로 (TASK-0071).
 *
 * `filedAt` 이 `createdAt` 인 것은 이의가 **한 번 접수되고 끝나는 사실**이기
 * 때문이다 — 「낸 시각」과 「행이 생긴 시각」이 같고, 두 이름을 두면 어느 쪽이
 * 진짜인지 묻게 된다 (`Claim.requestedAt` 이 같은 이유로 같은 모양이다).
 */
function toAppeal(row: {
  readonly claimId: string
  readonly filedById: string
  readonly reason: string
  readonly createdAt: Date
  readonly reviewedAt: Date | null
  readonly reviewedById: string | null
  readonly outcome: 'UPHELD' | 'DISMISSED' | null
  readonly reviewNote: string | null
}): ClaimAppeal {
  return {
    claimId: row.claimId,
    filedById: row.filedById,
    reason: row.reason,
    filedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedById: row.reviewedById,
    outcome: row.outcome,
    reviewNote: row.reviewNote,
  }
}

function toListItem(row: ListRow): ClaimListItem {
  return {
    id: row.id,
    sellerOrderId: row.sellerOrderId,
    orderNumber: row.orderNumber,
    type: row.type,
    status: row.status,
    fault: row.fault,
    requestedAt: row.createdAt.toISOString(),
    itemCount: row.itemCount,
    totalQuantity: row.totalQuantity,
  }
}

/**
 * 신청 거절 여섯을 **서로 다른 답**으로 옮긴다.
 *
 * 하나로 묶지 않는 이유는 부르는 쪽이 할 일이 다르기 때문이다 — 배송 중이면
 * 기다리면 되고, 확정했으면 관리자를 찾아야 하며, 수량이 모자라면 **숫자를 고치면
 * 된다.** 마지막만이 화면이 「N개까지 신청할 수 있어요」로 바꿔 말할 수 있는
 * 거절이라, 그것이 `params.remaining` 을 달고 나간다.
 *
 * `Record` 가 아니라 `switch` 인 것은 상태 코드가 갈래마다 다르기 때문이다 — 표로
 * 적으면 코드·문장·필드 세 벌을 나란히 두게 되고, 그것은 표가 아니라 세 개의 표다.
 * 갈래가 하나 늘면 `ClaimRefusal` 이 완전하지 않아 컴파일이 멈춘다.
 *
 * **`export` 인 이유는 관리자의 문도 같은 거절을 내기 때문**이다 (TASK-0071).
 * 판정자만 다르고(`adminClaimEligibility`) 답의 코드·상태·필드는 같아야 한다 —
 * 사본을 두면 「관리자 경로에서만 다른 코드로 거절되는 수량 초과」가 생기고, 화면은
 * 그 둘을 다르게 다뤄야 한다.
 */
export function refusal(reason: ClaimRefusal, remaining: number): HttpException {
  switch (reason) {
    case 'in_transit':
      return new ConflictException(
        domainFailure('CLAIM_IN_TRANSIT', '배송 중에는 취소도 반품도 할 수 없어요.'),
      )
    case 'confirmed':
      return new ConflictException(
        domainFailure('CLAIM_ORDER_CONFIRMED', '구매확정한 주문은 고객센터로 문의해 주세요.'),
      )
    case 'window_closed':
      return new ConflictException(
        domainFailure('CLAIM_WINDOW_CLOSED', '반품할 수 있는 기간이 지났어요.'),
      )
    case 'not_claimable':
      return new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '지금 상태에서는 신청할 수 없어요.'),
      )
    case 'exceeds_remaining':
      return new ConflictException(
        domainFailure('CLAIM_EXCEEDS_REMAINING', '신청할 수 있는 수량을 넘었어요.', {
          field: 'items',
          params: { remaining },
        }),
      )
    case 'invalid_quantity':
      return new BadRequestException(
        domainFailure('CLAIM_INVALID_QUANTITY', '수량은 1개 이상이어야 해요.', {
          field: 'items',
        }),
      )
  }
}

/**
 * 요청이 실어 온 것과 **주문이 열어 준 경로**를 맞춘다 (TASK-0067).
 *
 * 계약은 「귀책이거나 사유이거나, 둘 중 하나」까지만 좁힌다
 * (`createClaimRequestSchema`). 어느 쪽이어야 하는지는 계약이 알 수 없다 — 그것은
 * 주문 상태의 답이고, 그 답은 여기 오기 전에 나온다.
 *
 * **어긋나면 만들지 않는다.** 반품 경로에 귀책만 실어 오면 예전에는 사유도 사진도
 * 없는 반품이 태어났고, 그 신청은 수거에서야 409 로 끝났다. 여기서 거절하면 그
 * 사람은 **신청 버튼을 누른 그 자리에서** 무엇이 빠졌는지 듣는다.
 *
 * 상태 코드가 409 인 것은 `claimEligibility` 의 거절들과 같은 이유다 — 요청의 모양이
 * 틀린 것이 아니라(그것은 계약이 400 으로 끝냈다) **지금 이 주문에 대해** 틀렸다.
 */
function partsFor(type: ClaimType, input: CreateClaimRequest): ClaimParts {
  if (type === 'RETURN') {
    if (input.return === null) {
      throw new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '이 주문은 반품만 신청할 수 있어요.', {
          field: 'return',
        }),
      )
    }

    // 귀책은 **파생**이다. 요청이 주장하게 두면 「오배송인데 구매자 귀책」이 만들어
    // 지고, 그것은 판매자가 잘못했는데 구매자가 반품비를 무는 행이다.
    return { fault: returnFaultOf(input.return.returnReason), details: input.return }
  }

  if (input.fault === null) {
    throw new ConflictException(
      domainFailure('CLAIM_NOT_CLAIMABLE', '이 주문은 취소만 신청할 수 있어요.', {
        field: 'fault',
      }),
    )
  }

  return { fault: input.fault, details: null }
}

/**
 * 사진 거절 다섯을 **서로 다른 답**으로 옮긴다 (TASK-0067 F2).
 *
 * 나누는 기준은 위 {@link refusal} 과 같다 — **사람이 할 일이 다른가.** 한 장을
 * 빼야 하는 사람과 사유를 고쳐야 하는 사람과 아무것도 할 수 없는 사람에게 같은
 * 코드로 답하면, 화면은 문장을 읽고 갈라야 한다.
 *
 * `foreign_photo` 가 **없는 사진인지 남의 사진인지 구분해 주지 않는** 것이 이
 * 목록에서 유일하게 덜 말하는 자리다. 열쇠는 그 자체로 소유자를 말하므로, 둘을 갈라
 * 답하면 남의 열쇠를 넣어 보는 것만으로 그것이 존재하는지 알 수 있다.
 */
function photoRefusal(reason: ReturnPhotoRefusal): HttpException {
  switch (reason) {
    case 'photo_required':
      return new BadRequestException(
        domainFailure(
          'RETURN_PHOTO_REQUIRED',
          '하자·오배송 반품에는 사진을 한 장 이상 첨부해 주세요.',
          { field: 'return.photoKeys' },
        ),
      )
    case 'photo_not_allowed':
      return new BadRequestException(
        domainFailure('RETURN_PHOTO_NOT_ALLOWED', '단순 변심 반품에는 사진을 첨부할 수 없어요.', {
          field: 'return.photoKeys',
        }),
      )
    case 'too_many_photos':
      return new BadRequestException(
        domainFailure('RETURN_PHOTO_TOO_MANY', '사진은 최대 {max}장까지 첨부할 수 있어요.', {
          field: 'return.photoKeys',
          params: { max: RETURN_PHOTO_MAX_COUNT },
        }),
      )
    case 'duplicate_photo':
      return new BadRequestException(
        domainFailure('RETURN_PHOTO_DUPLICATE', '같은 사진을 두 번 첨부할 수 없어요.', {
          field: 'return.photoKeys',
        }),
      )
    case 'foreign_photo':
      return new BadRequestException(
        domainFailure('RETURN_PHOTO_FOREIGN', '첨부할 수 없는 사진이에요.', {
          field: 'return.photoKeys',
        }),
      )
  }
}

/**
 * 전이 거절 둘.
 *
 * 나누는 이유는 주문 쪽과 같다 — 정의되지 않은 전이는 고쳐도 안 되고(다시 읽어야
 * 한다), 주체가 막힌 것은 **다른 사람이면 된다.** 뒤쪽이 실제로 막는 것 하나가
 * 「신청자가 자기 클레임을 승인하는 것」이다.
 */
/**
 * 사유가 **실제로 적혔는가.**
 *
 * `null` 과 빈 문자열과 공백만 있는 문자열을 한 갈래로 접는다. 계약이
 * `.trim()` 을 이미 걸었지만(`claimTransitionRequestSchema`) 이 문을 지나는 것이
 * HTTP 하나가 아니다 — 검수도 여기로 오고, 그쪽의 `note` 는 다른 스키마다.
 */
function hasText(value: string | null): boolean {
  return value !== null && value.trim() !== ''
}

/** 거절인데 사유가 없다. **400 이고 `reason` 필드에 붙는다.** */
function reasonRequired(): HttpException {
  return new BadRequestException(
    domainFailure('CLAIM_REASON_REQUIRED', '거절 사유를 입력해 주세요.', { field: 'reason' }),
  )
}

function transitionRefusal(
  reason: 'undefined_transition' | 'actor_forbidden',
  from: ClaimStatus,
  to: ClaimStatus,
): HttpException {
  const params = { from, to }

  if (reason === 'undefined_transition') {
    return new ConflictException(
      domainFailure('CLAIM_TRANSITION_UNDEFINED', '지금 상태에서는 할 수 없는 요청이에요.', {
        field: 'to',
        params,
      }),
    )
  }

  return new ForbiddenException(
    domainFailure('CLAIM_TRANSITION_FORBIDDEN', '이 클레임을 그렇게 바꿀 수 없어요.', {
      field: 'to',
      params,
    }),
  )
}
