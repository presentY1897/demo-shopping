/**
 * Whether the first-visit nudge towards the density toggle is still owed.
 *
 * TASK-0018 R1: the toggle is the point of difference of this storefront and a
 * visitor who never notices it never sees the feature. The nudge is shown once —
 * to someone who has never chosen a step — and never again after it is
 * dismissed or a step is picked.
 *
 * Two keys rather than one, and neither is a component's state: the choice
 * itself belongs to `@shopping/ui/density` (it is what the boot script reads
 * before first paint), and this only records that the *explanation* has been
 * seen. Merging them would mean writing a density the visitor never asked for.
 *
 * Every access is wrapped: reading localStorage throws outright in Safari's
 * private mode and wherever site data is blocked, and a hint is not worth taking
 * a storefront down for.
 */

import { DENSITY_STORAGE_KEY } from '@shopping/ui'
import { readStoredDensity } from '@shopping/ui/density'

export const DENSITY_HINT_KEY = 'shopping.shop.density.hint'

/**
 * `<html>` 에 붙는 표시. **CSS 가 이것을 보고 안내를 그린다** (TASK-0097 F1).
 *
 * 이 안내는 자리를 밀지 않는다(절대 배치라 CLS 는 0 이다). 미룬 대가는 다른 데서
 * 나왔다 — 마운트 뒤에 그려지느라 **이 문단이 화면에서 가장 큰 것이 그려진 시각을
 * 정하고 있었다.** 여섯 화면 전부에서 LCP 는 이 안내였고 2.7~4.5초였는데, 같은
 * 실행의 Speed Index 는 0.76초였다. 사람 눈에 화면은 이미 다 그려져 있었고, 늦은
 * 것은 이 작은 상자 하나였다.
 *
 * 그래서 첫 페인트 전에 결정한다 — 데모 안내가 쓰는 장치와 같다
 * (`lib/demo/invite.ts`).
 */
export const DENSITY_HINT_ATTRIBUTE = 'data-density-hint'

/** The value written; only its presence is read. */
const SEEN = 'seen'

/** 표가 붙었을 때의 값. */
const OWED = 'owed'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function densityHintDismissed(): boolean {
  try {
    return storage()?.getItem(DENSITY_HINT_KEY) === SEEN
  } catch {
    // Unreadable storage means an unknowable answer; treat it as dismissed so a
    // visitor who cannot be remembered is not nagged on every page load.
    return true
  }
}

export function dismissDensityHint(): void {
  try {
    storage()?.setItem(DENSITY_HINT_KEY, SEEN)
  } catch {
    // Then it shows again next visit, which is the harmless direction to fail in.
  }

  hideDensityHint()
}

/**
 * Never call this during a server render or in the first render pass: the answer
 * depends on localStorage, the server cannot see it, and guessing would make the
 * markup disagree with the DOM after hydration.
 */
export function shouldShowDensityHint(): boolean {
  return readStoredDensity() === null && !densityHintDismissed()
}

/**
 * 첫 페인트 전에 도는 인라인 스크립트의 원문.
 *
 * 눈으로 검토하는 대신 **테스트에서 실행해 본다** — `density-script.tsx` 가 같은
 * 이유로 같은 모양이다. 조건은 `shouldShowDensityHint` 와 같은 두 가지다: 단계를
 * 한 번도 고른 적이 없고, 안내를 닫은 적도 없을 때.
 */
export function densityHintBootScript(): string {
  return [
    '(function(){var d=null,h=null;try{',
    'd=window.localStorage.getItem(',
    JSON.stringify(DENSITY_STORAGE_KEY),
    ');h=window.localStorage.getItem(',
    JSON.stringify(DENSITY_HINT_KEY),
    ')}catch(_){return}',
    'if(d===null&&h!==',
    JSON.stringify(SEEN),
    ')document.documentElement.setAttribute(',
    JSON.stringify(DENSITY_HINT_ATTRIBUTE),
    ',',
    JSON.stringify(OWED),
    ')})()',
  ].join('')
}

/** 표를 붙인다 — 앱 안에서 이동해 와 스크립트가 돌지 않았을 때 React 가 부른다. */
export function markDensityHintOwed(): void {
  globalThis.document?.documentElement.setAttribute(DENSITY_HINT_ATTRIBUTE, OWED)
}

/** 표를 뗀다. 닫았거나, 단계를 골랐거나. */
export function hideDensityHint(): void {
  globalThis.document?.documentElement.removeAttribute(DENSITY_HINT_ATTRIBUTE)
}
