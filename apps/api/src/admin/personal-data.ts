import { maskAuthorName } from '../reviews/review-rules.js'

/**
 * 개인정보를 **가려서** 내려보내는 규칙 (TASK-0093 F6).
 *
 * ## 서버가 가린다
 *
 * 화면마다 가리게 두면 한 화면이 잊는 날 그 화면만 전부 보여 주고, 그때 증상은
 * 오류가 아니라 **이미 공개된 개인정보**다. 리뷰 작성자 이름이 같은 판단을 먼저
 * 했다 (D-246) — 그래서 이름은 그 함수를 **다시 쓴다.** 가리는 규칙이 두 개면
 * 두 화면이 같은 사람을 다르게 가린다.
 *
 * I/O 도 상태도 없다.
 */

/** 이름 가리기는 리뷰와 같은 규칙이다 — `홍*동`. */
export const maskName = maskAuthorName

/**
 * `hong@example.com` → `hon*@example.com`.
 *
 * ## 도메인은 남긴다
 *
 * 도메인이 개인을 지목하지 않고(회사 메일이면 소속이 드러나지만 그것은 이미 이
 * 화면을 보는 사람이 알아도 되는 정보다), **무엇보다 관리자가 계정을 알아보는 데
 * 쓰인다** — 같은 이름이 여럿일 때 구별되는 것은 도메인 쪽인 경우가 많다.
 *
 * ## 앞 세 글자
 *
 * 한 글자만 남기면 `h***@` 가 되어 서로 다른 계정이 화면에서 같아 보인다. 전부
 * 가리면 목록에서 계정을 지목할 방법이 사라지고, 그러면 사람이 **상세를 더 자주
 * 열게 된다** — 가리기가 열람을 늘리는 셈이라 목적과 반대로 간다.
 *
 * 로컬 파트가 세 글자 이하면 그만큼만 남기고 별 하나를 붙인다. 남길 것이 없는데
 * 별만 늘리면 길이가 새어 나간다.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')

  // `@` 가 없는 값은 이메일이 아니다. 이름과 같은 규칙으로 가린다 — 못 가리는
  // 것보다 낫고, 여기서 던지면 목록 한 줄 때문에 화면 전체가 실패한다.
  if (at <= 0) return maskName(email)

  const local = email.slice(0, at)
  const domain = email.slice(at)
  const head = [...local].slice(0, 3).join('')

  return `${head}*${domain}`
}
