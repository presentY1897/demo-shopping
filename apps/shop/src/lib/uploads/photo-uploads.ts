import { UPLOAD_MAX_BYTES, uploadContentTypes } from '@shopping/shared'
import type { UploadContentType } from '@shopping/shared'

/**
 * 사진을 **고르는** 단계의 판단 — 목적과 무관한 부분 (TASK-0067 F2 · TASK-0083 F6).
 *
 * 올리는 일은 `use-photo-uploads.ts` 가 하고, 여기 있는 것은 그 앞의 순수한 답이다:
 * 이 파일을 올려도 되는가.
 *
 * **원래 반품 사진의 것이었다.** TASK-0083 이 리뷰 사진을 같은 흐름으로 올리게 되면서
 * 두 벌이 될 뻔했고, 두 벌이 되면 갈라지는 것은 코드가 아니라 **거절의 기준**이다 —
 * 한쪽만 `image/gif` 를 받거나 한쪽만 상한을 잘못 세는 날, 화면은 서버가 거절할 파일을
 * 조용히 받아 presign 왕복 하나를 버린다. 그래서 목적별로 다른 것(접두어·상한)은
 * 인수로 받고, 같은 것(형식·크기)만 여기 있다.
 */

/** `accept` 에 실을 형식들. 계약이 받는 것과 **같은 목록**이어야 한다. */
export const PHOTO_UPLOAD_ACCEPT = uploadContentTypes.join(',')

/**
 * 왜 이 파일은 못 올리는가.
 *
 * **셋을 나누는 기준은 사람이 할 일이 다른가**다 — 형식이 안 맞으면 다른 파일을
 * 골라야 하고, 너무 크면 줄여서 올려야 하며, 장수를 채웠으면 한 장을 빼야 한다.
 * 상한을 넘은 것을 여기서 걸러야 presign 왕복 하나가 낭비되지 않고, 무엇보다 그
 * 왕복의 400 은 **어느 파일이 문제인지** 말해 주지 않는다.
 *
 * 판매자 화면처럼 브라우저에서 다시 인코딩하지는 않는다(`apps/seller` 의
 * `prepareImage`). 그쪽이 그렇게 하는 이유는 상품 이미지가 **카탈로그에 오래 남아
 * 여러 밀도로 다시 그려지기** 때문이고, 반품 사진과 리뷰 사진은 사람이 한 번 보고
 * 판단하는 증거다 — 원본 그대로가 오히려 증거로서 낫다.
 */
export type PhotoUploadRejection =
  /** 이미지가 아니거나, 우리가 받지 않는 형식이다 */
  | 'unsupported_type'
  /** 상한(5MB)을 넘었다 */
  | 'too_large'
  /** 이미 상한만큼 붙였다 */
  | 'too_many'

export type PhotoUploadCheck =
  | { readonly ok: true; readonly contentType: UploadContentType }
  | { readonly ok: false; readonly reason: PhotoUploadRejection }

/**
 * 고른 파일 하나가 올라갈 수 있는가.
 *
 * `maxCount` 를 **인수로 받는다.** 반품 사진과 리뷰 사진은 지금 둘 다 다섯 장이지만
 * 그 둘은 계약의 다른 상수이고(`RETURN_PHOTO_MAX_COUNT` · `REVIEW_IMAGE_MAX_COUNT`),
 * 한쪽이 바뀌는 날 같은 숫자를 쓰던 코드는 **아무 검사도 실패시키지 않은 채** 틀린다.
 */
export function checkPhotoUpload(
  file: { readonly type: string; readonly size: number },
  alreadyAttached: number,
  maxCount: number,
): PhotoUploadCheck {
  if (alreadyAttached >= maxCount) return { ok: false, reason: 'too_many' }

  const contentType = uploadContentTypes.find((accepted) => accepted === file.type)

  if (contentType === undefined) return { ok: false, reason: 'unsupported_type' }
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'too_large' }

  return { ok: true, contentType }
}
