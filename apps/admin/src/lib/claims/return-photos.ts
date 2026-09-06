import type { UploadContentType } from '@shopping/shared'
import { RETURN_PHOTO_MAX_COUNT, UPLOAD_MAX_BYTES, uploadContentTypes } from '@shopping/shared'

/**
 * 확정 후 하자 반품에 붙는 **증거**를 고르는 단계의 판단 (TASK-0071 F4).
 *
 * ## 관리자 화면에 왜 사진 칸이 있는가
 *
 * 서버가 요구한다. 하자·오배송 반품은 **판매자에게 돈을 물리는 일**이라 사진이
 * 필수이고(`apps/api/src/claims/return-rules.ts` 의 `PHOTO_RULE`), 그 판정은 관리자
 * 경로에서도 그대로 지난다 — `AdminClaimService.force` 는 `ClaimService.createWith`
 * 를 지나고 거기서 `returnPhotoDecision` 이 돈다. 사진 칸이 없는 화면은 언제나
 * `RETURN_PHOTO_REQUIRED` 로 끝나는 폼이 된다.
 *
 * ## 열쇠의 주인은 **부르는 사람**이다
 *
 * `isOwnPhotoKey` 는 `returns/{userId}/…` 의 가운데 칸을 **신청을 낸 사람**과
 * 비교하는데, 관리자 개입에서 그 사람은 관리자다(`principal.userId`). 그래서 이
 * 화면이 붙이는 사진은 **관리자가 올린 것**이고, 구매자가 문의에 첨부한 이미지를
 * 그대로 실을 수는 없다 — 운영자가 받은 사진을 자기 계정으로 다시 올리는 것이 이
 * 흐름이 실제로 하는 일이다.
 *
 * ## 구매자 화면과 같은 판단을 왜 또 적는가
 *
 * `apps/shop/src/lib/claims/return-photos.ts` 가 같은 함수를 갖는다. 앱 사이에는
 * 공용 계층이 `packages/shared`(계약) 와 `packages/ui`(컴포넌트) 뿐이고, 이것은 둘
 * 다 아니다 — 계약이 아니라 **화면이 왕복 하나를 아끼려고 미리 재는 것**이고,
 * 컴포넌트가 아니라 순수 함수다. 상한과 형식은 둘 다 `@shopping/shared` 에서 오므로
 * 갈라질 수 있는 것은 문장뿐이다.
 */

/** `accept` 에 실을 형식들. 계약이 받는 것과 **같은 목록**이어야 한다. */
export const RETURN_PHOTO_ACCEPT = uploadContentTypes.join(',')

/**
 * 고른 파일 하나가 올라갈 수 있는가.
 *
 * **셋을 나누는 이유는 사람이 할 일이 다르기 때문이다** — 형식이 안 맞으면 다른
 * 파일을 골라야 하고, 너무 크면 줄여야 하며, 다섯 장이 찼으면 한 장을 빼야 한다.
 * 상한을 넘은 것을 여기서 걸러야 presign 왕복 하나가 낭비되지 않고, 무엇보다 그
 * 왕복의 400 은 **어느 파일이 문제인지** 말해 주지 않는다.
 */
export type ReturnPhotoRejection = 'unsupported_type' | 'too_large' | 'too_many'

export type ReturnPhotoCheck =
  | { readonly ok: true; readonly contentType: UploadContentType }
  | { readonly ok: false; readonly reason: ReturnPhotoRejection }

export function checkReturnPhoto(
  file: { readonly type: string; readonly size: number },
  alreadyAttached: number,
): ReturnPhotoCheck {
  if (alreadyAttached >= RETURN_PHOTO_MAX_COUNT) return { ok: false, reason: 'too_many' }

  const contentType = uploadContentTypes.find((accepted) => accepted === file.type)

  if (contentType === undefined) return { ok: false, reason: 'unsupported_type' }
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'too_large' }

  return { ok: true, contentType }
}
