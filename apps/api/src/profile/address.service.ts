import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  Address,
  AddressCreateRequest,
  AddressListResponse,
  AddressResponse,
  AddressUpdateRequest,
  Permission,
} from '@shopping/shared'

import { accessDenied, assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { defaultOnCreate, promotedAfterDelete } from './default-address.js'

/** The columns `addressSchema` is made of, named once. */
const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  postalCode: true,
  addressLine1: true,
  addressLine2: true,
  isDefault: true,
} as const

/** The same, plus what an ownership decision needs. */
const OWNED_ADDRESS_SELECT = {
  ...ADDRESS_SELECT,
  userId: true,
  user: { select: accountOwnershipSelect },
} as const

interface OwnedAddress extends Address {
  readonly userId: string
  readonly user: AccountRow
}

/** Postgres unique violation — here, always `Address_userId_default_key`. */
const UNIQUE_VIOLATION = '23505'

/**
 * Whether the database refused this write for a duplicate key.
 *
 * Prisma reports a typed write's violation as `P2002` and a raw one as `P2010`
 * carrying the driver's own SQLSTATE. Reading the message instead would break
 * the first time a version or a locale changes it (the shape `ProductService`
 * settled on in TASK-0032).
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2002') return true

  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } })
    .driverAdapterError?.cause?.originalCode

  return cause === UNIQUE_VIOLATION
}

/**
 * Turns the index's refusal into an answer a person can act on.
 *
 * **It is not retried.** Two requests asked for two different defaults, so the
 * loser's intent is not "make some address the default" but "make *this* one" —
 * retrying would silently overwrite the choice that won, in a race the person
 * cannot see. A 409 says the state moved and lets the screen re-read it
 * (TASK-0111 4장, F3b).
 */
async function refusingDuplicateDefault<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictException(
        '기본 배송지가 방금 다른 곳에서 바뀌었어요. 목록을 새로고침해 주세요.',
      )
    }
    throw error
  }
}

/**
 * The address book of the account that is calling (TASK-0111).
 *
 * **Two checks, not one, on every row this touches.** The scope on the grant
 * decides whether the caller may reach this account's data at all; then the
 * service insists that the row is the *caller's own*. The second one exists
 * because `/me/addresses/:id` does carry an identifier, and `ADMIN_SUPER` holds
 * `profile.write:any` — without it, a path that promises "always yourself"
 * would quietly be an administrative one for exactly one role (R4).
 *
 * **The one-default invariant is the database's** (`Address_userId_default_key`,
 * a partial unique index). Nothing here checks whether a default already
 * exists before writing one; that check is precisely what two concurrent
 * requests both pass. What the service owns is the half an index cannot state —
 * which address *becomes* the default, in `default-address.ts`.
 */
