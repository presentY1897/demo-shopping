import { randomBytes } from 'node:crypto'

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
  Coupon,
  CreateCouponRequest,
  UserCoupon as UserCouponContract,
} from '@shopping/shared'
import {
  COUPON_CODE_LENGTH,
  couponCategoryScopeIdSchema,
  couponProductScopeIdSchema,
  couponSellerScopeIdSchema,
  platformOwnership,
} from '@shopping/shared'
import type { ZodType } from 'zod'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { isUniqueViolationOn } from '../common/unique-violation.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { couponCodeFrom, normalizeCouponCode } from './coupon-code.js'
import type { CouponPolicyFault } from './coupon-rules.js'
import {
  canonicalScopeIds,
  couponPolicyFaultFields,
  issuabilityFault,
  issueExhausted,
  policyFault,
} from './coupon-rules.js'

type Tx = Prisma.TransactionClient

/** 발급 한 건이 어디로 들어왔나. 거절의 문장이 갈리는 유일한 자리다. */
type IssueDoor = 'grant' | 'claim'

/**
 * 쿠폰의 발행과 발급 (TASK-0072).
 *
 * ## 발급 수량의 동시성 — 조건부 갱신
 *
 * 잔여 1장에 열 건이 동시에 들어오면 「읽고 · 판단하고 · 쓰는」 구현은 열 명 모두
 * 「1장 남았다」를 읽고 열 명 모두 통과한다. 그래서 판단과 갱신이 **한 문장**이다.
 *
 * ```sql
 * UPDATE "Coupon" SET "issuedCount" = "issuedCount" + 1
 *  WHERE "id" = $1 AND ("issueLimit" IS NULL OR "issuedCount" < "issueLimit")
 * ```
 *
 * 행 잠금이 아니라 조건부 갱신인 것은 TASK-0065 4.1 의 기준 그대로다 —
 * **판단이 그 행 안에서 끝나는가.** 여기서 판단에 필요한 값은 `issueLimit` 과
 * `issuedCount` 둘뿐이고 둘 다 이 행에 있다. `PaymentService.lock` 이 행 잠금을
 * 쓰는 것은 저쪽 판단이 다른 표(환불 이력)를 함께 읽어야 하기 때문이다.
 * 조건을 `WHERE` 에 두면 Postgres 가 그 행을 한 번에 하나씩만 갱신하므로 **아홉은
 * 0행 갱신으로 진다.** 잠금을 따로 잡을 필요도 없다 — 갱신 자신이 잠금이다.
 *
 * **마지막 방어선은 `Coupon_issued_count_check` 다.** 위 문장이 이기는 한 CHECK 는
 * 한 번도 발동하지 않지만, 그것이 CHECK 를 빼도 되는 이유가 되지는 않는다 —
 * 언젠가 이 자리가 「읽고 판단하고 쓰는」 모양으로 고쳐 쓰이는 날, 초과 발급을
 * 거절하는 것이 하나도 남지 않게 된다 (`Payment_canceledAmount_check` 와 같은 판단).
 *
 * ## 중복 발급 — 열쇠는 `(couponId, userId)`
 *
 * 조회로 막지 않는다. 동시에 들어온 두 요청은 **서로의 조회 결과에 보이지
 * 않으므로** 둘 다 「아직 없다」를 읽는다. 막는 것은 `UserCoupon_couponId_userId_key`
 * 이고, 애플리케이션은 그 위반을 읽어 문장으로 바꿀 뿐이다.
 *
 * ## 두 문이 한 트랜잭션인 이유
 *
 * 수량을 늘린 뒤 발급 행을 넣는데, 중복이면 그 삽입이 실패한다. 한 트랜잭션이
 * 아니면 **늘어난 수량이 그대로 남아** 아무에게도 가지 않은 한 장이 소진된다.
 * Postgres 는 트랜잭션 안의 한 문장이 실패하면 전체를 중단시키므로 되돌리는
 * 코드를 따로 쓸 필요가 없다.
 */
