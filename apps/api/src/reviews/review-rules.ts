import type { OrderStatus } from '@shopping/shared'
import { reviewImageKeyPattern } from '@shopping/shared'

/**
 * 리뷰를 쓸 수 있는가, 고칠 수 있는가 (TASK-0083 6.2, 순수 로직).
 *
 * **구매했는가는 여기서 묻지 않는다.** 그 답은 스키마가 갖고 있다 —
 * `Review.orderItemId` 가 필수 유니크라, 사지 않은 사람은 가리킬 행이 없고 두 번
 * 쓰는 것도 같은 제약이 막는다 (`erd.md` 9장). 코드가 「주문했는가」를 물으면 그
 * 물음은 우회 경로가 생기는 날 뚫리지만, 없는 행은 어떤 경로로도 만들 수 없다.
 *
 * 그래서 여기 남는 판단은 **시점**뿐이다 — 아직 이른가, 이미 늦었는가.
 */

/** 하루. */
const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * 배송완료 뒤 리뷰를 쓸 수 있는 기간 — 90일.
 *
 * 기한이 있는 이유는 **오래된 리뷰가 지금의 상품을 설명하지 못하기** 때문이다.
 * 1년 전에 받은 물건에 오늘 남기는 별점은 그 사이 바뀐 구성·포장·배송을 하나도
 * 반영하지 않으면서 평균을 움직인다. 그리고 기한이 없으면 「작성 가능한 리뷰」
 * 목록이 영원히 자라 아무도 열지 않는 화면이 된다.
 *
 * 90일인 것은 국내 커머스의 관례이자, **구매확정(D+7)보다 넉넉히 뒤**라는 것이
 * 이 값이 지켜야 하는 성질이다. 확정 전에 닫히면 쓸 수 있는 창이 사실상 없다.
 */
export const REVIEW_WRITE_WINDOW_DAYS = 90

/**
 * 쓴 뒤 고칠 수 있는 기간 — 30일 (TASK-0083 4장).
 *
 * **무기한 수정을 허용하면 좋은 리뷰를 받고 나중에 내용을 바꾸는 조작이 가능하다.**
 * 판매자가 혜택을 주고 별 다섯을 받은 뒤, 몇 달 지나 그 리뷰가 별 하나로 바뀌는
 * 일을 아무도 막지 못한다. 반대로 기한이 너무 짧으면 오타 하나를 못 고친다.
 */
export const REVIEW_EDIT_WINDOW_DAYS = 30

/** 한 리뷰에 붙일 수 있는 사진의 수. */
export const REVIEW_IMAGE_MAX_COUNT = 5

/** 리뷰를 쓸 수 있는 주문 항목이 갖춰야 하는 사실. */
export interface ReviewSubject {
  /** 그 판매자 몫의 지금 상태. */
  readonly status: OrderStatus
  /** 배송완료로 옮겨진 시각. 아직 안 갔으면 `null`. */
  readonly deliveredAt: Date | null
  /** 이미 리뷰가 있는가 — 있으면 DB 가 거절하지만, 화면은 먼저 알아야 한다. */
  readonly reviewed: boolean
}

/**
 * 왜 못 쓰나.
 *
 * **넷을 나누는 이유는 사람이 할 일이 다르기 때문이다.** 아직 안 온 것은 기다리면
 * 되고, 이미 쓴 것은 고치면 되며, 기한이 지난 것은 할 수 있는 일이 없고, 취소된
 * 것은 애초에 받은 적이 없다. 한 코드로 답하면 화면은 넷 중 셋을 반드시 틀리게
 * 말한다.
 */
export type ReviewRefusal = 'not_delivered' | 'already_reviewed' | 'window_closed' | 'canceled'

export type ReviewDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: ReviewRefusal }

const ALLOWED: ReviewDecision = { allowed: true }

/**
 * 배송완료를 지났는가 — **지났으면 되돌아가지 않는다.**
 *
 * 「지금 상태가 배송완료다」가 아니라 「배송완료를 지난 적이 있다」를 묻는 이유는
 * 구매확정이 그 뒤에 오기 때문이다. 확정된 주문에 리뷰를 못 쓰면 리뷰를 쓸 수 있는
 * 사람이 거의 남지 않는다 — 확정은 배송완료 7일 뒤 자동으로 온다 (TASK-0064).
 */
const DELIVERED_OR_LATER: readonly OrderStatus[] = ['DELIVERED', 'CONFIRMED']

/**
 * 이 주문 항목에 리뷰를 쓸 수 있는가 (F3).
 *
 * 순서가 뜻을 갖는다. **취소·반품이 먼저**인 이유는 그것이 「기다리면 되는」 상태가
 * 아니기 때문이고, **이미 썼는가가 기한보다 먼저**인 이유는 기한이 지난 뒤에도
 * 「이미 쓰셨어요」가 「기간이 지났어요」보다 정확한 말이기 때문이다.
 */
