import { isApiFieldError } from '@shopping/shared'

import type { ApiFailure } from '@/lib/api-failure'

/**
 * Reading a seller refusal, which means reading `details[].field`.
 *
 * **The field is the only discriminator there is.** TASK-0108 deliberately added
 * no domain error codes — the two consoles' catalogs are
 * `Record<UserFacingErrorCode, string>`, so a new code obliges an edit in two
 * apps that belong to other tasks — and so `PATCH /sellers/me` answers a lost
 * optimistic lock and a brand name somebody else took with the *same* envelope:
 * 409 `CONFLICT`. What separates them is that the first names `version` and the
 * second names `brandName`.
 *
 * That is not a workaround. `version` is not an input on this form, so a message
 * placed on it would have nowhere to go, and the screen owes the reader a
 * different thing in each case: one is "somebody saved first, here is what to do
 * about it", the other is "this name is taken, pick another" under the input
 * they typed it in.
 */

/** The inputs this form can place a server message on. */
export const STORE_FIELD_NAMES = ['brandName', 'slug', 'introduction', 'logoUrl'] as const

/** Every field a failure names, in the order the server listed them. */
export function refusedFields(failure: ApiFailure): readonly string[] {
  if (failure.kind !== 'http') return []

  return failure.details.filter(isApiFieldError).map((entry) => entry.field)
}

/**
 * A 409 the reader resolves by reloading rather than by retyping.
 *
 * The status is checked as well as the field so that a hypothetical 400 about a
 * malformed `version` — which is a bug in this console, not a race — does not
 * put a "somebody saved first" banner in front of somebody it never happened to.
 */
export function isVersionConflict(failure: ApiFailure): boolean {
  return (
    failure.kind === 'http' && failure.status === 409 && refusedFields(failure).includes('version')
  )
}

/** The account has never applied. `GET /sellers/me` says so with a 404. */
export function isMissingStore(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.status === 404
}