@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ 발행

  /**
   * 쿠폰을 발행한다 (F1 · F2).
   *
   * **부담 주체는 요청이 고르지 않는다.** `sellerId` 가 있으면 판매자 쿠폰이고
   * 없으면 플랫폼 쿠폰이다. 그래서 권한 검사가 곧 부담 주체의 검사가 된다 —
   * 플랫폼 쿠폰은 `platformOwnership` 에 대한 `coupon.write` 라 `any` 스코프를
   * 가진 관리자만 지나가고(판매자와 데모 관리자는 `out_of_scope` 로 거절된다),
   * 판매자 쿠폰은 그 가게의 소유권 검사라 주인과 관리자가 지난다.
   */
  async create(principal: RequestPrincipal, request: CreateCouponRequest): Promise<Coupon> {
    await this.assertMayIssueFor(principal, request.sellerId)

    // **판단하기 전에 표준형으로 고른다.** 대소문자만 다른 uuid 와 두 번 고른
    // 대상이 서버·DB·적용에서 서로 다른 답을 내는 것을 막는다
    // (`canonicalScopeIds` 에 그 셋을 적었다).
    const normalized: CreateCouponRequest = {
      ...request,
      sellerId: request.sellerId === null ? null : request.sellerId.toLowerCase(),
      scopeIds: [...canonicalScopeIds(request.scopeType, request.scopeIds)],
    }
    const input = {
      sellerId: normalized.sellerId,
      discountType: normalized.discountType,
      discountValue: normalized.discountValue,
      maxDiscountAmount: normalized.maxDiscountAmount,
      scopeType: normalized.scopeType,
      scopeIds: normalized.scopeIds,
      validFrom: new Date(normalized.validFrom),
      validUntil: new Date(normalized.validUntil),
    }
    const fault = policyFault(input)

    if (fault !== null) throw refusePolicy(fault)

    await this.assertScopeTargets(normalized)

    const now = this.clock.now()

    return this.write(normalized, input.validFrom, input.validUntil, now)
  }

  // ------------------------------------------------------------------ 발급

  /**
   * 발행자가 한 사람에게 지급한다 (F3 · F4 · F5).
   *
   * 남의 쿠폰을 나눠 줄 수는 없다 — 쿠폰 행의 소유권에 대한 `coupon.write` 를
   * 다시 묻는다. 발행할 때 지난 검사와 같은 검사이고, 다른 것은 **그때는 만들
   * 행이 없어 `platformOwnership` 을 썼고 지금은 실제 행이 있다**는 점뿐이다.
   */
  async grant(
    principal: RequestPrincipal,
    couponId: string,
    userId: string,
  ): Promise<UserCouponContract> {
    const coupon = await this.load(couponId)

    await this.assertMayIssueFor(principal, coupon.sellerId)

    // 받을 사람이 실재하는지 먼저 본다. 없는 계정에 넣으면 외래키가 막아 주지만,
    // 그 실패는 500 으로 나가 「내가 잘못 친 것인지」를 아무도 알 수 없다.
    const recipient = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })

    if (recipient === null) throw new NotFoundException('회원을 찾을 수 없어요.')

    return this.issue(coupon, userId, 'grant')
  }

  /**
   * 코드를 넣어 **본인이** 받는다 (F8).
   *
   * `userId` 를 요청에서 받지 않는 것이 이 문의 전부다. 받으면 코드를 아는 사람이
   * 남의 쿠폰함에 쿠폰을 넣을 수 있고, 발급은 한 번뿐이라(중복 불가) 그것은
   * **남의 쿠폰을 소진시키는 방법**이 된다.
   *
   * **형식이 틀린 코드와 없는 코드를 갈라 답하지 않는다.** 갈라 답하면 코드를 찍어
   * 보는 쪽에 「형식은 맞다」는 힌트가 되고, 그 힌트가 탐색 공간을 좁힌다.
   */
  async claim(principal: RequestPrincipal, code: string): Promise<UserCouponContract> {
    const normalized = normalizeCouponCode(code)
    const coupon =
      normalized === null
        ? null
        : await this.prisma.coupon.findUnique({
            where: { code: normalized },
            select: COUPON_SELECT,
          })

    if (coupon === null) {
      throw new BadRequestException(
        domainFailure('COUPON_CODE_UNKNOWN', '쿠폰 코드를 다시 확인해 주세요.', { field: 'code' }),
      )
    }

    return this.issue(coupon, principal.userId, 'claim')
  }

  // ---------------------------------------------------------------- 내부

  /**
   * 발급 한 건. 기간을 먼저 보고, 자리를 잡고, 행을 넣는다.
   *
   * **기간이 먼저인 이유**는 끝난 쿠폰에 자리를 하나 태우지 않기 위해서다. 갱신이
   * 롤백되므로 결과는 같지만, 순서가 반대면 「끝난 쿠폰인데 소진됐다고 답하는」
   * 경우가 생긴다 — 남은 장수가 0인 캠페인이 끝난 뒤 코드를 넣은 사람이 받는 답이
   * 그것이고, 그 사람이 할 일은 기다리는 것도 서두르는 것도 아니다.
   */
  private async issue(
    coupon: CouponRow,
    userId: string,
    door: IssueDoor,
  ): Promise<UserCouponContract> {
    const now = this.clock.now()
    const fault = issuabilityFault(coupon, now)

    // 두 거절 모두 **입력에 대한 것이 아니다** — 코드는 맞게 쳤고 쿠폰도 있다.
    // `domainFailure` 가 `field` 없이는 `params` 를 싣지 않는 것도 그래서이고,
    // 없는 칸에 오류를 붙이는 것보다 문장만 내려보내는 편이 맞다.
    if (fault === 'not_started') {
      throw new ConflictException(
        domainFailure('COUPON_NOT_STARTED', '아직 받을 수 있는 기간이 아니에요.'),
      )
    }

    if (fault === 'ended') {
      throw new ConflictException(domainFailure('COUPON_ENDED', '받을 수 있는 기간이 지났어요.'))
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const taken = await this.takeIssueSlot(tx, coupon.id, now)

        if (taken === 0) await this.explainRefusal(tx, coupon.id, userId, door)

        const row = await tx.userCoupon.create({
          data: {
            couponId: coupon.id,
            userId,
            // 시각 셋이 **같은 시계**에서 나와야 한다. `DEFAULT now()` 에 맡기면
            // 그것만 데이터베이스의 지금이 되고, 주입된 시계 아래서 한 행의 두
            // 시각이 갈린다 (`ReservationService.reserve` 가 같은 이유로 같게 한다).
            issuedAt: now,
            createdAt: now,
            updatedAt: now,
            expiresAt: coupon.validUntil,
          },
          select: USER_COUPON_SELECT,
        })

        return toUserCoupon(row, coupon)
      })
    } catch (error: unknown) {
      // 유니크 인덱스가 실제로 막은 경우. 위 {@link explainRefusal} 이 조회로 먼저
      // 알아내는 길도 있지만, 그 조회와 이 삽입 사이가 비어 있으므로 **동시에 두
      // 번 요청한 사람**은 여기로 온다. 막는 것은 언제나 인덱스다.
      if (isUniqueViolationOn(error, 'couponId') || isUniqueViolationOn(error, 'userId')) {
        throw alreadyIssued(door)
      }

      throw error
    }
  }

  /**
   * 이번 발급의 자리를 잡는다. 0이면 잡지 못한 것이다.
   *
   * **이 한 문장이 F6 이 재는 전부다.** 조건이 `WHERE` 안에 있으므로 판단과 갱신
   * 사이가 비지 않는다.
   */
  private takeIssueSlot(tx: Tx, couponId: string, now: Date): Promise<number> {
    return tx.$executeRaw`
      UPDATE "Coupon"
         SET "issuedCount" = "issuedCount" + 1, "updatedAt" = ${now}
       WHERE "id" = ${couponId}::uuid
         AND ("issueLimit" IS NULL OR "issuedCount" < "issueLimit")
    `
  }

  /**
   * 조건부 갱신이 0행을 고쳤다 — 소진인가, 이미 받은 것인가.
   *
   * **진 다음에만 읽는다.** 성공하는 길에 질의를 하나 더 놓지 않기 위해서이고
   * (`ReservationService.explainRefusal` 과 같은 나눔), 「이미 받으셨어요」는 진
   * 쪽만 알면 되는 사실이다.
   *
   * 순서가 중요하다. 이미 받은 사람이 다시 눌렀는데 그 사이 쿠폰이 소진됐다면
   * 「다 나갔어요」가 나가고, 그 사람은 자기 쿠폰함에 있는 쿠폰을 찾지 못한 채
   * 서두르게 된다. 그래서 **중복을 먼저 본다.**
   */
  private async explainRefusal(
    tx: Tx,
    couponId: string,
    userId: string,
    door: IssueDoor,
  ): Promise<never> {
    const mine = await tx.userCoupon.findUnique({
      where: { couponId_userId: { couponId, userId } },
      select: { id: true },
    })

    if (mine !== null) throw alreadyIssued(door)

    const coupon = await tx.coupon.findUnique({
      where: { id: couponId },
      select: { issueLimit: true, issuedCount: true },
    })

    if (coupon === null) throw new NotFoundException('쿠폰을 찾을 수 없어요.')

    // 소진이 아닌데 0행이면 그 사이에 쿠폰이 사라진 것이다. 그런 행은 이 표에서
    // 만들어지지 않지만(발급된 쿠폰은 `Restrict` 가 잡는다), 조용히 성공한 것처럼
    // 끝나는 것보다 낫다.
    throw new ConflictException(
      domainFailure(
        'COUPON_ISSUE_EXHAUSTED',
        issueExhausted(coupon.issueLimit, coupon.issuedCount)
          ? '준비된 수량이 모두 나갔어요.'
          : '지금은 받을 수 없어요. 잠시 후 다시 시도해 주세요.',
      ),
    )
  }

  /**
   * 이 사람이 이 부담 주체의 쿠폰을 다룰 수 있는가.
   *
   * 플랫폼 쿠폰의 소유자는 **아무도 아니다**(`platformOwnership`). `own` 도 `demo`
   * 도 그 행을 인정하지 않으므로 `any` 를 가진 관리자만 지나가고, 그것이 「판매자는
   * 플랫폼 쿠폰을 낼 수 없다」와 「데모 관리자는 실계정에 닿는 쿠폰을 낼 수 없다」를
   * 한 줄로 답한다 — 서비스가 역할을 직접 보지 않는다.
   */
  private async assertMayIssueFor(
    principal: RequestPrincipal,
    sellerId: string | null,
  ): Promise<void> {
    if (sellerId === null) {
      assertResourceAccess(principal, 'coupon.write', platformOwnership)

      return
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'coupon.write', sellerOwnership(seller))
  }

  /**
   * 범위 대상이 실재하는가, 그리고 판매자 쿠폰이면 **그 가게 것인가** (F2).
   *
   * `Coupon_seller_scope_check` 가 못 재는 절반이다. CHECK 는 한 행만 보므로
   * 「이 상품이 저 가게 것인가」에 답하려면 조인이 필요하고, 그 조인은 여기서만
   * 할 수 있다. 화면·서버·DB 세 겹 중 **이 겹만이** 상품 소유를 본다.
   *
   * 실재 확인을 함께 하는 이유는 조용한 실패를 막기 위해서다 — 없는 카테고리를
   * 가리키는 쿠폰은 오류를 내지 않고 **아무 주문에도 적용되지 않는 쿠폰**이 된다.
   */
  private async assertScopeTargets(request: CreateCouponRequest): Promise<void> {
    const ids = request.scopeIds

    if (request.scopeType === 'CATEGORY') {
      const parsed = ids.map((id) => couponCategoryScopeIdSchema.safeParse(id))

      // uuid 를 카테고리 자리에 넣은 요청. **없는 카테고리와 같은 답**을 준다 —
      // 형식과 실재를 갈라 답할 이유가 여기에도 없다 (`assertUuids` 와 같은 판단).
      if (parsed.some((result) => !result.success)) throw missingScopeTarget()

      const found = await this.prisma.category.count({
        where: { id: { in: parsed.map((result) => (result.success ? result.data : 0)) } },
      })

      if (found !== ids.length) throw missingScopeTarget()
    }

    if (request.scopeType === 'PRODUCT') {
      assertUuids(ids, couponProductScopeIdSchema)

      const found = await this.prisma.product.count({
        where: {
          id: { in: ids },
          deletedAt: null,
          // **판매자 쿠폰이면 그 가게 것만 센다.** 하나라도 남의 상품이면 개수가
          // 모자라 거절된다 — 「어느 것이 남의 것인지」를 답하지 않는 이유는 그것이
          // 곧 남의 상품 id 를 확인해 주는 일이기 때문이다.
          ...(request.sellerId === null ? {} : { sellerId: request.sellerId }),
        },
      })

      if (found !== ids.length) throw missingScopeTarget()
    }

    if (request.scopeType === 'SELLER') {
      assertUuids(ids, couponSellerScopeIdSchema)

      const found = await this.prisma.seller.count({ where: { id: { in: ids } } })

      if (found !== ids.length) throw missingScopeTarget()
    }
  }

  /**
   * 쿠폰 행을 만든다. 코드가 겹치면 **한 번만** 다시 한다.
   *
   * 다시 하는 단위가 삽입 전체인 것은 `OrderService.store` 와 같은 이유다 —
   * Postgres 는 트랜잭션 안의 한 문장이 실패하면 전체를 중단시키므로 안에서 다른
   * 코드로 고쳐 쓸 수 없다. 무한히 다시 하지 않는 것도 같은 이유다: 50비트 난수가
   * 연달아 두 번 겹치는 일은 없고, 무한 고리는 **다른 이유로 실패할 때** 영원히
   * 돈다.
   */
  private async write(
    request: CreateCouponRequest,
    validFrom: Date,
    validUntil: Date,
    now: Date,
  ): Promise<Coupon> {
    try {
      return await this.insert(request, validFrom, validUntil, now)
    } catch (error: unknown) {
      if (!isUniqueViolationOn(error, 'code')) throw error

      return this.insert(request, validFrom, validUntil, now)
    }
  }

  private async insert(
    request: CreateCouponRequest,
    validFrom: Date,
    validUntil: Date,
    now: Date,
  ): Promise<Coupon> {
    const row = await this.prisma.coupon.create({
      data: {
        issuerType: request.sellerId === null ? 'PLATFORM' : 'SELLER',
        sellerId: request.sellerId,
        name: request.name,
        code: request.withCode ? couponCodeFrom(randomBytes(COUPON_CODE_LENGTH)) : null,
        discountType: request.discountType,
        discountValue: request.discountValue,
        maxDiscountAmount: request.maxDiscountAmount,
        minOrderAmount: request.minOrderAmount,
        scopeType: request.scopeType,
        scopeIds: [...request.scopeIds],
        validFrom,
        validUntil,
        issueLimit: request.issueLimit,
        createdAt: now,
        updatedAt: now,
      },
      select: COUPON_SELECT,
    })

    return toCoupon(row)
  }

  private async load(couponId: string): Promise<CouponRow> {
    const row = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: COUPON_SELECT,
    })

    if (row === null) throw new NotFoundException('쿠폰을 찾을 수 없어요.')

    return row
  }
}

