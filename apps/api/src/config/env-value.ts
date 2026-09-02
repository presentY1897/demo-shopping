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
