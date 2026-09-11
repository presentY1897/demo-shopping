import { Prisma } from '@prisma/client'
import type { Payment } from '@shopping/shared'

import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnershipSelect } from '../auth/resource-ownership.js'

interface PaymentView extends Omit<Payment, 'approvedAt'> {
  readonly approvedAt: Date | null
  readonly owner: AccountRow
}

// Both keys and identifiers come only from the authorization layer's constant
// select, never from a request. Do not select an entire User record into JSON.
const ownerFields = Prisma.join(
  Object.keys(accountOwnershipSelect).flatMap((column) => [
    Prisma.sql`${column}::text`,
    Prisma.sql`u.${Prisma.raw(`"${column}"`)}`,
  ]),
)

/** One statement preserves a single snapshot across the payment and its owner. */
export async function paymentView(
  db: Prisma.TransactionClient,
  id: string,
): Promise<PaymentView | undefined> {
  const rows = await db.$queryRaw<PaymentView[]>`
    SELECT p."id", p."orderId", p."provider", p."status", p."authorizedAmount",
           p."canceledAmount", p."paymentKey", p."approvedAt",
           jsonb_build_object(${ownerFields}) AS "owner",
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', r."id", 'amount', r."amount", 'reason', r."reason",
               'refundedAt', to_char(r."refundedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             ) ORDER BY r."refundedAt", r."id")
             FROM "Refund" r WHERE r."paymentId" = p."id"
           ), '[]'::jsonb) AS "refunds"
    FROM "Payment" p
    JOIN "Order" o ON o."id" = p."orderId"
    JOIN "User" u ON u."id" = o."userId"
    WHERE p."id" = ${id}::uuid
  `
  return rows[0]
}
