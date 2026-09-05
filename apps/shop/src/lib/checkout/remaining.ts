/**
 * 남은 시간 (TASK-0050 F2 · F3).
 *
 * 순수 함수다. 「3분 이하면 강조」와 「지났으면 만료」는 화면이 매초 다시 묻는
 * 판단이고, 그것이 틀리면 **결제 중에 예약이 풀린다** — 사람이 가장 당황하는
 * 순간이다.
 *
 * R1 이 「15분 타이머가 심리적 압박」을 걱정한다. 그래서 강조는 마지막 3분에만
 * 붙고, 그전에는 남은 시간이 그냥 적혀 있다.
 */

/** 이 아래로 내려가면 강조한다. */
export const URGENT_THRESHOLD_MS = 3 * 60 * 1000

export interface Remaining {
  /** 화면에 그릴 분·초. 만료됐으면 둘 다 0이다. */
  readonly minutes: number
  readonly seconds: number
  /**
   * 강조할 것인가.
   *
   * 「마지막 3분인가」가 **아니다** — 만료된 뒤에도 참이다. 강조가 만료 화면으로
   * 넘어가기 직전 한 틱 동안 꺼졌다 켜지는 것을 막기 위해서다.
   *
   * 그래서 **이 값으로 예약이 살아 있는지를 판단하면 안 된다.** 그것은
   * {@link Remaining.expired} 이 답한다.
   */
  readonly urgent: boolean
  /** 시간이 지났는가. */
  readonly expired: boolean
}

export function remainingAt(expiresAt: Date, now: Date): Remaining {
  const left = expiresAt.getTime() - now.getTime()

  if (left <= 0) return { minutes: 0, seconds: 0, urgent: true, expired: true }

  // 초는 **올림**이다. 1.2초 남았을 때 「1초」라고 쓰면 0에 닿기 전에 만료되는
  // 것처럼 보이고, 「2초」라고 쓰면 마지막 순간까지 숫자가 줄어드는 것이 보인다.
  const total = Math.ceil(left / 1_000)

  return {
    minutes: Math.floor(total / 60),
    seconds: total % 60,
    urgent: left <= URGENT_THRESHOLD_MS,
    expired: false,
  }
}

/** `12:05`. 초를 두 자리로 채우지 않으면 「12:5」가 된다. */
export function formatRemaining(remaining: Remaining): string {
  return `${String(remaining.minutes)}:${String(remaining.seconds).padStart(2, '0')}`
}
