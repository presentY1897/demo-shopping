import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { DemoRole } from '@shopping/shared'

import { SellerService } from '../sellers/seller.service.js'
import { createDemoAccount } from './demo-account.js'
import { cloneCatalogIntoDemoStore } from './demo-catalog-clone.js'
import { demoBrandName, demoEmail, demoName, demoSlug } from './demo-identity.js'

/**
 * What a freshly issued account already has in it (TASK-0024 4.7).
 *
 * A visitor handed an empty account sees "데이터 없음" on every screen, and a
 * feature nobody can see is a feature that was not demonstrated. So each persona
 * arrives with the rows its console reads.
 *
 * **The list is the shape, on purpose.** Most of what the approved task
 * described cannot be written yet — orders, coupons, points, virtual cards,
 * settlements, reviews and wishlists have no tables until M07~M13 — so the
 * seeders are a list per persona and the tasks that create those tables add an
 * entry to it. That is the retrieval mechanism the task document names, and it
 * is the reason this is a list of functions rather than one long method.
 *
 * Everything here runs **inside the caller's transaction**. A demo account whose
 * store was created but whose products were not is a half-built demonstration
 * that nothing would ever repair, and the visitor would have no way to ask for
 * another one — they are already signed in as the broken account.
 */

/** What a seeder is given: the account being built, and when. */
export interface DemoSeedContext {
  readonly tx: Prisma.TransactionClient
  readonly userId: string
  readonly now: Date
  /** The same instant every account created by this issue expires at. */
  readonly expiresAt: Date
  /** Unique per issue; the names and slugs are derived from it. */
  readonly token: string
}

export type DemoSeeder = (context: DemoSeedContext) => Promise<void>

/** How many applications an admin demo finds waiting (TASK-0024 4.7). */
export const DEMO_PENDING_APPLICATIONS = 2

@Injectable()
export class DemoSeedService {
  constructor(private readonly sellers: SellerService) {}

  /**
   * Everything a persona starts with, in order.
   *
   * Built here rather than as a module constant because two of them need a
   * service. Adding what M07 owes this path is one more entry in one of these
   * arrays.
   */
  private readonly seeders: Readonly<Record<DemoRole, readonly DemoSeeder[]>> = {
    BUYER: [seedShippingAddress, seedPreference],
    SELLER: [this.seedStore.bind(this), seedClonedCatalogue],
    ADMIN: [seedPendingApplications],
  }

  async seed(role: DemoRole, context: DemoSeedContext): Promise<void> {
    for (const seeder of this.seeders[role]) {
      await seeder(context)
    }
  }

  /**
   * The store, already approved (D-058 · TASK-0108 F7).
   *
   * Goes through `SellerService` rather than inserting a row, because approval
   * is not only a status: `ACTIVE` and the `SELLER_OWNER` grant are one
   * transaction there, and a demo store assembled here would be free to drift
   * from the shape the reviewed path produces.
   */
  private async seedStore(context: DemoSeedContext): Promise<void> {
    await this.sellers.openDemoStore(
      {
        userId: context.userId,
        brandName: demoBrandName(context.token),
        slug: demoSlug(context.token),
        introduction: '체험용으로 열린 스토어예요. 상품을 자유롭게 고치고 지워 보세요.',
      },
      context.tx,
    )
  }
}

/**
 * One shipping address, marked default.
 *
 * `isDefault` on the only address is what `Address_userId_default_key` allows
 * exactly one of, and what every checkout screen from M07 will read.
 */
async function seedShippingAddress(context: DemoSeedContext): Promise<void> {
  await context.tx.address.create({
    data: {
      userId: context.userId,
      label: '집',
      recipientName: '체험 구매자',
      phone: '010-0000-0000',
      postalCode: '06234',
      addressLine1: '서울특별시 강남구 테헤란로 1',
      addressLine2: '데모빌딩 10층',
      isDefault: true,
      createdAt: context.now,
      updatedAt: context.now,
    },
  })
}

/**
 * The display settings row.
 *
 * Written rather than left to appear on first save, because `apps/shop` promotes
 * whatever density the visitor chose while signed out into the account
 * (`docs/design/pages.md` 46행) — and a row that does not exist yet makes that
 * promotion the first write of a demo session instead of a no-op.
 */
async function seedPreference(context: DemoSeedContext): Promise<void> {
  await context.tx.userPreference.create({
    data: { userId: context.userId, createdAt: context.now, updatedAt: context.now },
  })
}

/** The twelve listings, copied. Zero of them when the catalogue is empty (F2c). */
async function seedClonedCatalogue(context: DemoSeedContext): Promise<void> {
  const store = await context.tx.seller.findUnique({
    where: { userId: context.userId },
    select: { id: true },
  })

  // Unreachable: the store seeder runs first and throws if it could not open
  // one. Kept because "unreachable" here depends on the order of an array.
  if (store === null) throw new Error('데모 스토어가 만들어지지 않았습니다.')

  await cloneCatalogIntoDemoStore(context.tx, { sellerId: store.id, now: context.now })
}

/**
 * Applications for the demo administrator to decide (TASK-0024 4.9).
 *
 * **Each one is owned by its own demo account, and that is the whole point.**
 * `DEMO_ADMIN` narrows every write to the `demo` scope, so a queue containing
 * only real applicants is a queue the visitor may look at and never touch — the
 * admin console would be a read-only shell for everybody who tried it. These two
 * rows are what make 승인 a button that works (F3b), and the same mechanism is
 * what refuses the real applicant sitting next to them (F4).
 *
 * They expire with the account that found them, so the sweep takes all three.
 */
async function seedPendingApplications(context: DemoSeedContext): Promise<void> {
  for (let index = 0; index < DEMO_PENDING_APPLICATIONS; index += 1) {
    const token = `${context.token}${String(index)}`
    const applicantId = await createDemoAccount(context.tx, {
      email: demoEmail('SELLER', token),
      name: demoName('SELLER'),
      expiresAt: context.expiresAt,
      // No `SELLER_OWNER`: the role is what approval grants, and granting it
      // here would make the button the visitor is meant to press a no-op.
      roles: [],
      now: context.now,
    })

    await context.tx.seller.create({
      data: {
        userId: applicantId,
        brandName: demoBrandName(token),
        slug: demoSlug(token),
        introduction: '심사 체험용으로 만들어진 입점 신청이에요. 승인하거나 반려해 보세요.',
        status: 'PENDING',
        statusChangedAt: context.now,
        createdAt: context.now,
        updatedAt: context.now,
      },
    })
  }
}
