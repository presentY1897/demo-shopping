import type { AppId } from '@shopping/shared'
import { appIds } from '@shopping/shared'

/** Where each web app lives, or `null` for one this deployment cannot reach. */
export type AppOrigins = Readonly<Record<AppId, string | null>>

/** The ports the three apps listen on locally, from `scripts/ports.mjs`. */
export type WebPorts = Readonly<Record<AppId, number>>

/**
 * Loopback spellings, in the order a redirect should prefer them.
 *
 * `derived-env.ts` allows both because a browser may be pointed at either, but
 * a `Location` header has to name one — and `localhost` is what the dev scripts
 * print and what a person has in their address bar.
 */
const LOOPBACK = ['localhost', '127.0.0.1'] as const

/** The first label of an origin's hostname: `seller` of `seller.example.com`. */
function hostLabel(origin: string): string | null {
  let hostname: string

  try {
    hostname = new URL(origin).hostname
  } catch {
    return null
  }

  const dot = hostname.indexOf('.')

  // Both halves are ordinary: a deployment has subdomains, and `localhost` has
  // no dot at all. Written with `indexOf` rather than `split(...)[0]` because
  // that form needs a `?? null` the compiler wants and no input can reach.
  return dot < 0 ? hostname : hostname.slice(0, dot)
}

function matchesPort(origin: string, port: number, hostname: string): boolean {
  try {
    const url = new URL(origin)
    return url.hostname === hostname && url.port === String(port)
  } catch {
    return false
  }
}

/**
 * Picks each app's origin out of the CORS allow list.
 *
 * **Choosing from the allow list is the whole point.** The OAuth callback ends
 * in a redirect whose target comes from a query parameter the caller supplied,
 * which is the shape of every open-redirect bug there has ever been. Selecting
 * from a list the operator already vetted makes the bug unrepresentable: an
 * origin that is not in `CORS_ORIGINS` cannot be produced by this function, so
 * there is no input that reaches an attacker's site. It also means no new
 * environment variable — and no second list to drift from the first.
 *
 * Two rules, because the two environments name apps differently:
 *
 * | environment | origins look like | matched by |
 * | --- | --- | --- |
 * | deployed | `https://seller.demo-shopping.com` | the first host label |
 * | local | `http://localhost:3007` | the port from `scripts/ports.mjs` |
 *
 * The label rule runs first so that a deployment is never at the mercy of a
 * derived port, and so that a custom local domain (`seller.localhost`, say)
 * works without special-casing.
 *
 * An app that matches nothing answers `null` rather than falling back to
 * another app's origin. Sending a seller to the shop after a successful sign-in
 * would look like a bug in the sign-in; refusing to start one is a sentence an
 * operator can act on (TASK-0021 F10).
 */
export function resolveAppOrigins(
  corsOrigins: readonly string[],
  webPorts: WebPorts | null,
): AppOrigins {
  const entries = appIds.map((app): readonly [AppId, string | null] => {
    const byLabel = corsOrigins.find((origin) => hostLabel(origin) === app)
    if (byLabel !== undefined) return [app, byLabel]

    if (webPorts === null) return [app, null]

    for (const hostname of LOOPBACK) {
      const byPort = corsOrigins.find((origin) => matchesPort(origin, webPorts[app], hostname))
      if (byPort !== undefined) return [app, byPort]
    }

    return [app, null]
  })

  return Object.fromEntries(entries) as AppOrigins
}
