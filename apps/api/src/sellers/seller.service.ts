import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  BrandNameAvailabilityResponse,
  Seller,
  SellerApplicationRequest,
  SellerDecisionRequest,
  SellerResponse,
  SellerReviewListQuery,
  SellerReviewListResponse,
  SellerStatus,
  SellerStoreUpdateRequest,
} from '@shopping/shared'
import { SELLER_REVIEW_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { assertSellerActive } from './seller-access.js'
import type { SellerAction, SellerCapability } from './seller-status.js'
import { allowedSellerActions, nextSellerStatus } from './seller-status.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** Postgres unique violation — brand name, slug, or a second store per account. */
const UNIQUE_VIOLATION = '23505'

/**
 * The unique indexes a caller can actually collide with: the input to blame and
 * the sentence that goes with it.
 *
 * One table rather than two keyed the same way, so a new index cannot be given
 * a field and no message — which the envelope would then drop, leaving a 409
 * with an empty `details`.
 */
const DUPLICATES: Readonly<Record<string, { readonly field: string; readonly message: string }>> = {
  Seller_brandName_key: { field: 'brandName', message: '이미 쓰고 있는 브랜드명이에요.' },
  Seller_slug_key: { field: 'slug', message: '이미 쓰고 있는 스토어 주소예요.' },
  Seller_userId_key: { field: 'userId', message: '이미 스토어가 있어요.' },
}

/** Everything `sellerSchema` answers with, plus what the scope check reads. */
const SELLER_SELECT = {
  ...sellerOwnershipSelect,
  brandName: true,
  slug: true,
  introduction: true,
  logoUrl: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  version: true,
  createdAt: true,
} as const

type SellerRecord = Prisma.SellerGetPayload<{ select: typeof SELLER_SELECT }>

/** Which permission decides each review action (TASK-0108 4장). */
const ACTION_PERMISSION = {
  approve: 'seller.approve',
  reject: 'seller.approve',
  /**
   * 정지도 해제도 `seller.suspend` 다. Reversing a suspension with a lesser
   * permission would let an everyday operator undo the super admin's decision,
   * which is the same as not having split them.
   */
  suspend: 'seller.suspend',
  reinstate: 'seller.suspend',
} as const satisfies Partial<Record<SellerAction, 'seller.approve' | 'seller.suspend'>>

export type SellerDecision = keyof typeof ACTION_PERMISSION

/** What a demo issue (TASK-0024) says about the store it wants opened. */
export interface DemoStoreInput {
  readonly userId: string
  readonly brandName: string
  readonly slug: string
  readonly introduction?: string | null
  readonly logoUrl?: string | null
}

/**
 * Seller onboarding (TASK-0108).
 *
 * Four rules run through everything below.
 *
 * **The state machine is a table, not a set of `if`s.** Every write asks
 * `nextSellerStatus` where it may go and refuses with the list of moves that
 * were available. There is no place in this file where a status is compared to
 * a literal to decide a transition — the one that decides is
 * `seller-status.ts`, which is checked exhaustively.
 *
 * **A transition is a conditional update, not a read followed by a write.** The
 * `WHERE` carries both the `version` the caller saw and the status it was in,
 * so two operators clicking 승인 at the same moment cannot both transition the
 * row: the second matches nothing and is told which of the two happened (F13).
 * A read-then-write would let both believe they were first.
 *
 * **Approval and the role grant are one transaction.** `SELLER_OWNER` is the
 * capability that being approved *is*; a store left `ACTIVE` with no role is a
 * seller who cannot open their console, and a role granted to a store that
 * stayed `PENDING` is a seller who can sell without approval. Neither half is
 * allowed to survive alone (F2, R5).
 *
 * **Uniqueness is the database's answer.** `Seller_brandName_key` and
 * `Seller_slug_key` are what refuse a duplicate; the availability endpoint is a
 * convenience for a form and can be stale by the time the form is submitted, so
 * nothing here decides a duplicate by reading first (F6, S5).
 */
@Injectable()
export class SellerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------- the seller

  /**
   * The caller's own store, whatever state it is in.
   *
   * Looked up by **account**, not by `principal.sellerId`. The access token is
   * self-contained and was minted before the application existed, so a caller
   * who has just applied still carries `sellerId: null` until their next
   * refresh — and a lookup by that field would answer 404 to the very person
   * whose store it is. `ownerUserId` is what the `own` scope resolves against
   * here (`authorize.ts`).
   */
  async me(principal: RequestPrincipal): Promise<SellerResponse> {
    const seller = await this.ownStore(principal.userId)

    assertResourceAccess(principal, 'seller.read', sellerOwnership(seller))

    return { seller: toSeller(seller) }
  }

  /**
   * Applies to sell, or applies again after a rejection.
   *
   * There is no `assertResourceAccess` on the create path and that is not an
   * omission: the row does not exist yet, so there is nothing to resolve a
   * scope against, and the row this creates is owned by the caller by
   * construction — `own` admits it and no narrower scope exists. The permission
   * itself was checked by `PermissionGuard`, and `BUYER` holds it precisely
   * because applying is done by somebody who is not a seller yet.
   *
   * Re-application replaces the whole form rather than patching the rejected
   * one: the brand name may well have *been* the reason for the rejection.
   */
  async apply(
    principal: RequestPrincipal,
    input: SellerApplicationRequest,
  ): Promise<SellerResponse> {
    const existing = await this.prisma.seller.findUnique({
      where: { userId: principal.userId },
      select: SELLER_SELECT,
    })
    const target = nextSellerStatus(existing?.status ?? null, 'apply')

    if (target === null) {
      throw this.refuseTransition(existing?.status ?? null, 'apply')
    }

    const now = this.clock.now()
    const fields = {
      brandName: input.brandName,
      slug: input.slug,
      introduction: input.introduction ?? null,
      logoUrl: input.logoUrl ?? null,
      status: target,
      // The rejection no longer applies to a submission that answers it.
      statusReason: null,
      statusChangedAt: now,
    }

    if (existing === null) {
      return this.answer(
        await this.duplicateAware(() =>
          this.prisma.seller.create({
            data: { userId: principal.userId, ...fields, createdAt: now, updatedAt: now },
            select: SELLER_SELECT,
          }),
        ),
      )
    }

    assertResourceAccess(principal, 'seller.write', sellerOwnership(existing))

    return this.answer(
      await this.duplicateAware(() =>
        this.prisma.seller.update({
          where: { id: existing.id },
          data: { ...fields, version: { increment: 1 }, updatedAt: now },
          select: SELLER_SELECT,
        }),
      ),
    )
  }

  /**
   * Edits the store's own copy — brand name, introduction, logo.
   *
   * Allowed in every status on purpose. A rejected applicant fixing the name
   * that was rejected, and a suspended seller correcting an introduction, are
   * both things the platform wants to happen; what a non-`ACTIVE` store may not
   * do is *sell*, which is `assertSellerActive`'s question and not this one.
   *
   * `slug` is absent from the request schema (R4), so this cannot move a
   * storefront's URL.
   */
  async updateStore(
    principal: RequestPrincipal,
    input: SellerStoreUpdateRequest,
  ): Promise<SellerResponse> {
    const seller = await this.ownStore(principal.userId)

    assertResourceAccess(principal, 'seller.write', sellerOwnership(seller))

    const changed = await this.duplicateAware(() =>
      this.prisma.seller.updateMany({
        where: { id: seller.id, version: input.version },
        data: {
          ...(input.brandName === undefined ? {} : { brandName: input.brandName }),
          ...(input.introduction === undefined ? {} : { introduction: input.introduction }),
          ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
          version: { increment: 1 },
          updatedAt: this.clock.now(),
        },
      }),
    )

    // Nothing matched, and the row is still there: somebody saved first. The
    // distinction matters to the caller — one is a store that no longer exists,
    // the other is a conflict they resolve by reloading (F9).
    if (changed.count === 0) await this.staleWrite(seller.id)

    return this.answer(await this.byId(seller.id))
  }

  /**
   * Whether a brand name is free right now.
   *
   * Deliberately **not** the thing that prevents duplicates. Two applications
   * can both be told `available: true` — the answer is a read, and the row that
   * would collide with it may be committed a millisecond later. The refusal
   * that counts is `Seller_brandName_key`, and `test/db/seller-contention.spec.ts`
   * shows what check-then-insert alone would let through.
   */
  async brandNameAvailability(value: string): Promise<BrandNameAvailabilityResponse> {
    const taken = await this.prisma.seller.count({ where: { brandName: value } })

    return { value, available: taken === 0 }
  }

  // -------------------------------------------------------------- the admin

  /**
   * A page of applications, newest first.
   *
   * One statement whatever the page holds (gate A5): there is nothing to join —
   * the review row is the store row — so a per-row lookup would have to be
   * added deliberately, and `userId` travels in the response precisely so that
   * nobody adds one.
   *
   * Ordering is `id DESC` and the cursor is the last id, which works because
   * store ids are UUIDv7 and therefore already in creation order.
   */
  async review(query: SellerReviewListQuery): Promise<SellerReviewListResponse> {
    const limit = query.limit ?? SELLER_REVIEW_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.seller.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
      },
      orderBy: { id: 'desc' },
      // One more than asked for, so "is there another page" needs no second
      // query and no total count.
      take: limit + 1,
      select: SELLER_SELECT,
    })

    const page = rows.slice(0, limit)

    return {
      sellers: page.map(toSeller),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /** One application, for the review screen. */
  async reviewOne(id: string): Promise<SellerResponse> {
    return this.answer(await this.byId(id))
  }

  /**
   * Approves, rejects, suspends or reinstates a store.
   *
   * The scope check is what makes a demo administrator's reach real: their
   * `seller.approve` is narrowed to `demo`, and the ownership of a store is the
   * demo flag of the account that owns it, so approving a real applicant is
   * refused here without this method knowing what a demo account is (F12,
   * TASK-0105 3).
   */
  async decide(
    principal: RequestPrincipal,
    id: string,
    action: SellerDecision,
    input: SellerDecisionRequest,
  ): Promise<SellerResponse> {
    const seller = await this.byId(id)

    assertResourceAccess(principal, ACTION_PERMISSION[action], sellerOwnership(seller))

    const target = nextSellerStatus(seller.status, action)

    if (target === null) throw this.refuseTransition(seller.status, action)

    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, seller, action, target, input)

      if (action === 'approve') await this.grantOwnerRole(tx, seller.userId)
    })

    return this.answer(await this.byId(id))
  }

  // --------------------------------------------------------------- the demo

  /**
   * Opens a demo visitor's store, already approved (F7, R1).
   *
   * The entry point TASK-0024's issuing path calls. It skips review rather than
   * calling the review endpoints, because there is nobody to review it and a
   * visitor who has to wait for approval never sees the seller console at all —
   * which is the whole of the demo.
   *
   * It is still the same transaction as an approval: `ACTIVE` and
   * `SELLER_OWNER` go in together, so the demo path cannot produce a store
   * shape the reviewed path never produces.
   */
  async openDemoStore(input: DemoStoreInput): Promise<Seller> {
    const now = this.clock.now()

    const created = await this.duplicateAware(() =>
      this.prisma.$transaction(async (tx) => {
        const seller = await tx.seller.create({
          data: {
            userId: input.userId,
            brandName: input.brandName,
            slug: input.slug,
            introduction: input.introduction ?? null,
            logoUrl: input.logoUrl ?? null,
            status: 'ACTIVE',
            statusReason: null,
            statusChangedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          select: SELLER_SELECT,
        })

        await this.grantOwnerRole(tx, seller.userId)

        return seller
      }),
    )

    return toSeller(created)
  }

  // ---------------------------------------------------------- the state gate

  /**
   * Refuses the request unless the store may do this in its current state.
   *
   * The async form of {@link assertSellerActive}, for an endpoint that holds a
   * store id and not the row. An endpoint that has already loaded the store —
   * `ProductService` does — calls the pure function directly and pays no second
   * query.
   */
  async assertCapability(sellerId: string, capability: SellerCapability): Promise<void> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { status: true },
    })

    if (seller === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    assertSellerActive(seller.status, capability)
  }

  // ------------------------------------------------------------- internals

  /**
   * Moves the row, or says which of the two things stopped it.
   *
   * Both guards are in the `WHERE`: the `version` the caller was looking at and
   * the status they were deciding about. A read-then-write would compare the
   * same values a moment earlier and let two concurrent approvals both pass —
   * with the row locked only by the second statement, which protects the write
   * and not the decision (the lesson TASK-0032 7.3 measured for products).
   */
  private async transition(
    tx: Tx,
    seller: SellerRecord,
    action: SellerDecision,
    target: SellerStatus,
    input: SellerDecisionRequest,
  ): Promise<void> {
    const changed = await tx.seller.updateMany({
      where: { id: seller.id, version: input.version, status: seller.status },
      data: {
        status: target,
        // A decision without a note clears the previous one: the sentence on an
        // approved store would otherwise still be the reason it was rejected.
        statusReason: input.reason ?? null,
        statusChangedAt: this.clock.now(),
        version: { increment: 1 },
        updatedAt: this.clock.now(),
      },
    })

    if (changed.count > 0) return

    // READ COMMITTED gives this statement a fresh snapshot, so it sees whatever
    // the transaction that beat us committed.
    const current = await tx.seller.findUnique({
      where: { id: seller.id },
      select: { status: true, version: true },
    })

    if (current === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')
    if (current.version !== input.version) throw this.versionConflict()

    throw this.refuseTransition(current.status, action)
  }

  /**
   * Grants `SELLER_OWNER`, idempotently.
   *
   * `skipDuplicates` rather than a check: `UserRole(userId, role)` is unique, so
   * two approvals racing each other — or an approval of a store whose owner was
   * granted the role some other way — must be a no-op rather than a constraint
   * error surfacing as a 500 (요구사항 비기능 2).
   */
  private async grantOwnerRole(tx: Tx, userId: string): Promise<void> {
    await tx.userRole.createMany({
      data: [{ userId, role: 'SELLER_OWNER' }],
      skipDuplicates: true,
    })
  }

  /** The caller's store, or a 404 saying they have none. */
  private async ownStore(userId: string): Promise<SellerRecord> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: SELLER_SELECT,
    })

    if (seller === null) throw new NotFoundException('아직 입점 신청을 하지 않았습니다.')

    return seller
  }

  private async byId(id: string): Promise<SellerRecord> {
    const seller = await this.prisma.seller.findUnique({ where: { id }, select: SELLER_SELECT })

    if (seller === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    return seller
  }

  private answer(seller: SellerRecord): SellerResponse {
    return { seller: toSeller(seller) }
  }

  /**
   * A 400 naming the current status and the moves that were available.
   *
   * The list is the difference between "안 됩니다" and an answer a console can
   * act on: a store whose 승인 button failed can be told that 반려 was the other
   * option, without the screen keeping its own copy of the state machine (F10).
   */
  private refuseTransition(
    current: SellerStatus | null,
    action: SellerAction,
  ): BadRequestException {
    const available = allowedSellerActions(current)

    return new BadRequestException({
      message: [
        {
          field: 'status',
          message:
            available.length === 0
              ? `지금 상태(${current ?? '없음'})에서는 할 수 있는 것이 없어요.`
              : `지금 상태(${current ?? '없음'})에서는 ${action} 할 수 없어요. 가능한 것: ${available.join(', ')}`,
          code: 'INVALID',
          params: { status: current ?? 'NONE', action, allowed: available.join(',') },
        },
      ],
    })
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      message: [
        {
          field: 'version',
          message: '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?',
          code: 'INVALID',
        },
      ],
    })
  }

  /** A 409 for a stale save, unless the row is simply gone. */
  private async staleWrite(id: string): Promise<never> {
    await this.byId(id)

    throw this.versionConflict()
  }

  /**
   * Turns a unique violation into an answer that names the field.
   *
   * The index is read from the database's own error rather than matched on its
   * message, which would break the first time a locale or a version changed it
   * — the route `ProductService.sqlStateOf` takes, for the same reason.
   */
  private async duplicateAware<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      throw duplicateOrRethrow(error)
    }
  }
}

