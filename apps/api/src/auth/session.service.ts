import { createHash, randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import type { AppId } from '@shopping/shared'
import { isAppId, isRole } from '@shopping/shared'
import type { Prisma } from '@prisma/client'
import { ClientApp, Role } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { JwtClaims } from './jwt.js'
import { signJwt } from './jwt.js'
import type { RequestPrincipal } from './request-principal.js'

/**
 * How long a just-rotated token still counts as a retry rather than a replay
 * (TASK-0022 4장).
 *
 * Two tabs refreshing at once, or one `fetch` retried after a dropped
 * connection, present the same token twice. Calling that theft logs a real
 * person out — which happens far more often than the attack it would be
 * protecting against.
 */
const REUSE_GRACE_MS = 10_000

/** 256 bits. The token is never stored, only its digest. */
const REFRESH_TOKEN_BYTES = 32

const CLIENT_APP: Readonly<Record<AppId, ClientApp>> = {
  shop: ClientApp.SHOP,
  seller: ClientApp.SELLER,
  admin: ClientApp.ADMIN,
}

export interface IssuedSession {
  readonly accessToken: string
  /** The plaintext, which exists only in this response. */
  readonly refreshToken: string
  readonly accessExpiresAt: Date
  /**
   * Who the session belongs to.
   *
   * Returned with the session rather than looked up again by the caller: the
   * roles in the response body have to be the ones baked into the token, and a
   * second query could answer differently the moment an admin grants a role
   * between the two.
   */
  readonly owner: SessionOwner
}

export interface SessionOwner {
  readonly userId: string
  readonly roles: readonly Role[]
  readonly sellerId: string | null
}

export type RefreshFailure =
  /** No row has this digest — a forged token, or one already swept away. */
  | 'unknown'
  /** Well-formed and ours, but past `expiresAt`. */
  | 'expired'
  /** Revoked longer ago than the grace window. Treated as theft. */
  | 'reused'

export type RefreshOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly reason: RefreshFailure }

export interface SessionRequestMeta {
  readonly userAgent?: string
  readonly ipAddress?: string
}

