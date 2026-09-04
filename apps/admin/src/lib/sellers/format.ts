import { formatDate } from '@shopping/ui/format'

/**
 * How this console writes an instant.
 *
 * Both options are passed rather than left to the runtime, and the time zone is
 * the one that matters: omitted, a server render formats in the container's zone
 * (UTC) and the browser in the operator's, so the same application shows two
 * different days depending on who rendered it (`packages/ui/src/format/date.ts`).
 * The stories use the same pair.
 */
const CONSOLE_DATE_OPTIONS = { locale: 'ko-KR', timeZone: 'Asia/Seoul' } as const

/** A day — what "신청일" needs; the hour would be noise in a queue. */
export function reviewDate(value: string): string {
  return formatDate(value, CONSOLE_DATE_OPTIONS)
}

/**
 * A day and a time, or `fallback` when the API answered `null`.
 *
 * `statusChangedAt` is nullable (`sellerSchema`) — a row written by a seed
 * rather than by a decision has never moved — and an empty cell there would read
 * as a rendering bug rather than as "아직 없음".
 */
export function reviewDateTime(value: string | null, fallback: string): string {
  return value === null
    ? fallback
    : formatDate(value, { ...CONSOLE_DATE_OPTIONS, style: 'dateTime' })
}