/** The stored row, in the shape `@shopping/shared` declares. */
function toSeller(row: SellerRecord): Seller {
  return {
    id: row.id,
    userId: row.userId,
    brandName: row.brandName,
    slug: row.slug,
    introduction: row.introduction,
    logoUrl: row.logoUrl,
    status: row.status,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  }
}

function duplicateOrRethrow(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error
  if (error.code !== 'P2002' && sqlStateOf(error) !== UNIQUE_VIOLATION) return error

  const duplicate = DUPLICATES[violatedIndexOf(error) ?? '']

  if (duplicate === undefined) return error

  return new ConflictException({
    message: [{ ...duplicate, code: 'INVALID' }],
  })
}

/** SQLSTATE behind a failed query, when the adapter reports one. */
function sqlStateOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } })
    .driverAdapterError?.cause?.originalCode

  return typeof cause === 'string' ? cause : undefined
}

/**
 * The index a unique violation names.
 *
 * Two sources, because the two write paths report it differently: a typed write
 * fills `meta.target` with the schema-declared field, while a violation that
 * surfaces through the driver adapter carries the database's own index name.
 * Reading both is what keeps this working whether the collision came from
 * `create`, `updateMany`, or a statement Prisma passed straight through.
 */
function violatedIndexOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta as
    | {
        target?: unknown
        driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } }
      }
    | undefined
  const constraint = meta?.driverAdapterError?.cause?.constraint

  if (typeof constraint?.index === 'string') return constraint.index

  const target = meta?.target

  if (typeof target === 'string') return target
  if (Array.isArray(target) && typeof target[0] === 'string') return `Seller_${target[0]}_key`

  return undefined
}
