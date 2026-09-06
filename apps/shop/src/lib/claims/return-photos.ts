import type { ReturnReason } from '@shopping/shared'
import { RETURN_PHOTO_MAX_COUNT, UPLOAD_MAX_BYTES, uploadContentTypes } from '@shopping/shared'
import type { UploadContentType } from '@shopping/shared'

/**
 * 반품 사진을 **고르는** 단계의 판단 (TASK-0067 F2).
 *
 * 올리는 일은 `use-return-photos.ts` 가 하고, 여기 있는 것은 그 앞의 순수한 답들 —
 * 이 사유에 사진이 필요한가, 이 파일을 올려도 되는가.
 *
 * ## 서버 규칙을 왜 여기 또 적는가
 *
 * `apps/api/src/claims/return-rules.ts` 의 `PHOTO_RULE` 이 같은 표를 갖는다. 그런데
 * 화면은 그 답을 **버튼을 누르기 전에** 알아야 한다 — 사유를 고르는 순간 사진 칸이
 * 나타나야 하고, 하자 반품에서 사진을 안 붙인 사람에게는 보내기 전에 말해야 한다.
 * 서버에 물어서 아는 방법이 없다(사유는 요청의 일부이지 조회할 자원이 아니다).
 *
 * 그래서 이 표는 **화면이 무엇을 그릴지**를 정하고, **거절은 여전히 서버의 것**이다
 * (`RETURN_PHOTO_REQUIRED` · `RETURN_PHOTO_NOT_ALLOWED`). 둘이 갈라지면 화면이
 * 못 붙이게 한 사진을 서버가 요구하거나 그 반대가 되는데, 그때도 **서버가 이긴다** —
 * 화면은 그 거절을 문장으로 그릴 자리를 갖고 있다.
 */
const PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

/** 이 사유에 사진 칸이 있는가. 없으면 붙일 수도 없다. */
export function returnPhotosRequired(reason: ReturnReason): boolean {
  return PHOTO_RULE[reason] === 'required'
}

/** `accept` 에 실을 형식들. 계약이 받는 것과 **같은 목록**이어야 한다. */
export const RETURN_PHOTO_ACCEPT = uploadContentTypes.join(',')

/**
 * 고른 파일 하나가 올라갈 수 있는가.
 *
 * **두 거절을 나누는 이유는 사람이 할 일이 다르기 때문이다** — 형식이 안 맞으면 다른
 * 파일을 골라야 하고, 너무 크면 줄여서 올려야 한다. 상한을 넘은 것을 여기서 걸러야
 * presign 왕복 하나가 낭비되지 않고, 무엇보다 그 왕복의 400 은 **어느 파일이
 * 문제인지** 말해 주지 않는다.
 *
 * 판매자 화면처럼 브라우저에서 다시 인코딩하지는 않는다(`apps/seller` 의
 * `prepareImage`). 그쪽이 그렇게 하는 이유는 상품 이미지가 **카탈로그에 오래 남아
 * 여러 밀도로 다시 그려지기** 때문이고, 반품 사진은 판매자가 한 번 보고 판단하는
 * 증거다 — 원본 그대로가 오히려 증거로서 낫다.
 */
export type ReturnPhotoRejection =
  /** 이미지가 아니거나, 우리가 받지 않는 형식이다 */
  | 'unsupported_type'
  /** 상한(5MB)을 넘었다 */
  | 'too_large'
  /** 이미 다섯 장이다 */
  | 'too_many'

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
