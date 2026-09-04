import { randomBytes } from 'node:crypto'

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { AppId, DemoAccount, DemoRole } from '@shopping/shared'
import { DEMO_ACCOUNT_TTL_HOURS } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { SessionOwner, SessionRequestMeta } from '../auth/session.service.js'
import { SessionService } from '../auth/session.service.js'
import { createDemoAccount } from './demo-account.js'
import { demoEmail, demoName, demoToken } from './demo-identity.js'
import { DEMO_GRANTS, demoRoleOfGrants } from './demo-persona.js'
import {
  DEMO_ISSUE_COUNT_SQL,
  DEMO_ISSUE_LOCK_CLASS,
  DEMO_ISSUE_LOCK_SQL,
  issueAddress,
  windowStart,
  withinLimit,
} from './demo-rate-limit.js'
import { DemoSeedService } from './demo-seed.service.js'

/**
 * How long an interactive transaction may take before Prisma abandons it.
 *
 * Raised from the 5 second default because the seller persona copies a whole
 * catalogue inside it. The requirement it has to fit under is F1 — five seconds
 * to a signed-in state — so this is a ceiling that catches a hung statement, not
 * a budget anybody is meant to spend.
 */
const ISSUE_TIMEOUT_MS = 15_000

export interface IssuedDemo {
  readonly demo: DemoAccount
  /** The plaintext refresh token, which exists only in this response. */
  readonly refreshToken: string
}

/**
 * Issuing a demo account, and answering how long one has left (TASK-0024).
 *
 * **The whole issue is one transaction** — account, roles, seeded rows, the
 * store, and the refresh token. Two reasons, and the second is easy to miss:
 *
 * 1. There is no repair for a half-built demo. The visitor is already signed in
 *    as the account that is missing its store, and asking for another one is not
 *    something the screen offers.
 * 2. The rate limit counts the session row (`demo-rate-limit.ts`). If the
 *    account committed before the token was written, a concurrent request would
 *    count the window as one issue shorter than it is.
 *
 * **The limit is decided under an advisory lock keyed by the address.** Counting
 * and inserting is a read followed by a write, and two requests from one address
 * can both read four. Different addresses take different keys and never wait on
 * each other.
 */
@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly seeds: DemoSeedService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `Secure` on the refresh cookie wherever the API is on https. */
  cookieOptions(): { readonly secure: boolean } {
    return this.sessions.cookieOptions()
  }

  /**
   * Creates an account, fills it, and starts a session for it.
   *
   * Answers the refresh token rather than a session body: the response carries
   * only the cookie, so the access token this mints inside would have nowhere to
   * go (TASK-0024 4.1).
   */
  async issue(role: DemoRole, app: AppId, meta: SessionRequestMeta = {}): Promise<IssuedDemo> {
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + DEMO_ACCOUNT_TTL_HOURS * 60 * 60 * 1000)
    const token = demoToken((size) => randomBytes(size))
    const address = issueAddress(meta.ipAddress)

    return this.prisma.$transaction(
      async (tx) => {
        await this.reserveIssue(tx, address, now)

        const userId = await createDemoAccount(tx, {
          email: demoEmail(role, token),
          name: demoName(role),
          expiresAt,
          roles: DEMO_GRANTS[role],
          now,
        })

        await this.seeds.seed(role, { tx, userId, now, expiresAt, token })

        const session = await this.sessions.issue(
          await ownerOf(tx, userId),
          app,
          // The address is what the limit above will count next time, so it is
          // written whether or not the caller sent a user agent.
          { ...meta, ipAddress: address },
          tx,
        )

        return {
          demo: { role, expiresAt: expiresAt.toISOString() },
          refreshToken: session.refreshToken,
        }
      },
      { timeout: ISSUE_TIMEOUT_MS },
    )
  }

  /**
   * The caller's own demo status, or `null` when they are a real account.
   *
   * Reads `demoExpiresAt` and never the boolean beside it — the two imply each other
   * (`User_demo_expiry_check`) and the expiry is the value the banner actually
   * needs (TASK-0024 4.5).
   */
  async statusOf(userId: string): Promise<DemoAccount | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { demoExpiresAt: true, roles: { select: { role: true } } },
    })

    if (user?.demoExpiresAt == null) return null

    return {
      role: demoRoleOfGrants(user.roles.map((entry) => entry.role)),
      expiresAt: user.demoExpiresAt.toISOString(),
    }
  }

  /**
   * Takes this address's slot, or refuses the request.
   *
   * The lock is held for the rest of the transaction, so the account and the
   * session row this decision was made about are committed before the next
   * request from the same address is allowed to count.
   */
  private async reserveIssue(
    tx: Prisma.TransactionClient,
    address: string,
    now: Date,
  ): Promise<void> {
    // `$executeRawUnsafe`, not `$queryRawUnsafe`: the lock function returns
    // `void`, which Prisma's row decoder has no mapping for (the same line
    // `CategoryService` carries).
    await tx.$executeRawUnsafe(DEMO_ISSUE_LOCK_SQL, DEMO_ISSUE_LOCK_CLASS, address)

    const rows = await tx.$queryRawUnsafe<{ issued: number }[]>(
      DEMO_ISSUE_COUNT_SQL,
      windowStart(now),
      address,
    )

    if (!withinLimit(rows[0]?.issued ?? 0)) throw tooManyIssues()
  }
}

/**
 * The 429.
 *
 * A bare `HttpException` with a sentence rather than a domain code: `TOO_MANY_REQUESTS`
 * is already in `httpErrorCodeSchema`, so the envelope names it from the status
 * and every app's catalog already answers for it. A new domain code would oblige
 * three message catalogs to grow a sentence for a refusal that has exactly one
 * meaning (TASK-0117 4.2's rule for when a code is worth adding).
 */
function tooManyIssues(): HttpException {
  return new HttpException(
    '데모 계정을 너무 자주 발급했어요. 잠시 후 다시 시도해 주세요.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}

/**
 * The freshly created account, in the shape `SessionService` mints a token for.
 *
 * Read back inside the transaction rather than assembled from what was just
 * written: a seeder may have granted a role — `SELLER_OWNER` arrives with the
 * store — and a token minted from the roles this method knew about would be
 * missing it until the first refresh.
 */
async function ownerOf(tx: Prisma.TransactionClient, userId: string): Promise<SessionOwner> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, roles: { select: { role: true } }, seller: { select: { id: true } } },
  })

  return {
    userId: user.id,
    roles: user.roles.map((entry) => entry.role),
    sellerId: user.seller?.id ?? null,
  }
}
