/**
 * Putting a failed request's `details` onto the fields it is about.
 *
 * **What the contract gives us.** Every failing response is
 * `{ error: { code, message, details, requestId } }`
 * (`packages/shared/src/api-error.ts`), where `details` is
 * `z.array(z.unknown())` holding two shapes at once: an `apiFieldError`
 * — `{ field, message, code?, params? }` — for a failure that names an input,
 * and a plain string for one that names none. Both on purpose: endpoints adopt
 * codes one at a time, and narrowing the array would force them all at once
 * (TASK-0117 4.1).
 *
 * **What this module used to have to do, and no longer does.** Before
 * TASK-0117 `apps/api` sent sentences only — `"slug 값이 올바르지 않습니다."` —
 * and the leading token was the sole statement of which input had failed. So
 * this reader split on whitespace and matched the first word against the form's
 * fields. It worked, and it broke the moment somebody wrote "슬러그 형식이…":
 * the error moved from under the input to the top of the form, and no test
 * noticed, because the error was still *shown*.
 *
 * That inference is still here, and it is now a **fallback rather than a rule**.
 * The order is:
 *
 *   1. `{ field | path, message, code?, params? }` — what the API sends today.
 *      When any entry has this shape, **no string in the same array is guessed
 *      at**: the server has said which inputs it means, and guessing beside a
 *      precise answer can only contradict it. Unplaceable strings still get
 *      shown, at the form level.
 *   2. the leading token of a string, but only when the response carried no
 *      structured entry at all — an endpoint that has not been given codes yet.
 *   3. the envelope's `code`, mapped by the caller — the only way to place a
 *      failure the server alone can detect that names no field of its own.
 *
 * **Where the copy comes from.** `messageForCode` is the app's catalog, handed
 * in as a function. `packages/ui` holds no Korean and knows no error codes
 * (CLAUDE.md 6장), and a component library that shipped sentences would be the
 * one place a product's wording could not be changed without a release.
 *
 * **Why this module does not import `@shopping/shared`.** Re-declaring the
 * envelope in `packages/ui` would be the duplicate definition contract gate C1
 * exists to prevent, and depending on the API package would drag a REST client
 * into a component library. Instead the caller — which already holds an
 * `ApiClientError` from `@shopping/shared` — hands over the primitives:
 * `error.details` and `error.code`.
 */

import type { ValidationErrors } from './field-errors'

/** Values a catalog sentence interpolates, as the envelope carries them. */
export type ServerErrorParams = Readonly<Record<string, string | number>>

export interface ServerErrorOptions {
  /** Field paths this form knows about. Nothing outside the list is placed. */
  readonly fields: readonly string[]
  /** `error.code` from the envelope, when there is one. */
  readonly code?: string | null
  /** Error code → field path, for failures only the server can detect. */
  readonly codeFields?: Readonly<Record<string, string>>
  /**
   * The app's message catalog, as a lookup.
   *
   * Asked for every code that arrives — on a `details` entry and on the
   * envelope. Returning `undefined` means "no copy for this code", and the
   * server's own sentence is used instead, which is what keeps a code the app
   * has never heard of from rendering as an empty error.
   */
  readonly messageForCode?: (code: string, params?: ServerErrorParams) => string | undefined
  /** Last resort for a failure that names nothing. Copy comes from the app. */
  readonly fallbackMessage?: string
}

interface StructuredDetail {
  readonly field: string
  readonly message: string
  readonly code: string | undefined
  readonly params: ServerErrorParams | undefined
}

/** A `params` bag, or `undefined` for anything that is not a plain object. */
function paramsOf(value: unknown): ServerErrorParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

  return value as ServerErrorParams
}

function codeOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
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

  const rest = { message, code: codeOf(record.code), params: paramsOf(record.params) }
  const field = record.field ?? record.path

  if (typeof field === 'string' && field !== '') return { field, ...rest }
  if (Array.isArray(field) && field.length > 0) {
    return { field: field.map((segment) => String(segment)).join('.'), ...rest }
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
  const { fields, code, codeFields, messageForCode, fallbackMessage } = options
  const fieldErrors: Record<string, string> = {}
  const formErrors: string[] = []

  const place = (field: string, message: string): void => {
    if (!fields.includes(field)) {
      formErrors.push(message)
      return
    }
    fieldErrors[field] ??= message
  }

  /** The app's word for this failure, or the server's if the app has none. */
  const copyFor = (detail: StructuredDetail): string =>
    (detail.code === undefined ? undefined : messageForCode?.(detail.code, detail.params)) ??
    detail.message

  const structured = details
    .map(structuredDetail)
    .filter((detail): detail is StructuredDetail => detail !== undefined)

  for (const detail of structured) place(detail.field, copyFor(detail))

  for (const entry of details) {
    if (typeof entry !== 'string' || entry === '') continue

    // Guessing is only allowed when the server named nothing. Beside a
    // structured entry a guess can only contradict it, and the string is still
    // shown — at the form level, where being unplaced is honest.
    const named = structured.length > 0 ? undefined : fieldNamedBy(entry, fields)

    if (named === undefined) formErrors.push(entry)
    else place(named, entry)
  }

  if (code != null) {
    const codeField = codeFields?.[code]
    const message = messageForCode?.(code) ?? fallbackMessage
    if (codeField !== undefined && message !== undefined) place(codeField, message)
  }

  if (Object.keys(fieldErrors).length === 0 && formErrors.length === 0) {
    if (fallbackMessage !== undefined) formErrors.push(fallbackMessage)
  }

  return { fieldErrors, formErrors }
}
