import type { DisplayDensity } from '@shopping/shared'
import type { DensityLevel } from '@shopping/ui'

/**
 * The two names one display density goes by, and when a stored one is promoted.
 *
 * **Why the table is here and not in a package** (TASK-0112 4장). `@shopping/ui`
 * calls a density `1 | 2 | 3`, because that is what `data-density` carries and
 * what every CSS token keys off. `@shopping/shared` calls it
 * `MINIMAL | STANDARD | MAXIMAL`, because that is the Prisma enum the column
 * holds. Neither is wrong and neither can own the join: putting it in
 * `packages/ui` would teach a component library the API's vocabulary, and
 * putting it in `packages/shared` would teach an API package how a stylesheet
 * addresses a step. `apps/shop` is the only app with a toggle at all (D-033),
 * so the app is where the two meet.
 *
 * Nothing here touches React, the DOM or the network — it is a pair of lookups
 * and one decision, so the decision can be tested by calling it.
 */

const TO_LEVEL: Readonly<Record<DisplayDensity, DensityLevel>> = {
  MINIMAL: 1,
  STANDARD: 2,
  MAXIMAL: 3,
}

/**
 * Typed as an exhaustive record in both directions, which is the point: a
 * fourth step added to either side stops `pnpm typecheck` here rather than
 * silently rendering at the default.
 */
const TO_DENSITY: Readonly<Record<DensityLevel, DisplayDensity>> = {
  1: 'MINIMAL',
  2: 'STANDARD',
  3: 'MAXIMAL',
}

export function densityLevelOf(density: DisplayDensity): DensityLevel {
  return TO_LEVEL[density]
}

export function displayDensityOf(level: DensityLevel): DisplayDensity {
  return TO_DENSITY[level]
}

/**
 * What to send to `PATCH /me/preferences` when a session begins, or `null` for
 * "nothing to promote".
 *
 * **The whole of the promotion rule** (`pages.md` — 밀도 승격). A visitor who is
 * not signed in stores a step in localStorage; without this, signing in would
 * silently snap them back to whatever the account last held — usually the
 * untouched default — and the choice they made two clicks ago would vanish with
 * no explanation.
 *
 * Three answers, and the middle one is the reason this is a function rather
 * than an `if` at the call site:
 *
 * | localStorage | 서버 | 결과 |
 * | --- | --- | --- |
 * | 없음 | 무엇이든 | `null` — 올릴 것이 없다. **서버 값이 그대로 이긴다** |
 * | 있고 서버와 같음 | 같음 | `null` — 같은 값을 쓰는 요청은 요청이 아니다 |
 * | 있고 서버와 다름 | 다름 | 저장돼 있던 값. 방금 고른 쪽이 이긴다 |
 *
 * **It is not "the newer of the two".** Neither side carries a timestamp the
 * other can be compared against, and inventing one would mean trusting a clock
 * the client owns. What the rule actually says is narrower and true: a value in
 * localStorage was put there by somebody using *this browser*, and this is the
 * first moment the account could hear about it.
 */
export function densityToPromote(
  stored: DensityLevel | null,
  server: DisplayDensity,
): DisplayDensity | null {
  if (stored === null) return null

  const asDensity = displayDensityOf(stored)

  return asDensity === server ? null : asDensity
}
