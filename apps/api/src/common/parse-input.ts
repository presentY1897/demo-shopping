import { BadRequestException } from '@nestjs/common'
import type { ApiFieldError } from '@shopping/shared'
import type { ZodType } from 'zod'

interface IssueLike {
  readonly path: readonly PropertyKey[]
}

/**
 * One issue, as a `details[]` entry naming the offending field.
 *
 * **`field` is the part that matters.** Zod's own messages are English and
 * describe types ("Invalid enum value"), which is neither what a person should
 * read nor stable across versions — so the sentence here has always been ours.
 * The problem it left behind was that the sentence was *all* there was: the
 * only machine-readable statement of which input failed was the fact that the
 * path happened to be the first word, and a form on the other side recovered it
 * by splitting on whitespace (TASK-0117 1장). It now travels as `field`, and the
 * sentence is a fallback for a catalog that has no copy for `INVALID`.
 *
 * An issue with no path at all — a refinement over the whole body — has no field
 * to name, so it stays a plain string. `details` holds both shapes on purpose
 * (`apiErrorSchema`), and the reader tells them apart with `isApiFieldError`.
 *
 * @param label Prefix for the reported path, for values that have no path of
 *   their own — a route parameter validated on its own is just `''` otherwise.
 */
function describeIssue(issue: IssueLike, label: string | undefined): ApiFieldError | string {
  const field = [label, ...issue.path.map((segment) => String(segment))]
    .filter((segment) => segment !== undefined && segment !== '')
    .join('.')

  if (field === '') return '요청 값이 올바르지 않습니다.'

  return { field, message: `${field} 값이 올바르지 않습니다.`, code: 'INVALID' }
}

/**
 * Validates input against a zod schema or fails the request with a 400.
 *
 * Used instead of `class-validator` because the schemas are already written in
 * zod and shared with the front-ends (`@shopping/shared`): validating with the
 * very object the client validated against is what keeps the two from drifting.
 * The failure lands in the shared error envelope as `details`, one entry per
 * issue.
 */
export function parseInput<T>(schema: ZodType<T>, value: unknown, label?: string): T {
  const result = schema.safeParse(value)

  if (result.success) return result.data

  throw new BadRequestException({
    message: result.error.issues.map((issue) => describeIssue(issue, label)),
  })
}