/**
 * Sessions: issuing, rotating, and recognising a replay (TASK-0022).
 *
 * **Two different kinds of token, on purpose.** The access token is a JWT, so a
 * request can be authorised without touching the database. The refresh token is
 * opaque random bytes whose *digest* is stored, because rotation and reuse
 * detection have to consult the database anyway and a self-contained token has
 * no way to express "revoked".
 *
 * **The account's roles are copied into the access token.** That is what makes
 * it self-contained, and it means a grant made elsewhere — a seller approved in
 * TASK-0108 — is not visible until the token is refreshed. Fifteen minutes is
 * the ceiling on that staleness, and it is the same trade that lets an
 * authorised request cost no query.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * `Secure` on the refresh cookie wherever the API is actually on https.
   *
   * Read from here rather than decided by each controller, so the sign-in
   * callback and the renewal endpoint cannot disagree — a cookie set with one
   * set of attributes and cleared with another is a cookie that never goes away.
   */
  cookieOptions(): { readonly secure: boolean } {
    return { secure: this.config.isProduction }
  }

  /**
   * Starts a session. Called by the OAuth callback (TASK-0021 ⑤).
   *
   * `client` lets a caller mint the token **inside its own transaction**. Demo
   * issuing (TASK-0024 4.3) needs it for two reasons: an account committed
   * without a session is a demo nobody can use and nothing repairs, and the
   * issue rate limit counts this very row — so a token written after the
   * account's own commit would be invisible to a request racing it. Omitting
   * the argument is exactly the behaviour every existing caller already had.
   */
  issue(
    owner: SessionOwner,
    app: AppId,
    meta: SessionRequestMeta = {},
    client?: Prisma.TransactionClient,
  ): Promise<IssuedSession> {
    return this.mint(owner, app, meta, client)
  }

  /**
   * Exchanges a refresh token for a new pair.
   *
   * The presented token is always spent: on the happy path it is revoked and
   * replaced, and on the theft path it takes the rest of the app's sessions
   * with it. There is no path where a caller may present the same token twice
   * and keep going indefinitely.
   */
  async refresh(
    app: AppId,
    presented: string,
    meta: SessionRequestMeta = {},
  ): Promise<RefreshOutcome> {
    const now = this.clock.now()
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: digest(presented) },
      select: {
        id: true,
        userId: true,
        app: true,
        expiresAt: true,
        revokedAt: true,
      },
    })

    // Also covers a token for another app: the cookie name keeps them apart in
    // the browser (D-218), and this keeps them apart if one ever arrives anyway.
    if (existing?.app !== CLIENT_APP[app]) {
      return { ok: false, reason: 'unknown' }
    }

    // **Expiry is checked before revocation, and that order is the security
    // property.** Ending a session — a logout, or theft detection — sets
    // `expiresAt` to now as well as `revokedAt`, so the grace window below
    // cannot resurrect it. Without this order the window protects the tokens a
    // theft *just killed*: the victim's own token would rotate into a fresh one
    // seconds after the session was supposed to be over, and the detection
    // would have accomplished nothing.
    if (existing.expiresAt <= now) {
      await this.end(existing.id, now)
      return { ok: false, reason: 'expired' }
    }

    if (existing.revokedAt !== null) {
      // The window is measured from the *original* revocation, never refreshed
      // by another attempt — otherwise a replay could hold it open forever.
      if (now.getTime() - existing.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.revokeApp(existing.userId, app, now)
        return { ok: false, reason: 'reused' }
      }
    } else {
      // Conditional on still being live, so two concurrent refreshes cannot both
      // believe they were the one that rotated it.
      await this.prisma.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now },
      })
    }

    const owner = await this.ownerOf(existing.userId)
    if (owner === null) return { ok: false, reason: 'unknown' }

    return { ok: true, session: await this.mint(owner, app, meta) }
  }

  /**
   * Ends this app's session.
   *
   * Revokes **every** live token for the pair rather than only the one
   * presented: a retry inside the grace window leaves two live rows behind, and
   * logging out has to end the session rather than one of its halves.
   */
  async logout(app: AppId, presented: string | undefined): Promise<void> {
    if (presented === undefined) return

    const now = this.clock.now()
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: digest(presented) },
      select: { userId: true, app: true },
    })

    if (existing?.app !== CLIENT_APP[app]) return

    await this.revokeApp(existing.userId, app, now)
  }

  /**
   * Ends every app's session for the account behind this token.
   *
   * Takes a token rather than a user id because that is the caller's proof of
   * identity: the endpoint above is reachable without a live access token, on
   * purpose (`session.controller.ts`).
   */
  async logoutEverywhere(app: AppId, presented: string | undefined): Promise<number> {
    if (presented === undefined) return 0

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: digest(presented) },
      select: { userId: true, app: true },
    })

    if (existing?.app !== CLIENT_APP[app]) return 0

    return this.logoutAll(existing.userId)
  }

  /** Ends every app's session for one account. */
  async logoutAll(userId: string): Promise<number> {
    const now = this.clock.now()
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      // Expired as well as revoked, for the same reason `revokeApp` does it:
      // a logged-out token must not land inside the retry grace window.
      data: { revokedAt: now, expiresAt: now },
    })

    return count
  }

  /**
   * Deletes rows nothing can present any more.
   *
   * Revoked rows are kept until they expire — that is what lets a replay be
   * recognised instead of merely missing (`schema.prisma`).
   */
  async sweepExpired(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lte: this.clock.now() } },
    })

    return count
  }

  private async mint(
    owner: SessionOwner,
    app: AppId,
    meta: SessionRequestMeta,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedSession> {
    const now = this.clock.now()
    const issuedAt = Math.floor(now.getTime() / 1000)
    const accessExpiresAt = new Date((issuedAt + this.config.auth.accessTokenTtlSeconds) * 1000)
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')

    await client.refreshToken.create({
      data: {
        userId: owner.userId,
        app: CLIENT_APP[app],
        tokenHash: digest(refreshToken),
        expiresAt: new Date(now.getTime() + this.config.auth.refreshTokenTtlSeconds * 1000),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    })

    const claims: JwtClaims = {
      sub: owner.userId,
      iat: issuedAt,
      exp: issuedAt + this.config.auth.accessTokenTtlSeconds,
      app,
      roles: owner.roles,
      sellerId: owner.sellerId,
    }

    return {
      accessToken: signJwt(claims, this.config.auth.jwtSecret),
      refreshToken,
      accessExpiresAt,
      owner,
    }
  }

  /**
   * Ends every live session of one app.
   *
   * Sets `expiresAt` as well as `revokedAt`. A row revoked by *rotation* keeps
   * its original expiry and is therefore still inside the retry grace window;
   * a row revoked because the session ended must not be, or the very tokens a
   * theft just invalidated would rotate into new ones (see `refresh`).
   */
  private revokeApp(userId: string, app: AppId, now: Date): Promise<unknown> {
    return this.prisma.refreshToken.updateMany({
      where: { userId, app: CLIENT_APP[app], revokedAt: null },
      data: { revokedAt: now, expiresAt: now },
    })
  }

  /** Ends one row, for a token that arrived after its own expiry. */
  private end(id: string, now: Date): Promise<unknown> {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: now, expiresAt: now },
    })
  }

  private async ownerOf(userId: string): Promise<SessionOwner | null> {
    const user = await this.prisma.user.findFirst({
      // A withdrawn account keeps its rows for order history but must not be
      // able to sign in again (`erd.md` 2장).
      where: { id: userId, deletedAt: null },
      select: { id: true, roles: { select: { role: true } }, seller: { select: { id: true } } },
    })

    if (user === null) return null

    return {
      userId: user.id,
      roles: user.roles.map((entry) => entry.role),
      sellerId: user.seller?.id ?? null,
    }
  }
}

/** SHA-256, hex. The token itself is never written anywhere. */
function digest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Rebuilds the caller from a verified token's claims.
 *
 * **Every field is checked even though the signature already passed.** A valid
 * signature proves the claims are ours, not that they are still shaped the way
 * this version of the code expects — a token signed before a claim was renamed
 * is authentic and wrong, and it stays in circulation for the whole access
 * lifetime after a deploy. Answering `null` puts that request back on the
 * anonymous path instead of building a principal with an `undefined` role in it.
 */
export function principalFromClaims(claims: JwtClaims): RequestPrincipal | null {
  const { app, roles, sellerId } = claims

  if (!isAppId(app)) return null
  if (!Array.isArray(roles) || !roles.every(isRole)) return null
  if (sellerId !== null && typeof sellerId !== 'string') return null

  return { userId: claims.sub, roles, sellerId, app }
}
