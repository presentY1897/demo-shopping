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
 * The single error envelope every failing API response uses.
 *
 * `details` carries machine readable context (field errors, offending values
 * the caller already sent). It is always present so that clients never have to
 * test for its existence, and it never contains a stack trace outside of local
 * development.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.array(z.unknown()),
  }),
})

export type ApiErrorBody = z.infer<typeof apiErrorSchema>

/** Narrows an unknown response body to the shared error envelope. */
export function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return apiErrorSchema.safeParse(body).success
}
