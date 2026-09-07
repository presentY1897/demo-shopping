import type { Notification, NotificationType } from '@shopping/shared'

/**
 * 이 앱이 그리는 알림은 어느 것인가 (TASK-0090 F7).
 *
 * **역할이 유형에 묻어 있다** — `SELLER_` 로 시작하는 것은 판매자 콘솔의 것이고
 * `ADMIN_` 은 관리자 콘솔의 것이다(`notifications.ts` 의 머리말). 한 계정이 두 역할을
 * 가질 수 있으므로(판매자도 물건을 산다) **한 사람의 알림함에 세 앱의 알림이 섞여 올
 * 수 있고**, 그때 상점이 「정산이 지급되었습니다」를 그리면 그 링크는 상점에 없는
 * 화면을 가리킨다.
 *
 * 거르는 자리가 화면이 아니라 여기인 이유는 **거르지 않은 곳이 하나만 있어도**
 * 새는 것이 알림 하나가 아니라 그 링크를 따라간 사람의 404 이기 때문이다. 헤더의
 * 드롭다운과 알림함 페이지가 같은 함수를 지난다.
 *
 * 미읽음 수는 거르지 않는다 — 그것은 서버가 센 값이고, 화면이 다시 세면 「배지에는
 * 3인데 목록에는 둘」이 된다. 세 앱을 함께 쓰는 데모 계정에서만 벌어지는 일이라
 * 더더욱 조용하다.
 */

/** 접두어가 다른 앱을 가리키지 않는 유형. */
export function isShopNotification(type: NotificationType): boolean {
  return !type.startsWith('SELLER_') && !type.startsWith('ADMIN_')
}

export function shopNotifications(notifications: readonly Notification[]): readonly Notification[] {
  return notifications.filter((notification) => isShopNotification(notification.type))
}