/** 응답에 실리는 쿠폰의 모양. */
const COUPON_SELECT = {
  id: true,
  issuerType: true,
  sellerId: true,
  name: true,
  code: true,
  discountType: true,
  discountValue: true,
  maxDiscountAmount: true,
  minOrderAmount: true,
  scopeType: true,
  scopeIds: true,
  validFrom: true,
  validUntil: true,
  issueLimit: true,
  issuedCount: true,
} as const

type CouponRow = Prisma.CouponGetPayload<{ select: typeof COUPON_SELECT }>

/**
 * 발급된 장의 **스칼라만**. 정책은 조인하지 않는다.
 *
 * 부르는 쪽이 이미 정책 행을 들고 있기 때문이다 — `issue()` 는 기간을 보려고 그것을
 * 읽은 참이고, 여기서 다시 조인하면 성공하는 길에 같은 행을 두 번 읽는 질의가
 * 붙는다 (`coupon-performance.spec.ts` 의 A5 가 그 수를 센다).
 */
const USER_COUPON_SELECT = {
  id: true,
  couponId: true,
  userId: true,
  status: true,
  expiresAt: true,
  issuedAt: true,
  usedAt: true,
  orderId: true,
} as const

type UserCouponRow = Prisma.UserCouponGetPayload<{ select: typeof USER_COUPON_SELECT }>

