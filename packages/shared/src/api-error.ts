import { z } from 'zod'

/**
 * Error codes the transport layer produces on its own, derived from the HTTP
 * status. Domain modules add their own codes, so `apiErrorSchema` keeps `code`
 * open: a client that pattern matches on these must still handle the default.
 */
export const httpErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
])

export type HttpErrorCode = z.infer<typeof httpErrorCodeSchema>

/**
 * One `details[]` entry that names the input it is about (TASK-0117 4.1).
 *
 * Before this existed the only thing tying a failure to an input was the
 * leading word of a Korean sentence — `"slug 값이 올바르지 않습니다."` — so
 * rewording the sentence moved the error from under the field to the top of the
 * form, with every test still green because the error was still *shown*.
 *
 * `message` stays even though `code` is the thing a screen should read: a
 * catalog that has not heard of a new code would otherwise render nothing, and
 * an empty error is worse than a server-worded one.
 *
 * `params` carries the values a catalog sentence interpolates — the depth cap,
 * the name of the category a key is already defined on. They are facts only the
 * server has, and without them those two sentences would have to be the
 * server's own, which is exactly what this task removes from the screen.
 */
export const apiFieldErrorSchema = z.object({
  /** Form field path: `slug`, `attributes.0.options`. */
  field: z.string().min(1),
  /** Fallback copy, used only when the catalog has no sentence for `code`. */
  message: z.string().min(1),
  code: z.string().min(1).optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

export type ApiFieldError = z.infer<typeof apiFieldErrorSchema>

/**
 * The single error envelope every failing API response uses.
 *
 * `details` carries machine readable context (field errors, offending values
 * the caller already sent). It is always present so that clients never have to
 * test for its existence, and it never contains a stack trace outside of local
 * development.
 *
 * It stays `z.array(z.unknown())` rather than a union of string and
 * {@link apiFieldErrorSchema}. Narrowing it would make every endpoint that has
 * not been given codes yet fail its own contract check, so the whole API would
 * have to change in one commit; leaving the discrimination to the reader —
 * {@link isApiFieldError} — is what lets domains adopt codes one at a time
 * (TASK-0117 4.1, R4).
 *
 * `requestId` is the id `x-request-id` already carries, repeated in the body so
 * that a screen which cannot read the header — a cross-origin response with the
 * header not exposed, a log paste, a screenshot — still has it. It is what turns
 * "무언가 잘못됐어요" into a request QA can find in the log.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.array(z.unknown()),
    requestId: z.string().min(1),
  }),
})

export type ApiErrorBody = z.infer<typeof apiErrorSchema>

/** Narrows an unknown response body to the shared error envelope. */
export function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return apiErrorSchema.safeParse(body).success
}

/**
 * Tells a structured field error from the plain strings older endpoints send.
 *
 * The one place the discrimination lives. Every reader — the form mapper, the
 * console, a future import screen — asks this rather than duck-typing
 * `'field' in entry`, so the day the shape grows there is one file to change.
 */
export function isApiFieldError(entry: unknown): entry is ApiFieldError {
  return apiFieldErrorSchema.safeParse(entry).success
}
