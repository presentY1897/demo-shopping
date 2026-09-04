import type { ErrorParams } from '@/lib/errors'
import { interpolate } from '@/lib/errors'

/**
 * `'{name} 에서 물려받음'` + `{ name: '여성' }` → `'여성 에서 물려받음'`.
 *
 * The same placeholder syntax the error catalog uses, because a console with two
 * ways of writing a hole in a sentence gets one of them wrong.
 *
 * {@link interpolate} answers `undefined` when a placeholder has no value, which
 * is right for an error message — falling back to the server's own sentence
 * beats rendering `{max}` at somebody. Here there is no second sentence to fall
 * back to, so the template is shown as it stands: a label reading `{name}` is
 * visibly a bug, while a label with the placeholder silently deleted reads as
 * merely awkward Korean and survives review.
 */
export function fill(template: string, params: ErrorParams): string {
  return interpolate(template, params) ?? template
}
