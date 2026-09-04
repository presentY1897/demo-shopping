import {
  demoAccountSchema,
  demoIssueResponseSchema,
  demoStatusResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * Demo accounts, one per persona (TASK-0024).
 *
 * **`expiresAt` is a fixed far-future instant**, for the reason
 * `fixtures/session.ts` gives about `accessExpiresAt`: a fixture is parsed once
 * at module load and frozen, so a value computed from the clock would be minutes
 * old by the time a slow spec file reached it. A spec about a banner that says
 * "3시간 남음" builds its own instant — how much time is left is a property of
 * that test, not of the contract.
 */
const FAR_FUTURE = '2099-01-01T00:00:00.000Z'

/** What `shop` issues, and what its banner is drawn from. */
export const demoBuyerAccount = defineFixture(demoAccountSchema, {
  role: 'BUYER',
  expiresAt: FAR_FUTURE,
})

export const demoSellerAccount = defineFixture(demoAccountSchema, {
  role: 'SELLER',
  expiresAt: FAR_FUTURE,
})

export const demoAdminAccount = defineFixture(demoAccountSchema, {
  role: 'ADMIN',
  expiresAt: FAR_FUTURE,
})

/** `POST /auth/demo` on the happy path. The cookie is the mock's session store. */
export const demoIssuedBuyer = defineFixture(demoIssueResponseSchema, {
  demo: { role: 'BUYER', expiresAt: FAR_FUTURE },
})

/** `GET /auth/demo` for a demo account. */
export const demoStatusBuyer = defineFixture(demoStatusResponseSchema, {
  demo: { role: 'BUYER', expiresAt: FAR_FUTURE },
})

/**
 * `GET /auth/demo` for a real account — the answer the banner draws nothing for.
 *
 * The default of the mock store, so a spec gets it by saying nothing.
 */
export const demoStatusReal = defineFixture(demoStatusResponseSchema, { demo: null })