export function reviewDecision(subject: ReviewSubject, now: Date): ReviewDecision {
  if (subject.status === 'CANCELED' || subject.status === 'RETURNED') {
    return { allowed: false, reason: 'canceled' }
  }

  if (subject.reviewed) return { allowed: false, reason: 'already_reviewed' }

  if (subject.deliveredAt === null || !DELIVERED_OR_LATER.includes(subject.status)) {
    return { allowed: false, reason: 'not_delivered' }
  }

  return withinDays(subject.deliveredAt, now, REVIEW_WRITE_WINDOW_DAYS)
    ? ALLOWED
    : { allowed: false, reason: 'window_closed' }
}

/**
 * 이 리뷰를 아직 고칠 수 있는가 (F5).
 *
 * 기준이 **쓴 시각**이지 고친 시각이 아니다. 고칠 때마다 30일이 새로 시작하면
 * 무기한 수정과 같아지고, 그것이 막으려던 조작이 그대로 가능해진다.
 */
export function editable(createdAt: Date, now: Date): boolean {
  return withinDays(createdAt, now, REVIEW_EDIT_WINDOW_DAYS)
}

/**
 * `from` 에서 `days` 일이 지나지 않았는가.
 *
 * 경계는 **포함**이다 — 정확히 30일째의 수정은 받는다. 밀리초 하나로 갈리는 거절은
 * 사람에게 설명할 수 없고, 어느 쪽으로 정하든 하나는 골라야 한다.
 */
function withinDays(from: Date, now: Date, days: number): boolean {
  return now.getTime() - from.getTime() <= days * DAY_MS
}

/**
 * 이 열쇠가 **이 사람의** 것인가.
 *
 * 접두어가 사람인 덕분에 **두 번째 조회가 필요 없다.** 열쇠만 보고 소유자를 말할 수
 * 있으니 「남의 사진을 내 리뷰에 붙인다」가 조용히 통과하지 않는다
 * (`claims/return-rules.ts` 의 `isOwnPhotoKey` 와 같은 장치다).
 *
 * 형식을 다시 재는 것은 계약이 이미 걸러 낸 뒤라도 마찬가지다 — 이 함수를 부르는
 * 자리가 HTTP 하나뿐이라고 보장할 수 없다.
 */
export function isOwnImageKey(key: string, ownerUserId: string): boolean {
  return reviewImageKeyPattern.test(key) && key.startsWith(`reviews/${ownerUserId}/`)
}

/** 사진 목록이 거절되는 이유. */
export type ReviewImageRefusal = 'too_many' | 'duplicate' | 'foreign'

export type ReviewImageDecision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'refused'; readonly reason: ReviewImageRefusal }

/**
 * 이 사진들을 이 사람의 리뷰에 붙일 수 있는가 (F6).
 *
 * 순서가 뜻을 갖는다. **수가 먼저**인 이유는 그것이 사람이 곧바로 고칠 수 있는
 * 유일한 문제이기 때문이고, **남의 것인지가 마지막**인 이유는 그 답이 존재를
 * 알려 주지 않아야 하기 때문이다 — 없는 사진인지 남의 사진인지 갈라 답하면 열쇠를
 * 넣어 보는 것만으로 남의 사진이 있다는 사실을 알 수 있다.
 */
export function reviewImageDecision(
  keys: readonly string[],
  ownerUserId: string,
): ReviewImageDecision {
  if (keys.length > REVIEW_IMAGE_MAX_COUNT) return { outcome: 'refused', reason: 'too_many' }
  if (new Set(keys).size !== keys.length) return { outcome: 'refused', reason: 'duplicate' }
  if (!keys.every((key) => isOwnImageKey(key, ownerUserId))) {
    return { outcome: 'refused', reason: 'foreign' }
  }

  return { outcome: 'allowed' }
}

/**
 * 쓴 사람의 이름을 **공개해도 되는 만큼만** 남긴다 — `홍*동`.
 *
 * 리뷰는 로그인하지 않은 사람도 읽는다. 가리는 일을 화면마다 하게 두면 한 화면이
 * 잊는 날 그 화면만 이름을 다 보여 주고, 그때 증상은 오류가 아니라 **이미 공개된
 * 개인정보**다. 그래서 서버가 가려서 내려보낸다.
 *
 * 규칙은 「가운데를 별로」다. 두 글자면 뒤 한 글자를 가리고, 한 글자면 그대로 둔다 —
 * 한 글자를 가리면 남는 것이 없어 「누가 썼는지 모르는 리뷰」가 되고, 그것은 리뷰의
 * 신뢰를 만드는 사실 하나를 지운다.
 */
export function maskAuthorName(name: string): string {
  // 글자 단위로 센다. `length` 는 코드 단위를 세므로 이모지가 섞인 이름에서 별의
  // 수가 어긋나고, 그때 잘린 대리 쌍은 깨진 글자로 그려진다.
  const letters = [...name.trim()]

  if (letters.length <= 1) return letters.join('')

  const head = letters.slice(0, 1).join('')

  if (letters.length === 2) return `${head}*`

  return `${head}${'*'.repeat(letters.length - 2)}${letters.slice(-1).join('')}`
}