@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The book: default first, then newest.
   *
   * Ordered by the API rather than by each screen, because "기본 배송지가 맨 위"
   * is a property of the answer — and because checkout (M07) reads the same list
   * and must not have to re-derive it. One statement, whatever the count (A5).
   */
  async list(principal: RequestPrincipal): Promise<AddressListResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'user.read', accountOwnership(account))

    const items = await this.prisma.address.findMany({
      where: { userId: account.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: ADDRESS_SELECT,
    })

    return { items }
  }

  /**
   * Saves an address.
   *
   * The caller's `isDefault` is a request, not the decision: the first address
   * an account saves becomes the default whatever the request said, or the book
   * would have entries and no default — a state checkout cannot preselect from
   * and the index cannot forbid (`default-address.ts`).
   */
  async create(principal: RequestPrincipal, body: AddressCreateRequest): Promise<AddressResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'profile.write', accountOwnership(account))

    const address = await refusingDuplicateDefault(() =>
      this.prisma.$transaction(async (tx) => {
        const saved = await tx.address.count({ where: { userId: account.id } })
        const isDefault = defaultOnCreate(body.isDefault ?? false, saved)

        // Clearing first, in the same transaction: the index refuses the second
        // live default, so "unset then set" is the only order that can succeed.
        if (isDefault) await clearDefault(tx, account.id)

        return tx.address.create({
          data: {
            userId: account.id,
            label: body.label ?? null,
            recipientName: body.recipientName,
            phone: body.phone,
            postalCode: body.postalCode,
            addressLine1: body.addressLine1,
            addressLine2: body.addressLine2 ?? null,
            isDefault,
          },
          select: ADDRESS_SELECT,
        })
      }),
    )

    return { address }
  }

  /**
   * Edits the fields a person types.
   *
   * `isDefault` is not among them — promotion is its own endpoint, because it is
   * a transaction that has to clear the previous default first and a partial
   * update could not carry that (`addressUpdateRequestSchema`).
   */
  async update(
    principal: RequestPrincipal,
    id: string,
    body: AddressUpdateRequest,
  ): Promise<AddressResponse> {
    const existing = await this.own(principal, id, 'profile.write')

    const address = await this.prisma.address.update({
      where: { id: existing.id },
      data: {
        label: body.label,
        recipientName: body.recipientName,
        phone: body.phone,
        postalCode: body.postalCode,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2,
      },
      select: ADDRESS_SELECT,
    })

    return { address }
  }

  /**
   * Removes an address, promoting a successor when the default goes.
   *
   * The heir is updated with `updateMany` rather than `update` so that a row a
   * concurrent delete took away is a no-op instead of a `P2025`. Two people
   * emptying one account's book at the same moment can therefore end with no
   * default at all; the next save restores it, and the alternative — locking the
   * whole book — would deadlock against the promotion path this task exists to
   * keep lock-free (TASK-0111 R3).
   */
  async remove(principal: RequestPrincipal, id: string): Promise<AddressResponse> {
    const existing = await this.own(principal, id, 'profile.write')

    const address = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.address.delete({
        where: { id: existing.id },
        select: ADDRESS_SELECT,
      })

      if (!removed.isDefault) return removed

      const remaining = await tx.address.findMany({
        where: { userId: existing.userId },
        select: { id: true, createdAt: true },
      })
      const heir = promotedAfterDelete(remaining)

      if (heir !== null) {
        await tx.address.updateMany({ where: { id: heir }, data: { isDefault: true } })
      }

      return removed
    })

    return { address }
  }

  /**
   * Makes one address the default.
   *
   * Already the default is a no-op that writes nothing: a double-clicked button
   * must not look like an index violation. Otherwise it is one transaction —
   * clear, then set — and if another request won the race in between, the index
   * refuses this one and it becomes a 409.
   */
  async makeDefault(principal: RequestPrincipal, id: string): Promise<AddressResponse> {
    const existing = await this.own(principal, id, 'profile.write')

    if (existing.isDefault) return { address: strip(existing) }

    const address = await refusingDuplicateDefault(() =>
      this.prisma.$transaction(async (tx) => {
        await clearDefault(tx, existing.userId)

        return tx.address.update({
          where: { id: existing.id },
          data: { isDefault: true },
          select: ADDRESS_SELECT,
        })
      }),
    )

    return { address }
  }

  /** The caller's own account; withdrawn ones are invisible, as everywhere. */
  private async account(userId: string): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('사용자를 찾을 수 없습니다.')

    return account
  }

  /**
   * One address, refused unless it is the caller's own.
   *
   * The row is loaded by id alone and *then* judged, rather than fetched with
   * `userId` in the `WHERE`. That is deliberate: a query scoped to the caller
   * answers 404 for somebody else's address, which reads as "no such address"
   * and is the wrong thing to tell a client — the completion criterion asks for
   * 403 and the reason to name the scope (F6).
   */
  private async own(
    principal: RequestPrincipal,
    id: string,
    permission: Permission,
  ): Promise<OwnedAddress> {
    const address = await this.prisma.address.findUnique({
      where: { id },
      select: OWNED_ADDRESS_SELECT,
    })

    if (address === null) throw new NotFoundException('배송지를 찾을 수 없습니다.')

    assertResourceAccess(principal, permission, accountOwnership(address.user))

    // The scope check above lets `profile.write:any` through, and `/me` must
    // never mean somebody else — so being the owner is required in addition to
    // being allowed. `ADMIN_SUPER` gets a 403 here, which is the point.
    if (address.userId !== principal.userId) throw accessDenied(permission, 'out_of_scope')

    return address
  }
}

/** Frees the account's default slot so that the next write can take it. */
function clearDefault(tx: Prisma.TransactionClient, userId: string): Promise<unknown> {
  return tx.address.updateMany({
    where: { userId, isDefault: true },
    data: { isDefault: false },
  })
}

/** Drops the ownership columns an answer must not carry. */
function strip(address: OwnedAddress): Address {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    postalCode: address.postalCode,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    isDefault: address.isDefault,
  }
}