/** 행을 계약의 모양으로. 날짜는 ISO 문자열이다 (`couponSchema`). */
export function toCoupon(row: CouponRow): Coupon {
  return {
    ...row,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
  }
}

export function toUserCoupon(row: UserCouponRow, coupon: CouponRow): UserCouponContract {
  return {
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    coupon: toCoupon(coupon),
  }
}

/**
 * 발행 거절 하나를 HTTP 로 옮긴다.
 *
 * **두 갈래로 나뉘는 이유는 상태 코드가 다르기 때문이다.** 판매자 범위 거절은
 * 「이 요청은 옳은데 당신이 할 수 없다」라 403 이고, 나머지는 「입력을 고치면
 * 된다」라 400 + 필드다. 하나로 묶으면 화면이 「할인율을 고치세요」를 권한 배너로
 * 그리거나, 그 반대가 된다.
 */
function refusePolicy(fault: CouponPolicyFault): Error {
  const field = couponPolicyFaultFields[fault]

  if (fault === 'seller_scope_too_wide' || fault === 'seller_scope_foreign') {
    // 403 이다. 「입력을 고치면 된다」가 아니라 「이 요청은 당신이 할 수 없다」이고,
    // `PRODUCT_SELLER_INACTIVE` 가 같은 이유로 같은 자리에 선다.
    return new ForbiddenException(
      domainFailure('COUPON_SCOPE_FORBIDDEN', POLICY_MESSAGES[fault], { field }),
    )
  }

  return new BadRequestException(domainFailure('INVALID', POLICY_MESSAGES[fault], { field }))
}

