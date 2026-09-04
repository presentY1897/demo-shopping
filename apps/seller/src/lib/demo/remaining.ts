/**
 * How much of a demo is left, and how a sentence is filled in (TASK-0024 4.6).
 *
 * Pure, and takes `now` as an argument rather than reading the clock: the banner
 * re-renders every minute for twenty-four hours, and a function that read the
 * clock itself could only be tested by moving the process clock — which
 * `docs/tasks/QUALITY-GATES.md` 6장 rules out for exactly the reason that bites
 * here (the value being compared against comes from the server).
 *
 * **Minutes are the smallest unit shown.** Counting seconds would re-render the
 * whole shell once a second for a day, and on a twenty-four hour expiry a second
 * is not information.
 */

const MINUTE_MS = 60_000

export interface Remaining {
  readonly expired: boolean
  readonly hours: number
  readonly minutes: number
}

/**
 * Time left, floored to the minute.
 *
 * An unparseable instant counts as expired. It is the safer answer of the two:
 * saying "끝났어요" about a live demo is a sentence the visitor can act on by
 * getting another account, while saying "23시간 남음" about a `NaN` is a
 * promise nothing keeps.
 */
export function remainingOf(expiresAt: string, now: number): Remaining {
  const left = Date.parse(expiresAt) - now

  if (!Number.isFinite(left) || left <= 0) return { expired: true, hours: 0, minutes: 0 }

  const minutes = Math.floor(left / MINUTE_MS)

  return { expired: false, hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

/**
 * Fills `{name}` placeholders in a catalog sentence.
 *
 * The copy owns the word order — "23시간 12분 남음" is one sentence in Korean and
 * would be three concatenated fragments in another locale — so the numbers are
 * handed to the catalog rather than assembled here (CLAUDE.md 6장: 문구 하드코딩
 * 금지). An unknown placeholder is left as it was written, which shows up in the
 * screen instead of disappearing into an empty string.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key]

    return value === undefined ? whole : String(value)
  })
}
