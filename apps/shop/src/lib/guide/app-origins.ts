/**
 * 세 앱의 주소 (TASK-0099).
 *
 * **동선의 요점이 「탭 세 개를 동시에 연다」**라, 방문자에게 주소를 손으로 적게 하면
 * 그 동선은 시작되지 않는다. 그래서 안내가 링크를 건다.
 *
 * 주소는 배포가 정한다 — 로컬에서는 `web-app.mjs` 가 포트에서 계산해 넣고, 배포에서는
 * 각 앱의 실제 주소가 주입된다. **없으면 링크를 걸지 않는다**: 어딘지 모르는 곳으로
 * 데려가는 것보다 「여기서는 못 연다」가 낫고, 그 판단은 화면이 아니라 여기서 한다.
 */

import type { GuideAppName } from '@/messages'

/**
 * 그 걸음이 데려갈 주소. 콘솔 주소를 모르면 `null` 이다.
 *
 * 상점은 **상대 경로**다. 절대 주소를 쓰면 미리보기 배포에서 눌렀을 때 운영으로
 * 건너뛰고, 그 사람이 방금 만든 데모 계정은 거기 없다.
 */
export function hrefFor(app: GuideAppName, path: string): string | null {
  if (app === 'shop') return path

  const configured =
    app === 'seller' ? process.env.NEXT_PUBLIC_SELLER_URL : process.env.NEXT_PUBLIC_ADMIN_URL
  const origin = configured?.trim().replace(/\/$/, '') ?? ''

  return origin === '' ? null : `${origin}${path}`
}
