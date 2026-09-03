import { httpErrorCodeSchema } from '../api-error.js'
import type { HttpErrorCode } from '../api-error.js'

/**
 * Codes a domain module raises on purpose, as opposed to the ones
 * {@link httpErrorCodeSchema} derives from an HTTP status.
 *
 * **Why they exist at all.** A status says how the transport ended; it does not
 * say what happened. `POST /categories`, `PATCH /categories/:id` and
 * `DELETE /categories/:id` can all answer 409, and until this list existed the
 * only thing separating "the address is taken" from "somebody saved first" from
 * "there are still children under it" was a Korean sentence — which a screen
 * then had to read, and which nobody could edit without breaking it silently
 * (TASK-0117 1장).
 *
 * **Why one list, in `packages/shared`.** The API throws these strings and each
 * app's message catalog is keyed by them. Two copies would let a typo become a
 * failure with no sentence at all, which is the failure mode nothing reports:
 * the request still fails, the screen still shows *something*, and no test is
 * red. Same reason gate C1 keeps the response schemas here.
 */
export const domainErrorCodes = [
  /**
   * The caller is not signed in.
   *
   * Replaces `UNAUTHORIZED`'s "인증 정보가 없어…" because what a person needs is
   * the next action, not the state of a header (TASK-0117 4.3).
   */
  'AUTH_REQUIRED',
  /**
   * One input did not pass the schema. Carried on a `details[]` entry, next to
   * the `field` it is about — never on the envelope, where it would say nothing
   * a 400 does not already say.
   */
  'INVALID',
  'CATEGORY_SLUG_TAKEN',
  'CATEGORY_VERSION_CONFLICT',
  'CATEGORY_HAS_CHILDREN',
  'CATEGORY_MAX_DEPTH',
  'CATEGORY_MOVE_INTO_SELF',
  'CATEGORY_REORDER_MISMATCH',
  'CATEGORY_PARENT_MISSING',
  'ATTRIBUTE_KEY_TAKEN',
  /**
   * Not in TASK-0117 4.2's table, and deliberately added: the attribute editor
   * loses the same race a category editor does, and leaving one of the two as a
   * bare `CONFLICT` would make "카탈로그 도메인의 실패는 코드를 갖는다" false in
   * exactly one place — the kind of exception that is never found again.
   */
  'ATTRIBUTE_VERSION_CONFLICT',
] as const

export type DomainErrorCode = (typeof domainErrorCodes)[number]

/**
 * Every code a message catalog has to answer for.
 *
 * An app types its `errors` slice as `Record<UserFacingErrorCode, string>`, so
 * adding a code without adding a sentence fails `pnpm typecheck` rather than
 * showing a blank line to whoever hit the error (TASK-0117 4.7 J2).
 */
export const userFacingErrorCodes = [...httpErrorCodeSchema.options, ...domainErrorCodes] as const

export type UserFacingErrorCode = HttpErrorCode | DomainErrorCode

export function isDomainErrorCode(value: string): value is DomainErrorCode {
  return (domainErrorCodes as readonly string[]).includes(value)
}
