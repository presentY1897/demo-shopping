import type { ApiFieldError, DomainErrorCode } from '@shopping/shared'
import type { PathParams } from 'msw'
import { HttpResponse } from 'msw'
import type { z } from 'zod'

import { apiErrorBody, mockResponseHeaders } from '../failures'

/**
 * How a mocked endpoint refuses, in the shape the real API refuses in.
 *
 * Extracted from `handlers/categories.ts` when the attribute endpoints arrived
 * (TASK-0031). Not because two callers is a lot, but because this is the mock's
 * half of the **error contract**: `error.code` on the envelope, `details[].field`
 * on the entry, a request id on both. A second copy of that would be a second
 * answer to "what does a refusal look like", and the whole point of TASK-0117 is
 * that there is one.
 *
 * `apps/api/src/common/domain-failure.ts` is the shape being reproduced.
 */

/** What the status alone says, for a refusal that names no domain code. */
const ERROR_ENVELOPES: Readonly<
  Record<number, { readonly code: string; readonly message: string }>
> = {
  400: { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다.' },
  404: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' },
  409: { code: 'CONFLICT', message: '다른 요청과 충돌해 처리하지 못했습니다.' },
}

const FALLBACK_ENVELOPE = { code: 'BAD_REQUEST', message: '요청을 처리할 수 없습니다.' } as const

export interface RefusalOptions {
  /** The domain code, when this refusal has one. Lands on `error.code`. */
  readonly code?: DomainErrorCode
  /** The input at fault. Produces the `details[]` entry a form places. */
  readonly field?: string
  readonly params?: Readonly<Record<string, string | number>>
  /**
   * More entries, for a refusal that names several problems with one input.
   *
   * `PATCH /attributes/:id` answers this way when the option list disagrees with
   * the stored type: one entry per rule, each carrying `INVALID` and the field
   * (`AttributeService.update`). A single `field` could not say that.
   */
  readonly entries?: readonly ApiFieldError[]
}

/**
 * A refusal on its way out of a store, shaped exactly as the API shapes one.
 *
 * Before TASK-0117 the reason lived only in a Korean sentence in `details`,
 * because that was all the API sent — so a screen telling a taken key from a
 * lost optimistic lock had to read prose or guess from the HTTP method it had
 * used. Now the code is on the envelope and the field is on the entry, and this
 * double has to produce both or the front-end specs would be passing against an
 * API that no longer exists.
 */
export class MockApiError extends Error {
  readonly code: DomainErrorCode | undefined
  readonly field: string | undefined
  readonly params: Readonly<Record<string, string | number>> | undefined
  readonly extra: readonly ApiFieldError[] | undefined

  constructor(
    readonly status: number,
    readonly detail: string,
    options: RefusalOptions = {},
  ) {
    super(detail)
    this.name = 'MockApiError'
    this.code = options.code
    this.field = options.field
    this.params = options.params
    this.extra = options.entries
  }

  /** The `details[]` entries, or none for a refusal about no particular input. */
  entries(): readonly (ApiFieldError | string)[] {
    if (this.extra !== undefined) return this.extra
    if (this.field === undefined) return this.code === undefined ? [this.detail] : []

    return [
      {
        field: this.field,
        message: this.detail,
        ...(this.code === undefined ? {} : { code: this.code }),
        ...(this.params === undefined ? {} : { params: this.params }),
      },
    ]
  }
}

export function errorResponse(error: MockApiError): Response {
  const fallback = ERROR_ENVELOPES[error.status] ?? FALLBACK_ENVELOPE
  const code = error.code ?? fallback.code
  const message = error.code === undefined ? fallback.message : error.detail

  return HttpResponse.json(apiErrorBody(code, message, error.entries()), {
    status: error.status,
    headers: mockResponseHeaders,
  })
}

/**
 * Turns a `MockApiError` into the envelope; anything else is a real bug and is
 * left to fail the spec loudly.
 *
 * Starting from a resolved promise rather than calling `work` directly is what
 * lets a synchronous resolver throw: a store's refusals are plain `throw`s, and
 * half of the handlers have nothing to await.
 */
export function answering(work: () => Response | Promise<Response>): Promise<Response> {
  return Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      if (error instanceof MockApiError) return errorResponse(error)
      throw error
    })
}

/**
 * Parses a request body with the shared schema; anything else is a 400.
 *
 * The mock validates its input for the same reason the controller does: a
 * screen that sent a malformed body and was answered anyway would pass here and
 * fail against the real API (gate C1 read from the request side).
 */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json())

  if (!parsed.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

  return parsed.data
}

/** The `:id` segment of a route, as the number every one of these routes uses. */
export function pathId(params: PathParams): number {
  const raw = params.id

  return Number(Array.isArray(raw) ? raw[0] : raw)
}
