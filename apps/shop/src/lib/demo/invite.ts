/**
 * Whether the first-visit demo nudge is still owed (TASK-0044 F5 · R2).
 *
 * The same shape as the density hint's record (`lib/density-hint.ts`) and for the
 * same reasons: **once, and easy to close**. A second visit that shows the same
 * notice is not guidance, it is an advertisement.
 *
 * Every access is wrapped. Reading `localStorage` throws outright in Safari's
 * private mode and wherever site data is blocked, and an unreadable answer is
 * treated as **seen** — nagging somebody who cannot be remembered on every page
 * load is the worse way to fail.
 *
 * `subscribe` exists so a component can read this through
 * `useSyncExternalStore`: the value is not React's, the server cannot see it,
 * and rendering a guess would be a hydration mismatch.
 */

export const DEMO_INVITE_KEY = 'shopping.shop.demo.invite'

/**
 * `<html>` 에 붙는 표시. **CSS 가 이것을 보고 안내를 그린다.**
 *
 * 왜 React 가 아니라 CSS 인가 — 이 안내는 처음 온 사람에게만 나오는데 그것을 아는
 * 곳은 브라우저의 저장소뿐이고, 서버는 알 수 없다(정적 프리렌더를 지켜야 한다,
 * `layout.tsx` 의 `serverDensity`). React 로 마운트 뒤에 그리면 **그리는 순간
 * 아래가 통째로 내려간다** — 360px 에서 197px 이었고, Lighthouse 가 홈에서 잰
 * 레이아웃 이동 0.223 중 0.159 가 이 한 번이었다.
 *
 * 그래서 표는 늘 그려 두고 보이는지만 CSS 가 정한다. 밀도가 쓰는 장치와 같다
 * (`DensityScript`) — 첫 페인트 **전에** 결정되므로 아무것도 움직이지 않는다.
 */
export const DEMO_INVITE_ATTRIBUTE = 'data-demo-invite'

/** 표가 붙었을 때의 값. 값 자체에 뜻은 없고 붙었는지만 읽는다. */
const OWED = 'owed'

/**
 * 첫 페인트 전에 도는 인라인 스크립트의 원문.
 *
 * 문자열로 내보내는 것은 **눈으로 검토하는 대신 테스트에서 실행해 보기 위해서**다
 * (`density-script.tsx` 가 같은 이유로 그렇게 한다).
 */
export function demoInviteBootScript(): string {
  return [
    '(function(){var v=null;try{v=window.localStorage.getItem(',
    JSON.stringify(DEMO_INVITE_KEY),
    ')}catch(_){return}',
    'if(v!==',
    JSON.stringify(SEEN),
    ')document.documentElement.setAttribute(',
    JSON.stringify(DEMO_INVITE_ATTRIBUTE),
    ',',
    JSON.stringify(OWED),
    ')})()',
  ].join('')
}

/** 지금 안내가 보이는 상태인가 — 표가 붙어 있는지로 답한다. */
export function demoInviteShown(): boolean {
  return globalThis.document?.documentElement.getAttribute(DEMO_INVITE_ATTRIBUTE) === OWED
}

/** 표를 붙인다. 스크립트가 못 돌았을 때(클라이언트 이동) React 가 부른다. */
export function markDemoInviteOwed(): void {
  globalThis.document?.documentElement.setAttribute(DEMO_INVITE_ATTRIBUTE, OWED)
}

/**
 * 표만 뗀다 — 저장소는 건드리지 않는다.
 *
 * 로그인한 사람에게 쓰는 문이다. 「봤다」로 적어 버리면 **로그아웃한 뒤에도 다시는
 * 안 나오고**, 그 사람은 이 안내를 실제로 본 적이 없다.
 */
export function hideDemoInvite(): void {
  globalThis.document?.documentElement.removeAttribute(DEMO_INVITE_ATTRIBUTE)
}

/** The value written; only its presence is read. */
const SEEN = 'seen'

const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function subscribeToDemoInvite(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function shouldShowDemoInvite(): boolean {
  try {
    return storage()?.getItem(DEMO_INVITE_KEY) !== SEEN
  } catch {
    return false
  }
}

export function dismissDemoInvite(): void {
  try {
    storage()?.setItem(DEMO_INVITE_KEY, SEEN)
  } catch {
    // Then it shows again next visit, which is the harmless direction to fail in.
  }

  hideDemoInvite()

  for (const listener of listeners) listener()
}
