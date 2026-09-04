import type { ApiFieldError } from '../api-error.js'
import { isApiFieldError } from '../api-error.js'
import type { UserFacingErrorCode } from './error-codes.js'

/**
 * `code` → the sentence a person reads (TASK-0117 4.2).
 *
 * **Why the copy is not on the API.** The server has to keep sending a sentence
 * — a catalog that has never heard of a new code would otherwise render an empty
 * error — but it must not be the sentence a person reads, because the server's
 * vocabulary is the implementation's: `slug`, `orderedIds`, the fact that an
 * endpoint exists. An app's is the reader's: 주소, 순서, 카테고리.
 *
 * **Why the type is exhaustive.** `Record<UserFacingErrorCode, string>` means a
 * code added to this package without a sentence in an app fails `pnpm
 * typecheck`. The alternative — a partial record — fails at runtime, in front of
 * whoever hit the error, as a blank line (4.7 J2).
 *
 * **Not every app has to take this type.** `apps/shop` deliberately keeps a
 * partial catalog: TASK-0023 refused it an exhaustive one on the grounds that a
 * storefront meeting a single refusal would get fifteen lines with one reachable
 * sentence. {@link failureMessage} therefore asks only for a string-keyed record,
 * and this alias is what the two consoles declare their own catalogs as.
 */
export type ErrorMessages = Readonly<Record<UserFacingErrorCode, string>>

/** Values a sentence interpolates, as the envelope carries them. */
export type ErrorParams = Readonly<Record<string, string | number>>

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * `'카테고리는 {max}단계까지만'` + `{ max: 3 }` → `'카테고리는 3단계까지만'`.
 *
 * Returns `undefined` when a placeholder has no value. Rendering `{max}` to a
 * person would be worse than falling back to the server's own sentence, and
 * silently dropping the placeholder would produce "카테고리는 단계까지만" —
 * grammatical nonsense that reads like a bug in the product rather than in the
 * message.
 *
 * A template with no placeholders comes back unchanged, which is why
 * {@link failureMessage} can run this unconditionally: for the two catalogs that
 * carry no `{자리}` at all it is the identity function (D-219).
 */
export function interpolate(template: string, params?: ErrorParams): string | undefined {
  let missing = false

  const filled = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params?.[name]

    if (value === undefined) {
      missing = true
      return ''
    }

    return String(value)
  })

  return missing ? undefined : filled
}

/**
 * An app's sentence for one code, or `undefined` when it has none.
 *
 * `undefined` rather than a generic line: the caller knows what to fall back to
 * — usually the server's own sentence, which is exactly what it is for.
 *
 * The catalog is typed loosely here on purpose. Callers hold either an
 * exhaustive {@link ErrorMessages} or a partial record, and both index the same
 * way; a mapped type over a literal union is assignable to `Record<string,
 * string>`, so neither has to cast at the call site.
 */
export function errorMessage(
  messages: Readonly<Record<string, string>>,
  code: string,
  params?: ErrorParams,
): string | undefined {
  const template: string | undefined = messages[code]

  return template === undefined ? undefined : interpolate(template, params)
}

/**
 * The first structured entry in an envelope's `details`.
 *
 * Where the interpolation values live: the envelope carries the code, and the
 * entry carries the facts the sentence needs (`params.max`, `params.name`).
 */
export function firstFieldError(details: readonly unknown[]): ApiFieldError | undefined {
  return details.find((entry): entry is ApiFieldError => isApiFieldError(entry))
}

/** The values the sentence for this failure interpolates, if any came. */
export function paramsOf(details: readonly unknown[]): ErrorParams | undefined {
  return firstFieldError(details)?.params
}