/** 서버의 문장. 화면은 자기 카탈로그의 `INVALID` 문장을 쓴다. */
const POLICY_MESSAGES: Readonly<Record<CouponPolicyFault, string>> = {
  scope_targets_forbidden: '전체 적용 쿠폰에는 적용 대상을 지정할 수 없어요.',
  scope_targets_required: '적용 대상을 하나 이상 지정해 주세요.',
  seller_scope_too_wide: '판매자 쿠폰은 자기 스토어의 상품에만 적용할 수 있어요.',
  seller_scope_foreign: '판매자 쿠폰은 자기 스토어의 상품에만 적용할 수 있어요.',
  percent_out_of_range: '할인율은 1~100% 사이로 입력해 주세요.',
  max_discount_meaningless: '정액 할인에는 최대 할인 금액을 둘 수 없어요.',
  period_inverted: '종료 시각이 시작 시각보다 뒤여야 해요.',
}

function missingScopeTarget(): Error {
  return new BadRequestException(
    domainFailure('INVALID', '적용 대상 중에 지정할 수 없는 것이 있어요.', { field: 'scopeIds' }),
  )
}

/**
 * 중복 발급의 거절.
 *
 * 문장이 문에 따라 다르다. 코드를 넣은 사람에게는 「이미 받으셨어요」가 답이지만,
 * 관리자가 지급하려다 받은 답은 「그 사람은 이미 갖고 있어요」다 — 같은 사실이고
 * 읽는 사람이 다르다. 코드는 하나다: 화면이 갈라 그릴 필요는 없다.
 */
function alreadyIssued(door: IssueDoor): Error {
  return new ConflictException(
    domainFailure(
      'COUPON_ALREADY_ISSUED',
      door === 'claim' ? '이미 받으신 쿠폰이에요.' : '이미 이 쿠폰을 가진 회원이에요.',
    ),
  )
}

/**
 * 대상이 전부 uuid 인가.
 *
 * 아니면 「지정할 수 없는 것이 있다」와 **같은 답**이다. 「형식이 틀렸다」와 「없는
 * 상품이다」를 갈라 답하면 남의 상품 id 를 넣어 보는 것만으로 그 상품의 존재를 알
 * 수 있게 된다.
 */
function assertUuids(ids: readonly string[], schema: ZodType<string>): void {
  if (ids.some((id) => !schema.safeParse(id).success)) throw missingScopeTarget()
}
