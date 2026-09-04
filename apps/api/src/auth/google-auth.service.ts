import { Inject, Injectable, Logger } from '@nestjs/common'
import type { AppId, OauthFailureReason, OauthNotice, OauthResult } from '@shopping/shared'
import { buildOauthRedirect } from '@shopping/shared'
import { Prisma, Role } from '@prisma/client'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { GoogleOAuthClient, GoogleProfile } from './google-oauth.client.js'
import { GOOGLE_OAUTH, GoogleOAuthError } from './google-oauth.client.js'
import type { OauthState } from './oauth-state.js'
import { newStateToken, statesMatch } from './oauth-state.js'

/** Postgres unique violation — the partial index on a live `googleSub`. */
const UNIQUE_VIOLATION = 'P2002'

/**
 * The consoles a plain buyer has no business landing in.
 *
 * Signing in still succeeds — D-016 keeps role grants out of the login path, so
 * "no role yet" is the normal state of every new account — but the app is told,
 * and TASK-0023 turns that into a sentence instead of an empty console.
 */
const REQUIRED_ROLES: Readonly<Partial<Record<AppId, readonly Role[]>>> = {
  seller: [Role.SELLER_OWNER],
  admin: [Role.ADMIN_OPERATOR, Role.ADMIN_SUPER, Role.DEMO_ADMIN],
}

export interface SignedInUser {
  readonly userId: string
  readonly roles: readonly Role[]
}

export interface CallbackOutcome {
  /** Where to send the browser. Always an origin from the allow list. */
  readonly redirectTo: string
  /** `null` when the sign-in did not produce one; TASK-0022 reads this. */
  readonly user: SignedInUser | null
}

