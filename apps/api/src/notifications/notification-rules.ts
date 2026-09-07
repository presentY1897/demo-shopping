import type { NotificationType } from '@prisma/client'

/**
 * 알림의 순수 판단 (TASK-0090).
 *
 * **어떤 알림을 어떤 스위치가 끄는가**, 그리고 **얼마나 오래 남는가**. 둘 다 한 곳에
 * 있어야 하는 이유는 같다 — 흩어지면 어떤 유형은 설정을 무시하고 어떤 유형은 영영
 * 쌓인다.
 */

/** 하루. */
const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * 알림이 남는 기간 — 90일 (정리 배치).
 *
 * 기한이 없으면 이 표가 사람마다 무한히 자라고, 90일 지난 「배송이 시작됐어요」를
 * 읽는 사람은 없다. 그런데도 **읽지 않은 알림까지 지운다** — 90일을 안 읽었다는
 * 것은 그 알림이 할 일을 이미 놓쳤다는 뜻이고, 배지에 영영 남는 숫자는 배지를
 * 무의미하게 만든다.
 */
export const NOTIFICATION_RETENTION_DAYS = 90

/**
 * 이 유형을 끄는 스위치.
 *
 * `UserPreference` 의 세 칸 중 하나를 가리키거나, **아무것도 가리키지 않는다**
 * (`null`). 새 칸을 만들지 않은 이유는 그 셋이 이미 사람이 이해하는 축이기
 * 때문이다 — 「거래」와 「취소·반품」과 「홍보」.
 *
 * ## 스위치가 없는 것들
 *
 * - **답변**(`REVIEW_REPLY` · `QUESTION_ANSWER`) — 내가 물어본 것에 대한 답이다.
 *   끄는 것이 뜻을 갖지 않는다.
 * - **재입고 · 신상품** — 찜과 팔로우가 곧 신청이다. 끄는 방법은 찜을 빼거나
 *   언팔로우하는 것이고, 그것이 사람이 이미 아는 스위치다. `notifyMarketing` 에
 *   묶으면 **신청해 놓고 안 오는** 상태가 만들어진다 (그 칸의 기본값은 꺼짐이다).
 */
export const NOTIFICATION_SWITCH: Readonly<
  Record<NotificationType, 'notifyOrder' | 'notifyClaim' | null>
> = {
  ORDER_STATUS: 'notifyOrder',
  SELLER_ORDER: 'notifyOrder',
  SELLER_SETTLEMENT: 'notifyOrder',
  ADMIN_SELLER_APPLICATION: 'notifyOrder',
  CLAIM_STATUS: 'notifyClaim',
  SELLER_CLAIM: 'notifyClaim',
  REVIEW_REPLY: null,
  QUESTION_ANSWER: null,
  RESTOCK: null,
  NEW_PRODUCT: null,
  /**
   * 신고 처리 결과 — 스위치가 없다.
   *
   * 신고는 사람이 **자기가 낸 것**이고, 그 결과를 알리지 않으면 신고 버튼이 아무
   * 데도 닿지 않는 버튼이 된다. 반려됐을 때가 특히 그렇다 — 「보고 아니라고
   * 판단했다」는 말이 도착하지 않으면 신고자는 아무 일도 안 일어났다고 읽는다.
   */
  REPORT_HANDLED: null,
}

/** 받는 사람의 수신 설정 — 없으면 기본값(둘 다 켜짐)이다. */
export interface NotificationPreference {
  readonly notifyOrder: boolean
  readonly notifyClaim: boolean
}

/**
 * 이 사람에게 이 유형을 보내도 되는가 (F5).
 *
 * 설정 행이 **없으면 보낸다.** `UserPreference` 는 사람이 설정 화면을 한 번이라도
 * 열어야 생기는 행이고, 그때까지의 기본값은 「받는다」다 (`profile.ts` 의 기본값과
 * 같아야 한다 — 다르면 화면이 켜져 있다고 말하는데 알림이 안 온다).
 */
export function shouldNotify(
  type: NotificationType,
  preference: NotificationPreference | null,
): boolean {
  const key = NOTIFICATION_SWITCH[type]

  if (key === null || preference === null) return true

  return preference[key]
}

/** 이 시각보다 오래된 알림은 지운다. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS)
}
