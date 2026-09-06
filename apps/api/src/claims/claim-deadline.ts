import type { AppConfig, FulfillmentPace } from '../config/app-config.js'

/**
 * 클레임의 **처리 기한** — 「신청 후 2영업일」 (TASK-0070 4장).
 *
 * 데이터베이스도 시계도 보지 않는다. 「지금」도 「언제 신청했나」도 인자로 받으므로
 * 분기 전부가 단위 스펙에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지 100%** 다 —
 * 뒤집어 말하면 **닿을 수 없는 방어 분기를 쓰지 않는다**.
 *
 * ## 「영업일」을 어디까지 세는가 — 정하지 않으면 셀 수 없다
 *
 * TASK 문서는 「2영업일」이라고만 적어 두었고, 그 문장만으로는 금요일 오후에 들어온
 * 반품의 기한이 언제인지 답할 수 없다. 그래서 세 가지를 여기서 정한다.
 *
 * | 무엇을 | 어떻게 | 왜 |
 * | --- | --- | --- |
 * | 시간대 | **KST 고정 오프셋 +09:00** | 영업일은 달력의 개념이라 시간대 없이 셀 수 없다. 이 저장소는 이미 `Asia/Seoul` 로 날짜를 그린다(`packages/ui/src/format/date.ts` 가 `timeZone` 을 인자로 **요구**하는 이유). 한국 표준시는 **서머타임이 없어서**(1988년 이후) 고정 오프셋 산술이 IANA 표와 정확히 같은 답을 낸다 — 시간대 라이브러리를 새로 들이지 않아도 되는 근거이자, 들이지 않는 이유 |
 * | 주말 | **토 · 일 제외** | |
 * | 공휴일 | **보지 않는다** | 아래 |
 *
 * ## 공휴일을 세지 않는 것이 이 파일의 유일한 「지어내지 않음」이다
 *
 * 한국의 공휴일은 **규칙으로 계산할 수 없다.** 설·추석이 음력이고, 대체공휴일이
 * 그 위에 붙고, 임시공휴일은 그 해에 국무회의가 정한다. 즉 필요한 것은 함수가
 * 아니라 **연도별 표**다.
 *
 * 그 표는 이 저장소에 없고, **매년 갱신할 주인도 없다.** 표를 코드에 박으면 다음
 * 해에 조용히 틀리고, 틀리는 방향이 나쁘다 — 없는 공휴일을 세지 않으므로 기한이
 * 실제보다 **길게** 잡히고, 그러면 지연이 지연으로 보이지 않는다. 「잘못 뒀을 때
 * 조용한 값을 고르지 않는다」가 이 저장소의 규칙이고(`FULFILLMENT_PACE` 기본값의
 * 근거가 그것이다), 여기서 조용한 쪽은 **틀린 표**다.
 *
 * 그래서 주말만 센다. 대신 그 사실을 **숨기지 않는다** — 판매자 화면이 기한 옆에
 * 「주말 제외 · 공휴일 미반영」이라고 적는다(`apps/seller/src/messages/ko.ts`).
 * 지연 표시는 경고이지 차단이 아니므로, 조금 이르게 뜨는 쪽이 늦게 뜨는 쪽보다
 * 낫다.
 *
 * ## 「후 2영업일」의 두 가지 뜻 중 무엇인가
 *
 * - **당일은 세지 않는다.** 「신청 **후**」이므로 신청 다음 영업일이 1영업일이다.
 * - **시각은 유지한다.** 금 15:00 신청의 기한은 화 15:00 이다. 날짜의 끝(24:00)으로
 *   올리지 않는 이유는 그러면 09:00 에 신청한 사람과 17:00 에 신청한 사람이 같은
 *   기한을 받아 **먼저 신청한 쪽이 8시간을 손해 보기** 때문이다. 시각을 유지하면
 *   모든 신청이 정확히 같은 길이를 받는다.
 */

/** 한국 표준시의 UTC 오프셋. **상수인 것이 근거다** — 서머타임이 없다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * 1970-01-01 은 **목요일**이다.
 *
 * 요일을 「일요일 0」으로 세려면 일수에 이만큼을 더해야 한다 — `Date.getDay()` 를
 * 쓰지 않는 이유는 그것이 프로세스의 시간대를 읽기 때문이고, 컨테이너의 시간대는
 * UTC 다.
 */
const EPOCH_DAY_OF_WEEK = 4

const SUNDAY = 0
const SATURDAY = 6

const DAYS_IN_WEEK = 7

/** 실제 서비스의 처리 기한 — 신청 후 **2영업일**. */
export const CLAIM_HANDLING_BUSINESS_DAYS = 2

