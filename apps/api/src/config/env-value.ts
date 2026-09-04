/**
 * Absent and empty mean the same thing for an environment variable: an env file
 * that contains `API_PORT=` has not configured a port, it has left a blank.
 */
export function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

/** First value that is actually set, or `undefined` when none is. */
export function firstSet(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => !isBlank(value))
}

/**
 * {@link isBlank} with the narrowing a caller usually wants.
 *
 * A plain boolean leaves the value `string | undefined` afterwards, so the
 * caller writes `?? ''` to satisfy the compiler — and that fallback is a branch
 * no input can reach, which is worse than the check it replaced: it cannot be
 * tested, and a 100% branch threshold then has to be lowered for it.
 */
export function isSet(value: string | undefined): value is string {
  return !isBlank(value)
}
