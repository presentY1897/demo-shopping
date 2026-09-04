import type { UserFacingErrorCode } from '@shopping/shared'

/**
 * `code` → the sentence this console shows (TASK-0117 4.2).
 *
 * **Why the seller console has one now.** TASK-0117 4.7 J6 deliberately gave the
 * `errors` slice to `apps/admin` only: the other two apps had nothing but a
 * health panel, and a catalog nobody reads drifts from the API in silence. The
 * image upload widget is the first screen here that meets a refusal it has to
 * explain — 401 while signed out, 403 for somebody else's store, 503 while the
 * bucket is unconfigured — so the condition that kept the slice out no longer
 * holds.
 *
 * **Why the type is exhaustive.** `Record<UserFacingErrorCode, string>` means a
 * code added to `@shopping/shared` without a sentence here fails `pnpm
 * typecheck`. The alternative — a partial record — fails at runtime, in front of
 * whoever hit the error, as a blank line.
 *
 * **No placeholders.** `apps/admin` interpolates `params` into two of its
 * sentences (the depth cap, the category a key is taken on); nothing a seller
 * can reach needs that, and a template engine with no templates would be a
 * second copy of a mechanism for the sake of symmetry. If a seller screen ever
 * needs one, that is when the interpolation moves somewhere both consoles can
 * import — it should not be duplicated to make this file look like the other.
 */
export type ErrorMessages = Readonly<Record<UserFacingErrorCode, string>>

/**
 * This console's sentence for one code, or `undefined` when it has none.
 *
 * `undefined` rather than a generic line: the caller knows what to fall back to
 * — the server's own sentence, which is exactly what it is for.
 */
export function errorMessage(messages: ErrorMessages, code: string): string | undefined {
  return (messages as Record<string, string>)[code]
}
