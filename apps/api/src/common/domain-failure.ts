import type { ApiFieldError, DomainErrorCode } from '@shopping/shared'
import { apiFieldErrorSchema, domainErrorCodes } from '@shopping/shared'
import { z } from 'zod'

/**
 * The payload a domain module hands its `HttpException` (TASK-0117 4.7 J3).
 *
 * Nest lets an exception carry any object and `AllExceptionsFilter` decides what
 * of it reaches the caller. Until now the only thing it forwarded was a
 * sentence, so `throw new ConflictException('이미 사용 중인 슬러그입니다.')` was
 * the whole vocabulary — and a screen wanting to tell that conflict from a lost
 * optimistic lock had nothing but the Korean to go on.
 *
 * A payload carrying `code` is what marks a failure as *deliberate*: the filter
 * lifts the code onto the envelope and uses the sentence as the envelope's
 * message. A payload without one is left exactly as it was, which is what keeps
 * every endpoint that has not been given codes working unchanged (F9).
 */
export interface DomainFailurePayload {
  readonly code: DomainErrorCode
  /**
   * The server's own sentence.
   *
   * A last resort, not the thing a screen shows: an app's catalog answers `code`
   * with copy written for its readers. It exists so that a catalog which has
   * never heard of a new code renders *something* instead of an empty box.
   */
  readonly message: string
  /** One entry per input the failure is about. Empty when it is about none. */
  readonly details: readonly ApiFieldError[]
}

/**
 * Recognises a payload built by {@link domainFailure}.
 *
 * Structural rather than branded: the payload crosses `HttpException.getResponse()`
 * as a plain object, and validating it here means the filter can never forward a
 * `details` entry that does not match the contract — including one some future
 * caller assembled by hand.
 */
const domainFailureSchema = z.object({
  // The declared list, not any string: the envelope's `code` is what an app's
  // catalog is keyed by, and a code outside the list has no sentence anywhere.
  // Failing to match here falls back to the status-derived code, which at least
  // renders.
  code: z.enum(domainErrorCodes),
  message: z.string().min(1),
  details: z.array(apiFieldErrorSchema),
})

export interface DomainFailureOptions {
  /** The input this failure is about — `slug`, `parentId`, `orderedIds`. */
  readonly field?: string
  /** Values the reader's catalog sentence interpolates. Requires `field`. */
  readonly params?: Readonly<Record<string, string | number>>
}

/**
 * Builds the payload for a failure the domain names.
 *
 * `field` is optional because not every refusal is about an input: "there are
 * still categories under this one" is about the state of the thing, and inventing
 * a field for it would put an error under a control nobody touched.
 */
export function domainFailure(
  code: DomainErrorCode,
  message: string,
  options: DomainFailureOptions = {},
): DomainFailurePayload {
  const { field, params } = options

  if (field === undefined) return { code, message, details: [] }

  return {
    code,
    message,
    details: [{ field, message, code, ...(params === undefined ? {} : { params }) }],
  }
}

/** The domain payload behind an exception, or `null` for anything else. */
export function domainFailureOf(payload: unknown): DomainFailurePayload | null {
  const parsed = domainFailureSchema.safeParse(payload)

  return parsed.success ? parsed.data : null
}
