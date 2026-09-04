import type { AppId, DemoAccount, DemoRole } from '@shopping/shared'
import { demoIssueResponseSchema, demoStatusResponseSchema } from '@shopping/shared'

import { APP_ID, getApiClient } from '@/lib/api'

/**
 * Getting a demo account, and asking how long one has left (TASK-0024).
 *
 * **The fourth copy of a thing that should be one.** `session-client.ts`,
 * `auth-context.tsx` and `authorization.ts` are already triplicated for the
 * reason `docs/HANDOFF.md` 3.5 records — the merge needs all three apps opened
 * at once and no screen task owns that — and this file joins them rather than
 * inventing a fourth arrangement. It is byte-identical in the three apps; the
 * only thing that differs is `APP_ID`, which the table below reads.
 *
 * **The persona is derived from the app, not chosen by the caller.** The API
 * refuses a mismatch (`DemoController`), and a button that could ask for the
 * wrong one would be a button whose only possible mistake is invisible: the
 * session would be issued into a cookie this console never reads.
 */
const ROLE_BY_APP = {
  shop: 'BUYER',
  seller: 'SELLER',
  admin: 'ADMIN',
} as const satisfies Readonly<Record<AppId, DemoRole>>

/** What this app's demo button asks for. */
export const DEMO_ROLE: DemoRole = ROLE_BY_APP[APP_ID]

/**
 * Issues an account and leaves the browser holding a refresh cookie.
 *
 * **It does not sign anybody in by itself.** The response carries no access
 * token on purpose (TASK-0024 4.1), so the caller renews afterwards — which is
 * `useAuth().recheck()`, the same call the sign-in round trip already makes.
 */
export async function issueDemoAccount(): Promise<DemoAccount> {
  const { demo } = await getApiClient().request({
    path: '/auth/demo',
    method: 'POST',
    body: { role: DEMO_ROLE },
    schema: demoIssueResponseSchema,
  })

  return demo
}

/**
 * The signed-in account's demo status, or `null` for a real account.
 *
 * A request of its own rather than a field on the session, because the banner
 * has to survive a reload and the session contract is TASK-0022's (4.2). The
 * cost is one small read per app boot for a signed-in visitor.
 */
export async function readDemoAccount(): Promise<DemoAccount | null> {
  const { demo } = await getApiClient().request({
    path: '/auth/demo',
    schema: demoStatusResponseSchema,
  })

  return demo
}