/**
 * The Google authorization code flow, minus the session (TASK-0021).
 *
 * **What this service deliberately does not do.** It issues no token and sets no
 * session cookie. Step ⑤ of the flow belongs to TASK-0022, so when this runs to
 * completion the browser lands back on the app with a `User` row behind it and
 * no way to prove who it is. {@link CallbackOutcome.user} is the seam that task
 * fills; nothing else about this file has to move.
 *
 * **Every path ends in a redirect.** The callback is an address a browser opens
 * directly, so answering with the JSON error envelope would show a person raw
 * JSON — which is precisely what F5 forbids. The reason travels as a query
 * parameter and the operator's copy goes to the log (R4).
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GOOGLE_OAUTH) private readonly google: GoogleOAuthClient,
  ) {}

  /**
   * The redirect URI registered with Google — one address for all three apps.
   *
   * Built from the origin the browser actually reached rather than from a
   * configured value, because Google compares it byte for byte against what it
   * was given at `begin` **and** against what is registered in the console. A
   * fourth environment variable would be a third place for those to disagree,
   * and the symptom of disagreement is `redirect_uri_mismatch` — an error page
   * on Google's domain, where none of our logging can see it.
   *
   * A forged `Host` fails closed: it produces a URI that is not registered, so
   * Google refuses to redirect there and the code never leaves its own domain.
   */
  callbackUrl(apiOrigin: string): string {
    return `${apiOrigin}/api/v1/auth/google/callback`
  }

  /**
   * The origin this request arrived on.
   *
   * The scheme comes from the configuration rather than from `req.protocol`:
   * Render terminates TLS at its edge, so the protocol Express sees is `http`
   * unless the proxy is trusted, and a `http://api.demo-shopping.com/...`
   * redirect URI matches nothing that is registered.
   */
  apiOriginOf(host: string | undefined): string {
    const scheme = this.config.isProduction ? 'https' : 'http'

    return `${scheme}://${host ?? `localhost:${String(this.config.port)}`}`
  }

  /** `Secure` on the state cookie everywhere the API is actually on https. */
  cookieOptions(): { readonly secure: boolean } {
    return { secure: this.config.isProduction }
  }

  /**
   * Where an app's sign-in page lives, or `null` when this deployment has no
   * such app.
   *
   * Public so the controller can refuse before doing any work: an app with no
   * origin has nowhere to be sent back to, and inventing one is how an open
   * redirect is born (F10).
   */
  originOf(app: AppId): string | null {
    return this.config.appOrigins[app]
  }

  /** Starts a sign-in: the consent URL, and the state to remember it by. */
  begin(
    app: AppId,
    apiOrigin: string,
  ): { readonly authorizeUrl: string; readonly state: OauthState } {
    const state: OauthState = { app, state: newStateToken() }

    return {
      authorizeUrl: this.google.authorizeUrl({
        redirectUri: this.callbackUrl(apiOrigin),
        state: state.state,
      }),
      state,
    }
  }

  /**
   * Finishes a sign-in.
   *
   * The caller has already matched the cookie to the query — that check decides
   * *where* a failure can be sent, so it cannot live in here, which needs the
   * answer before it can build a redirect.
   */
  async complete(params: {
    readonly cookie: OauthState
    readonly queryState: string | undefined
    readonly code: string | undefined
    readonly googleError: string | undefined
    readonly requestId: string | undefined
    readonly apiOrigin: string
  }): Promise<CallbackOutcome> {
    const origin = this.originOf(params.cookie.app)
    // Unreachable in practice: the app came out of a cookie this process wrote,
    // and `begin` refuses an app with no origin. Kept because "unreachable"
    // depends on a caller doing its part, and the alternative is a crash.
    if (origin === null) throw new Error(`no origin for app ${params.cookie.app}`)

    if (params.queryState === undefined || !statesMatch(params.queryState, params.cookie.state)) {
      return this.fail(origin, 'state_mismatch', params.requestId)
    }

    // A person who declined. Not a failure — the only honest thing to do is put
    // them back where they started without an error anywhere on screen (F5).
    if (params.googleError !== undefined) {
      return { redirectTo: this.redirect(origin, { status: 'cancelled' }), user: null }
    }

    if (params.code === undefined) return this.fail(origin, 'exchange_failed', params.requestId)

    let profile: GoogleProfile
    try {
      const tokens = await this.google.exchangeCode({
        code: params.code,
        redirectUri: this.callbackUrl(params.apiOrigin),
      })
      profile = await this.google.fetchProfile(tokens.accessToken)
    } catch (error) {
      const stage = error instanceof GoogleOAuthError ? error.stage : 'exchange'
      return this.fail(
        origin,
        stage === 'profile' ? 'profile_failed' : 'exchange_failed',
        params.requestId,
        error,
      )
    }

    const user = await this.upsertUser(profile)
    const notice = this.noticeFor(params.cookie.app, user.roles)

    return {
      redirectTo: this.redirect(origin, { status: 'ok', notice }),
      user,
    }
  }

  /**
   * Finds the account behind a Google identity, creating it on first sign-in.
   *
   * **The race is settled by the database, not by this code.** Two callbacks for
   * the same new account can both find nothing and both try to insert; the
   * partial unique index `User_googleSub_active_key` fails one of them, and the
   * loser reads the winner's row. A check-then-insert without that index would
   * produce two accounts for one person, and the second one would own an empty
   * order history (TASK-0021 F7).
   *
   * `googleSub` goes in with the insert because `User_google_identity_check`
   * requires it of every live real account — there is no valid intermediate row
   * to create and fill in afterwards.
   */
  private async upsertUser(profile: GoogleProfile): Promise<SignedInUser> {
    const now = this.clock.now()

    const existing = await this.findByGoogleSub(profile.sub, now)
    if (existing !== null) return existing

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            googleSub: profile.sub,
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.picture,
            lastLoginAt: now,
          },
          select: { id: true },
        })

        // Same transaction as the account: a user row with no role is a person
        // who can sign in and do nothing, and nothing would ever repair it.
        await tx.userRole.create({ data: { userId: created.id, role: Role.BUYER } })

        return { userId: created.id, roles: [Role.BUYER] }
      })
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== UNIQUE_VIOLATION
      ) {
        throw error
      }

      // Lost the race. The winner's row is the answer.
      const winner = await this.findByGoogleSub(profile.sub, now)
      if (winner === null) throw error

      return winner
    }
  }

  private async findByGoogleSub(sub: string, now: Date): Promise<SignedInUser | null> {
    const user = await this.prisma.user.findFirst({
      // Matches the partial index: a withdrawn account releases its identity so
      // the same person can sign up again (`erd.md` 2장).
      where: { googleSub: sub, deletedAt: null },
      select: { id: true, roles: { select: { role: true } } },
    })

    if (user === null) return null

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } })

    return { userId: user.id, roles: user.roles.map((entry) => entry.role) }
  }

  private noticeFor(app: AppId, roles: readonly Role[]): OauthNotice | undefined {
    const required = REQUIRED_ROLES[app]
    if (required === undefined) return undefined

    return required.some((role) => roles.includes(role)) ? undefined : 'no_role'
  }

  private fail(
    origin: string,
    reason: OauthFailureReason,
    requestId: string | undefined,
    error?: unknown,
  ): CallbackOutcome {
    // The person gets a reason they can act on; the correlatable detail stays
    // here, where an operator can find it (R4).
    this.logger.warn({ message: 'google sign-in failed', reason, requestId, error })

    return { redirectTo: this.redirect(origin, { status: 'error', reason }), user: null }
  }

  private redirect(origin: string, result: OauthResult): string {
    return buildOauthRedirect(origin, result)
  }
}
