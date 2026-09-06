import { COUPON_EXPIRING_SOON_DAYS } from '@shopping/shared'

/**
 * 「곧 만료된다」의 판정 (TASK-0077 F2).
 *
 * **경계는 계약이 정한다.** `COUPON_EXPIRING_SOON_DAYS` 가 `@shopping/shared` 에 있고
 * 여기서는 그것을 읽기만 한다 — 화면이 7이라는 숫자를 적어 두면 그것은 두 번째 정의가
 * 되고, 캠페인 수명이 바뀌어 경계를 옮기는 날 서버와 화면이 서로 다른 날짜에 강조를
 * 켠다.
 *
 * **적립금 쪽과 다른 모양인 것이 의도다.** 만료 예정 적립금은 서버가 판정해서
 * `expiringSoon` 으로 보내 주므로(30일) 화면이 다시 계산하지 않는다. 쿠폰함에는 그런
 * 필드가 없다 — 계약이 보내는 것은 `expiresAt` 뿐이고, 그래서 이 순수 함수가 있다.
 *
 * ## 시각이 인자다
 *
 * `Date.now()` 를 부르지 않는다. QUALITY-GATES 6장의 「시간: 주입」이고, 그래야 경계에
 * 앉은 하루를 검사가 고를 수 있다 — 지금을 안에서 읽으면 「6일 23시간 뒤 만료」와
 * 「7일 1시간 뒤 만료」를 가르는 검사를 쓸 방법이 아예 없다.
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * 이 장이 곧 사라지는가.
 *
 * **이미 지난 것은 임박이 아니다.** 만료된 장은 자기 탭(`EXPIRED`)에 있고, 거기서
 * 「곧 만료」를 켜면 강조가 「서두르세요」가 아니라 「이미 늦었습니다」를 뜻하게 된다 —
 * 배치가 아직 상태를 옮기지 않아 `ISSUED` 인 채 기간이 지난 장이 실제로 존재하므로
 * (`coupon-expiry.service.ts`), 이 갈래는 이론이 아니다.
 */
export function isExpiringSoon(expiresAt: string, now: Date): boolean {
  const remaining = new Date(expiresAt).getTime() - now.getTime()

  return remaining > 0 && remaining <= COUPON_EXPIRING_SOON_DAYS * DAY_MS
}

/**
 * 며칠 남았나 — **올림**이다.
 *
 * 내림이면 오늘 밤 자정에 사라지는 장이 「0일 남음」이 되고, 그것은 사람에게 「이미
 * 끝났다」로 읽힌다. 올림이면 「1일 남음」이고, 그 사람에게는 아직 오늘이 남아 있다.
 *
 * 이미 지난 장은 0이다. 부르는 쪽이 {@link isExpiringSoon} 로 이미 걸렀으므로 그 값이
 * 화면에 그려지지는 않지만, 음수를 돌려주면 「-3일 남음」을 만들 수 있는 함수가 된다.
 */
export function daysUntilExpiry(expiresAt: string, now: Date): number {
  const remaining = new Date(expiresAt).getTime() - now.getTime()

  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS)
}
