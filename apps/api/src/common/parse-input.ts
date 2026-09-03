import { BadRequestException } from '@nestjs/common'
import type { ZodType } from 'zod'

interface IssueLike {
  readonly path: readonly PropertyKey[]
}

/**
 * One issue, as a Korean sentence naming the offending field.
 *
 * Zod's own messages are English and describe types ("Invalid enum value"),
 * which is neither what a user should read nor stable across versions. The field
 * path is the part a caller can act on, so that is what gets reported.
 */
function describeIssue(issue: IssueLike, label: string | undefined): string {
  const path = [label, ...issue.path.map((segment) => String(segment))]
    .filter((segment) => segment !== undefined && segment !== '')
    .join('.')

  return path === '' ? '요청 값이 올바르지 않습니다.' : `${path} 값이 올바르지 않습니다.`
}

/**
 * Validates input against a zod schema or fails the request with a 400.
 *
 * Used instead of `class-validator` because the schemas are already written in
 * zod and shared with the front-ends (`@shopping/shared`): validating with the
 * very object the client validated against is what keeps the two from drifting.
 * The failure lands in the shared error envelope as `details`, one entry per
 * issue.
 *
 * @param label Prefix for the reported path, for values that have no path of
 *   their own — a route parameter validated on its own is just `''` otherwise.
 */
export function parseInput<T>(schema: ZodType<T>, value: unknown, label?: string): T {
  const result = schema.safeParse(value)

  if (result.success) return result.data

  throw new BadRequestException({
    message: result.error.issues.map((issue) => describeIssue(issue, label)),
  })
}
