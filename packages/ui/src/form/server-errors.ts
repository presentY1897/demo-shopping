/**
 * Putting a failed request's `details` onto the fields it is about.
 *
 * **What the contract actually gives us.** Every failing response is
 * `{ error: { code, message, details } }` (`packages/shared/src/api-error.ts`),
 * where `details` is `z.array(z.unknown())`. `apps/api` fills it in
 * `common/parse-input.ts` — one zod issue per entry, rendered as the sentence
 * `"<dotted path> 값이 올바르지 않습니다."` — and `all-exceptions.filter.ts`
 * forwards **strings only**; any object in the payload is dropped on the way
 * out. So today there is no structured field error to read, and the leading
 * token of the sentence is the only thing that names a field.
 *
 * That is why this reader takes three shapes and prefers them in this order:
 *
 *   1. `{ field | path, message }` — what the API *should* send, and what it
 *      will send once `apiFieldErrorSchema` exists (TASK-0017 4.5, owned by
 *      TASK-0030). Handled first so the switch needs no change here.
 *   2. a string whose first whitespace-delimited token matches a known field.
 *      Best effort, and it degrades to a form-level message rather than
 *      guessing.
 *   3. the envelope's `code`, mapped by the caller — the only way to place an
 *      error the server alone can know (`SLUG_TAKEN` → `slug`).
 *
 * **Why this module does not import `@shopping/shared`.** Re-declaring the
 * envelope in `packages/ui` would be the duplicate definition contract gate C1
 * exists to prevent, and depending on the API package would drag a REST client
 * into a component library. Instead the caller — which already holds an
 * `ApiClientError` from `@shopping/shared` — hands over the two primitives:
 * `error.body?.error.details` and `error.code`.
 */

import type { ValidationErrors } from './field-errors'

export interface ServerErrorOptions {
  /** Field paths this form knows about. Nothing outside the list is placed. */
  readonly fields: readonly string[]
  /** `error.code` from the envelope, when there is one. */
  readonly code?: string | null
  /** Error code → field path, for failures only the server can detect. */
  readonly codeFields?: Readonly<Record<string, string>>
  /** Shown when `code` maps to a field but the entry carries no message of its own. */
  readonly codeMessages?: Readonly<Record<string, string>>
  /** Last resort for a failure that names nothing. Copy comes from the app. */
  readonly fallbackMessage?: string
}

interface StructuredDetail {
  readonly field: string
  readonly message: string
}

/**
 * Reads shape 1. Accepts `field` or `path`, and `path` as either a dotted
 * string or the array zod issues carry.
 */
function structuredDetail(entry: unknown): StructuredDetail | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined

  const record = entry as Record<string, unknown>
  const message = record.message
  if (typeof message !== 'string' || message === '') return undefined

  const field = record.field ?? record.path
  if (typeof field === 'string' && field !== '') return { field, message }
  if (Array.isArray(field) && field.length > 0) {
    return { field: field.map((segment) => String(segment)).join('.'), message }
  }

  return undefined
}

/**
 * Reads shape 2: the longest known field path the sentence starts with.
 *
 * Longest rather than first so that `attributes.material` wins over
 * `attributes` when both are fields of the form — a prefix match that picked
 * the shorter one would attach the message to the group instead of the input.
 */
function fieldNamedBy(sentence: string, fields: readonly string[]): string | undefined {
  // `split(sep, 1)` then `join` rather than indexing: the array is never empty,
  // so a `?? ''` fallback would be a branch no test can reach.
  const head = sentence.split(/\s/, 1).join('')
  if (head === '') return undefined

  return fields
    .filter((field) => head === field || head.startsWith(`${field}.`))
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * Splits an error envelope's `details` into per-field and form-level messages.
 *
 * Never throws and never invents a field: an entry it cannot place becomes a
 * form-level message, which `FormError` shows. Losing an error is worse than
 * showing it in the wrong place, and showing it against the wrong input is
 * worse than both.
 */
export function serverFieldErrors(
  details: readonly unknown[],
  options: ServerErrorOptions,
): ValidationErrors {
  const { fields, code, codeFields, codeMessages, fallbackMessage } = options
  const fieldErrors: Record<string, string> = {}
  const formErrors: string[] = []

  const place = (field: string, message: string): void => {
    if (!fields.includes(field)) {
      formErrors.push(message)
      return
    }
    fieldErrors[field] ??= message
  }

  for (const entry of details) {
    const structured = structuredDetail(entry)
    if (structured !== undefined) {
      place(structured.field, structured.message)
      continue
    }

    if (typeof entry !== 'string' || entry === '') continue

    const named = fieldNamedBy(entry, fields)
    if (named === undefined) formErrors.push(entry)
    else place(named, entry)
  }

  if (code != null) {
    const codeField = codeFields?.[code]
    const message = codeMessages?.[code] ?? fallbackMessage
    if (codeField !== undefined && message !== undefined) place(codeField, message)
  }

  if (Object.keys(fieldErrors).length === 0 && formErrors.length === 0) {
    if (fallbackMessage !== undefined) formErrors.push(fallbackMessage)
  }

  return { fieldErrors, formErrors }
}