/**
 * 시간을 압축한 데모의 처리 기한 — 신청 후 **10분**.
 *
 * **축을 새로 만들지 않는다.** 배송(TASK-0062)과 구매확정(TASK-0064)이 이미
 * `FULFILLMENT_PACE` 하나로 압축 여부를 정하고 있고, 여기서 그 판단을 다시 내리면
 * 「데모 모드」가 세 벌이 된다 — 그때 증상은 「배송은 6분인데 처리 기한은 2영업일」
 * 이고, 아무것도 실패하지 않는다. 판단은 저 축에서 오고 **값만 여기서 갖는다**
 * (`autoConfirmWindowMsOf` 가 적어 둔 나눔 그대로다).
 *
 * **10분인 이유.** 데모 계정은 24시간을 산다(TASK-0025). 그 안에서 「기한 안」과
 * 「지연」을 **둘 다** 볼 수 있어야 뱃지와 강조가 뜻을 갖는다 — 2영업일을 지키면
 * 지연은 영영 안 뜨고, 1분이면 신청한 것이 전부 지연이라 강조가 아무것도 구분하지
 * 못한다. 압축된 배송이 6분이고 확정이 5분이므로(합쳐 11분), 그 한 주기를 지나는
 * 동안은 대체로 기한 안이고 그 뒤에 지연이 뜬다.
 */
export const CLAIM_HANDLING_DEMO_MS = 10 * 60_000

/** 이 순간이 속한 **KST 달력 날짜**를, 1970-01-01 부터 센 일수로. */
export function kstDayIndex(instant: Date): number {
  return Math.floor((instant.getTime() + KST_OFFSET_MS) / DAY_MS)
}

/** 그 날의 요일. 일요일이 0 이다. */
export function kstDayOfWeek(dayIndex: number): number {
  // 1970 이전은 음수 일수이고 `%` 는 음수를 그대로 돌려준다. 이 저장소에 그런 날짜가
  // 오지는 않지만, 요일 계산이 입력의 부호에 따라 달라지는 것은 함수가 아니다.
  return (((dayIndex + EPOCH_DAY_OF_WEEK) % DAYS_IN_WEEK) + DAYS_IN_WEEK) % DAYS_IN_WEEK
}

/** 영업일인가 — **주말만** 뺀다. 공휴일을 보지 않는 이유는 파일 머리말에 있다. */
export function isBusinessDay(dayIndex: number): boolean {
  const dayOfWeek = kstDayOfWeek(dayIndex)

  return dayOfWeek !== SUNDAY && dayOfWeek !== SATURDAY
}

/**
 * 이 날부터 영업일을 `days` 번 센 날.
 *
 * **당일은 세지 않는다.** 한 걸음이 「다음 날로 옮긴 뒤, 영업일이 될 때까지 계속
 * 옮기는 것」이라 금요일에서 한 걸음은 월요일이고 토요일에서 한 걸음도 월요일이다.
 */
export function addBusinessDays(dayIndex: number, days: number): number {
  let day = dayIndex

  for (let counted = 0; counted < days; counted += 1) {
    do {
      day += 1
    } while (!isBusinessDay(day))
  }

  return day
}

/**
 * 이 신청의 **처리 기한** — 그 순간까지가 기한 안이다.
 *
 * 압축 모드에서는 영업일을 세지 않는다. 압축된 시간에 달력의 주말을 얹으면 「10분
 * 뒤인데 월요일까지」 같은 값이 나오고, 그것은 어느 쪽 축도 아니다.
 */
export function claimDueAt(requestedAt: Date, pace: FulfillmentPace): Date {
  if (pace === 'demo') return new Date(requestedAt.getTime() + CLAIM_HANDLING_DEMO_MS)

  const from = kstDayIndex(requestedAt)
  const to = addBusinessDays(from, CLAIM_HANDLING_BUSINESS_DAYS)

  // 날짜만 옮기고 시각은 그대로 둔다. KST 에 서머타임이 없으므로 「며칠 뒤 같은
  // 시각」은 정확히 일수 × 24시간이다 — 이 뺄셈이 성립하는 것이 고정 오프셋을 쓰는
  // 두 번째 이유다.
  return new Date(requestedAt.getTime() + (to - from) * DAY_MS)
}

/** 부르는 쪽이 아는 것은 **설정 하나**다 — `autoConfirmWindowMsOf` 와 같은 모양. */
export function claimDueAtOf(requestedAt: Date, config: Pick<AppConfig, 'fulfillmentPace'>): Date {
  return claimDueAt(requestedAt, config.fulfillmentPace)
}

/**
 * 기한을 넘겼는가.
 *
 * **기한 정각은 아직 기한 안이다.** 기한은 「그 순간까지」를 뜻하므로, 정각에
 * 처리한 사람을 지연으로 표시하는 것은 하루를 빼앗는 것이다.
 */
export function isClaimOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime()
}
